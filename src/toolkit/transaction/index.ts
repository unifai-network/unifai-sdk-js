import { APIConfig } from '../../common';
import { WagmiSigner, EtherSigner, SolanaSigner, SendConfig, Signer, getSignerAddress } from '../types';
import { JitoClient } from '../jito';
import { QuickNodeJitoClient } from '../jito-quicknode';
import { BaseTransactionAPI } from './base';
import { SolanaHandler } from './solana-handler';
import { EVMHandler } from './evm-handler';
import { PolymarketHandler } from './polymarket-handler';
import { HyperliquidHandler } from './hyperliquid-handler';
import { JitoHandler } from './jito-handler';

export class TransactionAPI extends BaseTransactionAPI {
    private solanaHandler: SolanaHandler;
    private evmHandler: EVMHandler;
    private polymarketHandler: PolymarketHandler;
    private hyperliquidHandler: HyperliquidHandler;
    private jitoHandler: JitoHandler;

    constructor(config: APIConfig) {
        super(config);
        this.solanaHandler = new SolanaHandler(this.rateLimiter, config.maxPollTimes, config.pollInterval);
        this.evmHandler = new EVMHandler(this.rateLimiter);
        this.polymarketHandler = new PolymarketHandler(
            this.rateLimiter,
            (chain: string, name: string, txData: any) => this.sendTransaction(chain, name, txData)
        );
        this.hyperliquidHandler = new HyperliquidHandler(this.rateLimiter);
        this.jitoHandler = new JitoHandler(this.rateLimiter);
    }

    // Sign and Sends a transaction to blockchains.
    public async signAndSendTransaction(
        txId: string,
        signer: Signer,
        config?: SendConfig,
    ): Promise<{
        hash?: string[],
        error?: any,
        data?: { [key: string]: any },
    }> {
        let address = await getSignerAddress(signer);

        let {
            success,
            type,
            chain,
            data: txData,
            transactions,
            onFailure,
            useJito,
            ...data
        } = config?.txData || await this.buildTransaction(txId, signer);

        if (!transactions || transactions.length === 0) {
            throw new Error('No transactions to send.')
        }

        const jitoDecision = this.jitoHandler.shouldUseJito(
            transactions,
            config?.useJito,
            useJito
        );

        if (jitoDecision.useJito) {
            let jitoClient: JitoClient | QuickNodeJitoClient | undefined;
            try {
                jitoClient = this.jitoHandler.createClient(config);
            } catch (error: any) {
                // explicitly set to use jito, should not fallback to non-jito
                if (config?.useJito || useJito) {
                    throw new Error(`failed to create jito client: ${error.message || error}`);
                }
            }

            if (jitoClient) {
                const jitoResult = await this.jitoHandler.sendTransactions(
                    jitoClient,
                    transactions,
                    signer as SolanaSigner,
                    config,
                    config?.onFailure || onFailure,
                );

                if (jitoResult.hash.length > 0) {
                    try {
                        await this.completeTransaction(txId, jitoResult.hash, address);
                    } catch (error: any) {
                        console.error(`completeTransaction failed: ${error}`);
                    }
                }

                return { hash: jitoResult.hash, error: jitoResult.error };
            }
        }

        let hashes: string[] = [];
        let response: { hash?: string[], data?: any, error?: any } = {};
        let successful: Array<{ index: number, hash: string }> = [];
        let failed: Array<{ index: number, error: string }> = [];

        // Determine onFailure behavior with priority: config.onFailure > data.onFailure > default (stop)
        onFailure = config?.onFailure || onFailure || 'stop';

        for (let i = 0; i < transactions.length; i++) {
            const tx = transactions[i];
            let res: { hash?: string, data?: any } = {};
            try {
                switch (tx.chain) {
                    case 'polygon': // Polygon Mainnet
                        switch (tx.name) {
                            case 'LimitOrder':
                            case 'MarketOrder':
                                res = await this.polymarketHandler.sendOrderTransaction(
                                    signer as EtherSigner | WagmiSigner,
                                    tx,
                                    address,
                                );
                                break;
                            case 'CancelOrder':
                                res = await this.polymarketHandler.sendCancelOrderTransaction(
                                    signer as EtherSigner | WagmiSigner,
                                    tx,
                                    address,
                                );
                                break;
                            case 'GetOpenOrders':
                                res = await this.polymarketHandler.getOpenOrdersTransaction(
                                    signer as EtherSigner | WagmiSigner,
                                    tx,
                                    address,
                                );
                                break;
                            case 'CheckOrderLiquidityReward':
                                res = await this.polymarketHandler.checkOrderLiquidityRewardTransaction(
                                    signer as EtherSigner | WagmiSigner,
                                    tx,
                                    address,
                                );
                                break;
                            default:
                                res = await this.evmHandler.sendTransaction(signer as EtherSigner | WagmiSigner, tx);
                        }
                        break;
                    case 'solana': // Solana
                        res = await this.solanaHandler.sendTransaction(signer as SolanaSigner, tx, config);
                        break;
                    case 'hyperliquid': // hyperliquid orders
                        res = await this.hyperliquidHandler.sendTransaction(signer as EtherSigner | WagmiSigner, tx);
                        break;
                    default: // evm
                        res = await this.evmHandler.sendTransaction(signer as EtherSigner | WagmiSigner, tx);
                }

                if (res?.hash) {
                    hashes.push(res.hash);
                    successful.push({ index: i, hash: res.hash });
                }

                if (res?.data) {
                    data = { ...(data || {}), ...res.data };
                }

                // Only sleep if it's not the last transaction
                if (i < transactions.length - 1) {
                    const interval = config?.txInterval || 2;
                    await new Promise(resolve => setTimeout(resolve, 1000 * interval));
                }
            } catch (error: any) {
                const errorMessage = error.message || error.toString();
                failed.push({ index: i, error: errorMessage });

                if (onFailure === 'skip') {
                    // Continue with next transaction
                    continue;
                } else {
                    // Stop mode: throw error with details
                    const successfulIndices = successful.map(s => s.index + 1);
                    const successfulHashes = successful.map(s => s.hash);
                    const errorDetails = `Transaction ${i + 1} failed: ${errorMessage}`;
                    const fullError = successfulHashes.length > 0
                        ? `${errorDetails}. Transaction ${successfulIndices.join(', ')} are successful: [${successfulHashes.join(', ')}]`
                        : errorDetails;
                    throw new Error(`signAndSendTransaction: ${fullError}`);
                }
            }
        }

        // Handle completion and return logic
        if (hashes.length > 0) {
            try {
                await this.completeTransaction(txId, hashes, address);
            } catch (error: any) {
                console.error(`completeTransaction failed: ${error}`);
            }
        }

        if (onFailure === 'skip') {
            const failedDetails = failed.map(f => `Transaction ${f.index + 1}: ${f.error}`).join('; ');
            // For skip mode, check if all transactions failed
            if (failed.length === transactions.length) {
                throw new Error(`All transactions failed: ${failedDetails}`);
            }
            // Return with error info if there were any failures
            if (failed.length > 0) {
                response.error = `Some transactions failed: ${failedDetails}`;
            }
        }

        if (hashes?.length > 0) {
            response.hash = hashes;
        }

        if (data && Object.keys(data).length > 0) {
            response.data = data;
        }

        return response;
    }
}

import { APIConfig } from '../../common';
import { WagmiSigner, EtherSigner, SolanaSigner, SendConfig, Signer, getSignerAddress } from '../types';
import { createJitoClient, shouldUseJito, JitoConfig, JITO_CONSTANTS, JitoClient } from '../jito';
import { createQuickNodeJitoClient, QuickNodeJitoConfig, QuickNodeJitoClient } from '../jito-quicknode';
import { getSolanaErrorInfo } from '../solana-errors';
import { BaseTransactionAPI } from './base';
import { SolanaHandler } from './solana-handler';
import { EVMHandler } from './evm-handler';
import { PolymarketHandler } from './polymarket-handler';
import { HyperliquidHandler } from './hyperliquid-handler';

export class TransactionAPI extends BaseTransactionAPI {
    private solanaHandler: SolanaHandler;
    private evmHandler: EVMHandler;
    private polymarketHandler: PolymarketHandler;
    private hyperliquidHandler: HyperliquidHandler;

    constructor(config: APIConfig) {
        super(config);
        this.solanaHandler = new SolanaHandler(this.rateLimiter, config.maxPollTimes, config.pollInterval);
        this.evmHandler = new EVMHandler(this.rateLimiter);
        this.polymarketHandler = new PolymarketHandler(
            this.rateLimiter,
            (chain: string, name: string, txData: any) => this.sendTransaction(chain, name, txData)
        );
        this.hyperliquidHandler = new HyperliquidHandler(this.rateLimiter);
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

        const jitoDecision = shouldUseJito(transactions, config?.useJito, useJito);

        if (jitoDecision.useJito) {
            let jitoClient: JitoClient | QuickNodeJitoClient | undefined;
            try {
                jitoClient = this.createJitoClient(config);
            } catch (error: any) {
                // explicitly set to use jito, should not fallback to non-jito
                if (config?.useJito || useJito) {
                    throw new Error(`failed to create jito client: ${error.message || error}`);
                }
            }

            if (jitoClient) {
                return await this.sendJitoTransactions(
                    jitoClient,
                    txId,
                    transactions,
                    signer as SolanaSigner,
                    config,
                    config?.onFailure || onFailure,
                );
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

    private async sendJitoTransactions(
        jitoClient: JitoClient | QuickNodeJitoClient,
        txId: string,
        transactions: any[],
        signer: SolanaSigner,
        config: SendConfig | undefined,
        onFailure: 'skip' | 'stop' = 'stop'
    ): Promise<{ hash: string[], error?: string }> {
        // Validate all transactions are Solana
        const allSolana = transactions.every(tx => tx.chain === 'solana');
        if (!allSolana) {
            throw new Error('Jito can only be used with Solana transactions');
        }

        if (transactions.length === 1) {
            // Single transaction case
            try {
                const result = await jitoClient.sendSingleTransaction(transactions[0], signer);

                // Complete the transaction
                if (result.hash.length > 0) {
                    const address = await getSignerAddress(signer);
                    try {
                        await this.completeTransaction(txId, result.hash, address);
                    } catch (error: any) {
                        console.error(`completeTransaction failed: ${error}`);
                    }
                }

                return { hash: result.hash };
            } catch (error: any) {
                const errorInfo = getSolanaErrorInfo(error);
                throw new Error(`Jito single transaction failed: ${errorInfo.message}`);
            }
        }

        // Bundle case - handle batching with failure tracking
        const allHashes: string[] = [];
        let successful: Array<{ batchIndex: number, hashes: string[] }> = [];
        let failed: Array<{ batchIndex: number, error: string, txCount: number }> = [];

        // Split into batches if needed
        const batches: any[][] = [];
        if (transactions.length <= JITO_CONSTANTS.MAX_BUNDLE_SIZE) {
            batches.push(transactions);
        } else {
            for (let i = 0; i < transactions.length; i += JITO_CONSTANTS.MAX_BUNDLE_SIZE) {
                batches.push(transactions.slice(i, i + JITO_CONSTANTS.MAX_BUNDLE_SIZE));
            }
        }

        // Send each batch
        for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];
            try {
                const result = await jitoClient.sendBundle(batch, signer, config?.rpcUrls);
                allHashes.push(...result.hash);
                successful.push({ batchIndex: i, hashes: result.hash });

                // Add interval between batches (except for the last one)
                if (i < batches.length - 1) {
                    const interval = config?.txInterval || 2;
                    await new Promise(resolve => setTimeout(resolve, 1000 * interval));
                }
            } catch (error: any) {
                const errorInfo = getSolanaErrorInfo(error);
                failed.push({ batchIndex: i, error: errorInfo.message, txCount: batch.length });

                if (onFailure === 'skip') {
                    // Continue with next batch
                    continue;
                } else {
                    // Stop mode: throw error with details
                    const successfulInfo = successful.length > 0
                        ? `Successful batches: ${successful.map(s => `batch ${s.batchIndex + 1} (${s.hashes.length} txns: ${s.hashes.join(', ')})`).join('; ')}`
                        : '';

                    const errorDetails = `Batch ${i + 1}/${batches.length} (${batch.length} transactions) failed: ${errorInfo.message}`;
                    const fullError = successfulInfo
                        ? `${errorDetails}. ${successfulInfo}`
                        : errorDetails;

                    throw new Error(`Jito bundle processing failed: ${fullError}`);
                }
            }
        }

        // Handle completion and results based on onFailure mode
        if (allHashes.length > 0) {
            const address = await getSignerAddress(signer);
            try {
                await this.completeTransaction(txId, allHashes, address);
            } catch (error: any) {
                console.error(`completeTransaction failed: ${error}`);
            }
        }

        if (onFailure === 'skip') {
            // Check if all batches failed
            if (failed.length === batches.length) {
                const failedDetails = failed.map(f => `Batch ${f.batchIndex + 1} (${f.txCount} txns): ${f.error}`).join('; ');
                throw new Error(`All Jito batches failed: ${failedDetails}`);
            }

            // Return with error info if there were any failures
            if (failed.length > 0) {
                const failedDetails = failed.map(f => `Batch ${f.batchIndex + 1} (${f.txCount} txns): ${f.error}`).join('; ');
                const successfulDetails = successful.map(s => `Batch ${s.batchIndex + 1}: ${s.hashes.length} txns`).join(', ');
                const errorInfo = `Some batches failed: ${failedDetails}. Successful: ${successfulDetails}`;
                return { hash: allHashes, error: errorInfo };
            }

            return { hash: allHashes };
        } else {
            // For stop mode, we only reach here if all batches succeeded
            return { hash: allHashes };
        }
    }

    private createJitoClient(config: SendConfig | undefined): JitoClient | QuickNodeJitoClient {
        const jitoProvider = config?.jitoProvider || 'quicknode';
        if (jitoProvider === 'jito') {
            const jitoConfig: JitoConfig = {
                jitoEndpoint: config?.jitoEndpoint,
                apiKey: config?.jitoApiKey,
                tipAmount: config?.jitoTipAmount,
                rateLimiter: this.rateLimiter,
            };
            return createJitoClient(jitoConfig);
        } else {
            let endpoint = config?.jitoEndpoint;
            if (!endpoint && config?.rpcUrls?.length) {
                endpoint = config.rpcUrls.find(url => url.includes('quiknode.pro'));
            }

            const quickNodeConfig: QuickNodeJitoConfig = {
                endpoint: endpoint,
                tipAmount: config?.jitoTipAmount,
                rateLimiter: this.rateLimiter,
            };
            return createQuickNodeJitoClient(quickNodeConfig);
        }
    }
}

import { API, APIConfig, TRANSACTION_API_ENDPOINT } from '../common';
import { ActionContext } from './context';
import { WagmiSigner, EtherSigner, SolanaSigner, SendConfig, isEtherSigner, isSolanaSigner, isWagmiSigner, Signer } from './types';
import { ethers, toBeHex } from "ethers";
import * as web3 from '@solana/web3.js';
import { OrderType, ApiKeyCreds, } from "@polymarket/clob-client";
import { SignedOrder } from "@polymarket/order-utils";
import { orderToJson } from "@polymarket/clob-client/dist/utilities";
import { JsonRpcSigner } from "@ethersproject/providers";
import { Wallet } from "@ethersproject/wallet";
import { deriveApiKey } from "./polymarket/apikey"
import { createL2Headers } from "./polymarket/l2header"
import { createJitoClient, shouldUseJito, JitoConfig, JITO_CONSTANTS, JitoClient } from './jito';
import { createQuickNodeJitoClient, QuickNodeJitoConfig, QuickNodeJitoClient } from './jito-quicknode';
import { getSolanaErrorInfo } from './solana-errors';
import { signL1Action } from "@nktkas/hyperliquid/signing";

const DEFAULT_POLL_INTERVAL = 6000;
const DEFAULT_MAX_POLL_TIMES = 20;

export class TransactionAPI extends API {
    constructor(config: APIConfig) {
        if (!config.endpoint) {
            config.endpoint = TRANSACTION_API_ENDPOINT;
        }
        super(config);
    }

    public async createTransaction(type: string, ctx: ActionContext, payload: any = {}) {
        const data = {
            agentId: ctx.agentId,
            actionId: ctx.actionId,
            actionName: ctx.actionName,
            type,
            payload,
        }
        return await this.request('POST', `/tx/create`, { json: data, timeout: 60000 });
    }

    public async buildTransaction(txId: string, signerOrAddress: Signer | string) {
        let address = typeof signerOrAddress === 'string' ? signerOrAddress : await this.getAddress(signerOrAddress);
        let buildBody = { txId, address };
        let data = await this.request('POST', `/tx/build`, { json: buildBody, timeout: 60000 });
        if (!data.success) {
            throw data.error
        }
        return data
    }

    public async completeTransaction(txId: string, txHash: string[], address: string) {
        let completeBody = { txId, txHash: txHash.join(','), address };
        let data = await this.request('POST', `/tx/complete`, { json: completeBody });
        if (data.success || data.message === 'Transaction completed successfully') {
            return data;
        }
        throw new Error(data.error || 'Transaction completion failed');
    }

    public async getTransaction(txId: string) {
        let data = await this.request('GET', `/tx/get/${txId}`);
        if (data.error) {
            throw new Error(data.error)
        }
        return data
    }

    public async sendTransaction(chain: string, name: string, txData: any) {
        txData.chain = chain
        txData.name = name
        const data = await this.request('POST', `/tx/sendtransaction`, {
            json: txData,
        })
        if (!data.success) {
            throw data.error
        }
        return data
    }

    // Sign and Sends a transaction to blockchains.
    public async signAndSendTransaction(txId: string, signer: Signer, config?: SendConfig):
        Promise<{ hash?: string[], error?: any }> {
        let address = await this.getAddress(signer);

        let data = config?.txData || await this.buildTransaction(txId, signer);

        const transactions = data.transactions
        if (!transactions || transactions.length === 0) {
            throw new Error('No transactions to send.')
        }

        const jitoDecision = shouldUseJito(transactions, config?.useJito, data.useJito);

        if (jitoDecision.useJito) {
            let jitoClient: JitoClient | QuickNodeJitoClient | undefined;
            try {
                jitoClient = this.createJitoClient(config);
            } catch (error: any) {
                // explicitly set to use jito, should not fallback to non-jito
                if (config?.useJito || data.useJito) {
                    throw new Error(`failed to create jito client: ${error.message || error}`);
                }
            }

            if (jitoClient) {
                return await this.sendJitoTransactions(
                    jitoClient,
                    txId,
                    transactions,
                    signer as SolanaSigner,
                    config, config?.onFailure || data.onFailure,
                );
            }
        }

        let res;
        let hashes: string[] = [];
        let successful: Array<{ index: number, hash: string }> = [];
        let failed: Array<{ index: number, error: string }> = [];

        // Determine onFailure behavior with priority: config.onFailure > data.onFailure > default (stop)
        const onFailure = config?.onFailure || data.onFailure || 'stop';

        for (let i = 0; i < transactions.length; i++) {
            const tx = transactions[i];
            try {
                switch (tx.chain) {
                    case 'polygon': // Polygon Mainnet
                        switch (tx.name) {
                            case 'MarketOrder':
                                let conf: SendConfig = config || {}
                                if (!config || !config.proxyUrl) { // if not set, then use apiUri, it's transaction builder.
                                    conf.proxyUrl = this.apiUri
                                }
                                res = await this.polymarketSendTransaction(signer as EtherSigner | WagmiSigner,
                                    tx, conf, address);
                                break;
                            default:
                                res = await this.evmSendTransaction(signer as EtherSigner | WagmiSigner, tx);
                        }
                        break;
                    case 'solana': // Solana
                        res = await this.solSendTransaction(signer as SolanaSigner, tx, config);
                        break;
                    case 'hyperliquid': // hyperliquid orders
                        res = await this.hyperliquidSendTransaction(signer as EtherSigner | WagmiSigner, tx);
                        break;

                    default: // evm
                        res = await this.evmSendTransaction(signer as EtherSigner | WagmiSigner, tx);
                }

                if (res.hash) {
                    hashes.push(res.hash);
                    successful.push({ index: i, hash: res.hash });
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
                const errorInfo = `Some transactions failed: ${failedDetails}.`;
                return { hash: hashes, error: errorInfo };
            }
            return { hash: hashes };
        } else {
            // For stop mode, we only reach here if all transactions succeeded
            return { hash: hashes };
        }
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
                    const address = await this.getAddress(signer);
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
            const address = await this.getAddress(signer);
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
            };
            return createJitoClient(jitoConfig);
        } else {
            // For QuickNode: use jitoEndpoint if set, otherwise find QuickNode RPC from rpcUrls
            let endpoint = config?.jitoEndpoint;
            if (!endpoint && config?.rpcUrls?.length) {
                // Try to find a QuickNode URL
                endpoint = config.rpcUrls.find(url => url.includes('quiknode.pro'));
            }

            const quickNodeConfig: QuickNodeJitoConfig = {
                endpoint: endpoint,
                tipAmount: config?.jitoTipAmount,
            };
            return createQuickNodeJitoClient(quickNodeConfig);
        }
    }

    // ------------------------------------------------
    // the following are private members.
    // ------------------------------------------------

    private async getAddress(signer: Signer) {
        let address: string = '';

        if (isEtherSigner(signer)) {
            address = (signer as EtherSigner).address; // ethers signer
        } else if (isSolanaSigner(signer)) {
            address = (signer as SolanaSigner).publicKey.toBase58(); // solana provider
        } else if (isWagmiSigner(signer)) { // wagmi wallet
            const addresses = await (signer as WagmiSigner).getAddresses(); // ethers signer with getAddresses method
            if (addresses.length > 0) {
                address = addresses[0]; // Use the first address
            }
        } else {
            throw new Error('Signer does not have an address or publicKey.');
        }

        return address;
    }

    private async evmSendTransaction(signer: EtherSigner | WagmiSigner, tx: any): Promise<{ hash: string | undefined }> {
        try {
            const unsignedTx = ethers.Transaction.from(tx.hex); // Validate the transaction format

            const txParams: any = {
                to: unsignedTx.to ? unsignedTx.to : ethers.ZeroAddress,
            };
            if (unsignedTx.data) { txParams.data = unsignedTx.data; }
            if (unsignedTx.value) { txParams.value = toBeHex(unsignedTx.value); }
            if (unsignedTx.gasLimit) { txParams.gasLimit = toBeHex(unsignedTx.gasLimit); }
            if (unsignedTx.maxFeePerGas) { txParams.maxFeePerGas = toBeHex(unsignedTx.maxFeePerGas); }
            if (unsignedTx.maxPriorityFeePerGas) { txParams.maxPriorityFeePerGas = toBeHex(unsignedTx.maxPriorityFeePerGas); }

            if (signer.sendTransaction) {
                let txResponse: any;
                let hash: string;
                try {
                    txResponse = await signer.sendTransaction(txParams);
                    hash = typeof txResponse === 'string' ? txResponse : txResponse.hash;
                    if (!hash) {
                        throw new Error('Transaction response does not contain a hash');
                    }
                } catch (error: any) {
                    throw new Error(`signer.sendTransaction: ${error}`);
                }

                let receipt: any
                if (isWagmiSigner(signer)) {
                    const s = signer as WagmiSigner
                    if (s.waitForTransactionReceipt) {
                        receipt = await s.waitForTransactionReceipt({ hash });
                        if (receipt.status != 'success') {
                            throw new Error('transaction reverted')
                        }
                    }
                } else if (isEtherSigner(signer)) {
                    if (typeof txResponse.wait === 'function') {
                        receipt = await txResponse.wait()
                        if (!receipt || receipt.status == 0) {
                            throw new Error('transaction reverted')
                        }
                    } else {
                        console.log('txResponse: ', txResponse);
                        throw new Error('Transaction response does not have wait method');
                    }
                }

                return { hash: hash };
            } else {
                throw new Error('Signer should have sendTransaction method for evm.');
            }

        } catch (error) {
            throw new Error(`evmSendTransaction: ${error}`);
        }
    }

    private async solSendTransaction(signer: SolanaSigner, tx: any, config?: SendConfig): Promise<{ hash: string | undefined }> {
        try {
            const transactionBuffer = new Uint8Array(
                atob(tx.base64)
                    .split('')
                    .map((c) => c.charCodeAt(0)),
            );

            let transaction;
            if (tx.type === 'legacy') {
                transaction = web3.Transaction.from(transactionBuffer);
            } else {
                transaction = web3.VersionedTransaction.deserialize(transactionBuffer);
            }

            const signedTransaction = await signer.signTransaction(transaction);

            const serializedTransaction = Buffer.from(signedTransaction.serialize());

            let lastError: Error | null = null;
            let connection: web3.Connection | null = null;
            let signature: string | null = null;
            const successfulTransactions: { type: string; hash: string }[] = [];

            let rpcUrls = config?.rpcUrls && config.rpcUrls.length > 0 ? config.rpcUrls : [web3.clusterApiUrl('mainnet-beta')];
            for (const rpcUrl of rpcUrls) {
                try {
                    connection = new web3.Connection(rpcUrl, 'confirmed');
                    signature = await connection.sendRawTransaction(serializedTransaction);
                    if (signature) {
                        successfulTransactions.push({
                            type: tx.type,
                            hash: signature,
                        });
                    }
                    break;

                } catch (error) {
                    console.error(`Error sending transaction to ${rpcUrl}:`, error);
                    lastError = error as Error;
                    continue;
                }
            }

            if (lastError && successfulTransactions.length === 0) {
                const errorInfo = getSolanaErrorInfo(lastError);
                throw new Error(`${errorInfo.message}, set RPC URLs when calling signAndSendTransaction`);
            }

            if (!connection || !signature) {
                throw new Error('Failed to establish connection or get signature');
            }

            const finalConnection = connection;
            const abortController = new AbortController();
            let pollResult = this.solPollTransactionStatus(finalConnection, signature, DEFAULT_MAX_POLL_TIMES, DEFAULT_POLL_INTERVAL, abortController.signal);
            let wsResult = this.solWaitTransactionConfirmed(finalConnection, signature, signedTransaction);

            try {
                let result: any = await Promise.race([pollResult, wsResult]);
                if (result?.value?.err) {
                    const errorInfo = getSolanaErrorInfo(result.value.err);
                    throw new Error(`transaction ${signature} failed: ${errorInfo.message}`);
                }
            } catch (error) {
                throw new Error(`Error confirming transaction: ${error}`)
            } finally {
                abortController.abort();
            }

            return { hash: signature }
        } catch (error) {
            const errorInfo = getSolanaErrorInfo(error);
            throw new Error(`solSendTransaction: ${errorInfo.message}`);
        }
    }

    private async solPollTransactionStatus(
        connection: web3.Connection,
        signature: string,
        maxPollTimes: number = DEFAULT_MAX_POLL_TIMES,
        pollInterval: number = DEFAULT_POLL_INTERVAL,
        signal?: AbortSignal
    ): Promise<any> {
        for (let pollTimes = 0; pollTimes < maxPollTimes; pollTimes++) {
            await new Promise(resolve => setTimeout(resolve, pollInterval));

            if (signal?.aborted) {
                throw new Error('Polling aborted');
            }

            let err: any = null;
            try {
                const status = await connection.getSignatureStatus(signature, {
                    searchTransactionHistory: true,
                })

                if (['confirmed', 'finalized'].includes(status?.value?.confirmationStatus || '')) {
                    return status;
                }
            } catch (error) {
                err = error;
            }

            if (pollTimes >= maxPollTimes - 1) {
                throw err || new Error('Transaction not confirmed, please check solana explorer.');
            }
        }
    }

    private async solWaitTransactionConfirmed(
        connection: web3.Connection,
        signature: string,
        signedTransaction: any,
    ): Promise<any> {
        const blockhash = await connection.getLatestBlockhash();
        if (signedTransaction instanceof web3.Transaction) {
            return await connection.confirmTransaction(
                {
                    signature: signature,
                    blockhash: signedTransaction.recentBlockhash ?? blockhash.blockhash,
                    lastValidBlockHeight:
                        signedTransaction.lastValidBlockHeight ?? blockhash.lastValidBlockHeight,
                },
                'confirmed',
            );
        } else {
            return await connection.confirmTransaction(
                {
                    signature: signature,
                    blockhash: signedTransaction._message?.recentBlockhash ?? blockhash.blockhash,
                    lastValidBlockHeight: signedTransaction.lastValidBlockHeight ?? blockhash.lastValidBlockHeight,
                },
                'confirmed',
            );
        }
    }

    private async polymarketSendTransaction(signer: EtherSigner | WagmiSigner, tx: any,
        config: SendConfig, address: string): Promise<{ hash: string | undefined, orderId?: string }> {
        try {
            let data = JSON.parse(tx.hex)
            let od = data.data
            let orderData = od.orderData
            let typedData = od.typedData
            let orderType = od.orderType || OrderType.FAK; // FOK

            const { signature: existingSignature, ...cleanOrderData } = orderData;
            let signature: string;

            if (isWagmiSigner(signer)) { // wagmi wallet
                const s = signer as WagmiSigner
                signature = await s.signTypedData({
                    account: s.account,
                    domain: typedData.domain,
                    types: typedData.types,
                    primaryType: typedData.primaryType,
                    message: cleanOrderData
                });
            } else if (signer.signTypedData) { // ethers wallet
                const typesCopy = { ...typedData.types };
                delete typesCopy.EIP712Domain;
                signature = await signer.signTypedData(typedData.domain, typesCopy, cleanOrderData);
            } else {
                throw new Error("Signer doesn't have signTypedData");
            }
            orderData.signature = signature;

            const creds = await deriveApiKey(address, signer)
            if (!creds) {
                throw new Error('Failed to derive API key for Polymarket');
            }

            const res = await this.polymarketPostOrder(signer, orderData, orderType, creds, config)
            if (res.error) {
                throw new Error(`polymarketPostOrder error: ${res.error}`)
            } else {
                let hash = res.transactionHash || res.transactionsHashes?.[0]
                return { hash: hash, orderId: res.orderId } // orderId is polymarket specific
            }

        } catch (error) {
            throw new Error(`polymarketSendTransaction: ${error}`)
        }
    }

    private async polymarketPostOrder<T extends OrderType = OrderType.GTC>(
        signer: any, order: SignedOrder,
        orderType: T = OrderType.GTC as T,
        creds: ApiKeyCreds, config: SendConfig
    ): Promise<any> {
        if (!config.proxyUrl) {
            throw new Error('polymarketSendTransaction needs to config proxy url.')
        }

        const endpoint = "/order"
        const orderPayload = orderToJson(order, creds?.key || "", orderType);

        const l2HeaderArgs = {
            method: "POST",
            requestPath: endpoint,
            body: JSON.stringify(orderPayload),
        };

        const headers = await createL2Headers(
            signer as Wallet | JsonRpcSigner,
            creds as ApiKeyCreds,
            l2HeaderArgs,
        );

        const data = { headers, data: orderPayload }
        const res = await this.sendTransaction("polygon", "MarketOrder", data)

        return res
    }

    private async hyperliquidSendTransaction(signer: EtherSigner | WagmiSigner, tx: any): Promise<{ hash: string | undefined }> {
        const url = 'https://api.hyperliquid.xyz/exchange'
        try {
            const order = JSON.parse(tx.order);

            const signature = await signL1Action({
                wallet: signer,
                action: order.action,
                nonce: order.nonce,
            });

            const response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: order.action, signature, nonce: order.nonce }), // recommended to send the same formatted action
            });

            const responseClone = response.clone();
            let res: any;
            try {
                res = await response.json();
            } catch (error) {
                res = await responseClone.text();
                throw new Error(res);
            }

            let hash = '';
            if (res.response && res.response.data && res.response.data.statuses && res.response.data.statuses.length > 0) {
                if (res.response.data.statuses[0].resting && res.response.data.statuses[0].resting.oid) {
                    hash = res.response.data.statuses[0].resting.oid;
                } else {
                    hash = JSON.stringify(res.response.data.statuses[0])
                }
            } else if (res.status == 'ok') {
                hash = res.status;
            } else { // res.status == 'err'
                throw new Error(res.response);
            } 

            return { hash: hash };

        } catch (error) {
            throw new Error(`hyperliquidSendTransaction: ${error}`);
        }
    }

}

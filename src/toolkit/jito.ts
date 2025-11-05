import * as web3 from '@solana/web3.js';
import { JitoJsonRpcClient } from 'jito-js-rpc';
import { SolanaSigner } from './types';
import { RateLimiter } from '../common/rate-limiter';

export interface JitoConfig {
    jitoEndpoint?: string;
    apiKey?: string;
    tipAmount?: number;
    rateLimiter?: RateLimiter;
}

export const JITO_CONSTANTS = {
    DEFAULT_ENDPOINT: 'https://mainnet.block-engine.jito.wtf/api/v1',
    DEFAULT_TIP_AMOUNT: 1000, // lamports
    DEFAULT_API_KEY: '',
    BUNDLE_TIMEOUT: 120000, // 120 seconds
    MAX_BUNDLE_SIZE: 5,
};

export class JitoClient {
    private client: JitoJsonRpcClient;
    private config: JitoConfig;
    private rateLimiter?: RateLimiter;

    constructor(config: JitoConfig = {}) {
        this.config = {
            jitoEndpoint: config.jitoEndpoint || JITO_CONSTANTS.DEFAULT_ENDPOINT,
            apiKey: config.apiKey || JITO_CONSTANTS.DEFAULT_API_KEY,
            tipAmount: config.tipAmount || JITO_CONSTANTS.DEFAULT_TIP_AMOUNT,
            rateLimiter: config.rateLimiter,
        };

        this.rateLimiter = config.rateLimiter;
        this.client = new JitoJsonRpcClient(this.config.jitoEndpoint!, this.config.apiKey!);
    }

    private getConnection(rpcUrls?: string[]): web3.Connection {
        if (!rpcUrls || rpcUrls.length === 0) {
            return new web3.Connection(web3.clusterApiUrl('mainnet-beta'), 'confirmed');
        }
        // Use the first RPC URL from the provided list
        return new web3.Connection(rpcUrls[0], 'confirmed');
    }

    async sendBundle(transactions: any[], signer: SolanaSigner, rpcUrls?: string[]): Promise<{ hash: string[] }> {
        let currentStep = 'initialization';
        try {
            if (transactions.length === 0) {
                throw new Error('No transactions to bundle');
            }

            if (transactions.length > JITO_CONSTANTS.MAX_BUNDLE_SIZE) {
                throw new Error(`Bundle size exceeds maximum of ${JITO_CONSTANTS.MAX_BUNDLE_SIZE} transactions`);
            }

            currentStep = 'getting tip account';
            await this.rateLimiter?.waitForLimit('jito_getRandomTipAccount');
            const randomTipAccount = await this.client.getRandomTipAccount();
            const jitoTipAccount = new web3.PublicKey(randomTipAccount);

            // Get signer's public key
            const signerPublicKey = new web3.PublicKey(signer.publicKey.toBase58());

            currentStep = 'preparing transactions';
            // Prepare all transactions for signing
            const unsignedTransactions: (web3.Transaction | web3.VersionedTransaction)[] = [];

            for (const tx of transactions) {
                const transactionBuffer = new Uint8Array(
                    atob(tx.base64)
                        .split('')
                        .map((c) => c.charCodeAt(0))
                );

                let transaction: web3.Transaction | web3.VersionedTransaction;
                if (tx.type === 'legacy') {
                    transaction = web3.Transaction.from(transactionBuffer);
                } else {
                    transaction = web3.VersionedTransaction.deserialize(transactionBuffer);
                }

                // Add Jito tip to the last transaction in the bundle
                if (transactions.indexOf(tx) === transactions.length - 1) {
                    if (transaction instanceof web3.Transaction) {
                        // Add tip instruction to legacy transaction
                        transaction.add(
                            web3.SystemProgram.transfer({
                                fromPubkey: signerPublicKey,
                                toPubkey: jitoTipAccount,
                                lamports: this.config.tipAmount!,
                            })
                        );
                    }
                    // For versioned transactions, we don't modify them as they're already built
                }

                unsignedTransactions.push(transaction);
            }

            currentStep = 'signing transactions';
            // Sign all transactions (batch or individual)
            let signedTransactions: (web3.Transaction | web3.VersionedTransaction)[];
            if (signer.signAllTransactions && unsignedTransactions.length > 1) {
                await this.rateLimiter?.waitForLimit('solana_signAllTransactions');
                signedTransactions = await signer.signAllTransactions(unsignedTransactions);
            } else {
                signedTransactions = [];
                for (const transaction of unsignedTransactions) {
                    await this.rateLimiter?.waitForLimit('solana_signTransaction');
                    const signedTransaction = await signer.signTransaction(transaction);
                    signedTransactions.push(signedTransaction);
                }
            }

            currentStep = 'serializing transactions';
            // Convert signed transactions to base64
            const base64SignedTransactions: string[] = signedTransactions.map(signedTx => {
                const serializedTransaction = Buffer.from(signedTx.serialize());
                return serializedTransaction.toString('base64');
            });

            currentStep = 'sending bundle to Jito';
            await this.rateLimiter?.waitForLimit('jito_sendBundle');
            const result = await this.client.sendBundle([base64SignedTransactions, { encoding: 'base64' }]);
            const bundleId = result.result;

            if (!bundleId) {
                throw new Error('Failed to get bundle ID from Jito response');
            }

            currentStep = 'confirming bundle';
            await this.rateLimiter?.waitForLimit('jito_confirmInflightBundle');
            const inflightStatus = await this.client.confirmInflightBundle(bundleId, JITO_CONSTANTS.BUNDLE_TIMEOUT);

            currentStep = 'retrieving transaction hashes';
            if ('confirmation_status' in inflightStatus && inflightStatus.confirmation_status === 'confirmed') {
                // Retry logic with exponential backoff to retrieve transaction hashes
                const maxRetries = 3;
                let lastError: Error | undefined;

                for (let attempt = 0; attempt < maxRetries; attempt++) {
                    try {
                        // Exponential backoff: 1s, 2s, 4s
                        const waitTime = 1000 * Math.pow(2, attempt);
                        await new Promise(resolve => setTimeout(resolve, waitTime));

                        await this.rateLimiter?.waitForLimit('jito_getBundleStatuses');
                        const finalStatus = await this.client.getBundleStatuses([[bundleId]]);

                        if (finalStatus.result?.value?.[0]?.transactions) {
                            return { hash: finalStatus.result.value[0].transactions };
                        }

                        // Fallback: try to extract from inflight status if available
                        if ('transactions' in inflightStatus && inflightStatus.transactions) {
                            return { hash: inflightStatus.transactions };
                        }
                    } catch (error) {
                        lastError = error instanceof Error ? error : new Error(String(error));
                        console.error(`Attempt ${attempt + 1}/${maxRetries} failed to retrieve transaction hashes:`, error);
                    }
                }

                throw new Error(`Could not retrieve transaction hashes from bundle after ${maxRetries} attempts${lastError ? `: ${lastError.message}` : ''}`);
            } else if ('err' in inflightStatus && inflightStatus.err) {
                throw new Error(`Bundle processing failed: ${JSON.stringify(inflightStatus.err)}`);
            } else {
                throw new Error('Bundle failed to confirm within timeout');
            }

        } catch (error: any) {
            // Log stack trace for debugging (server-side logs only)
            if (error && typeof error === 'object' && error.stack) {
                console.error(`Jito bundle error stack trace at step '${currentStep}':`, error.stack);
            }

            // Extract detailed error information for client
            let errorDetails = '';

            if (error && typeof error === 'object') {
                // Try to capture response details from fetch errors
                if (error.response) {
                    errorDetails = `HTTP ${error.response.status || 'error'}`;
                    if (error.response.statusText) {
                        errorDetails += ` ${error.response.statusText}`;
                    }
                    if (error.response.data) {
                        try {
                            errorDetails += ` | Response: ${JSON.stringify(error.response.data)}`;
                        } catch {
                            errorDetails += ` | Response: ${String(error.response.data)}`;
                        }
                    }
                }
                // Capture error message
                if (error.message) {
                    errorDetails += errorDetails ? ` | ${error.message}` : error.message;
                }
                // Capture error code if present
                if (error.code) {
                    errorDetails += ` | Code: ${error.code}`;
                }
                // If we have a full error object, try to serialize it
                if (!errorDetails && error !== null) {
                    try {
                        errorDetails = JSON.stringify(error);
                    } catch {
                        errorDetails = String(error);
                    }
                }
            } else {
                errorDetails = String(error);
            }

            throw new Error(`Jito bundle send failed at step '${currentStep}': ${errorDetails}`);
        }
    }

    async sendSingleTransaction(transaction: any, signer: SolanaSigner, rpcUrls?: string[]): Promise<{ hash: string[] }> {
        let currentStep = 'initialization';
        try {
            const connection = this.getConnection(rpcUrls);

            currentStep = 'getting tip account';
            await this.rateLimiter?.waitForLimit('jito_getRandomTipAccount');
            const randomTipAccount = await this.client.getRandomTipAccount();
            const jitoTipAccount = new web3.PublicKey(randomTipAccount);

            const signerPublicKey = new web3.PublicKey(signer.publicKey.toBase58());

            currentStep = 'deserializing transaction';
            const transactionBuffer = new Uint8Array(
                atob(transaction.base64)
                    .split('')
                    .map((c) => c.charCodeAt(0))
            );

            let tx: web3.Transaction | web3.VersionedTransaction;
            if (transaction.type === 'legacy') {
                tx = web3.Transaction.from(transactionBuffer);

                // Add Jito tip instruction for legacy transactions
                (tx as web3.Transaction).add(
                    web3.SystemProgram.transfer({
                        fromPubkey: signerPublicKey,
                        toPubkey: jitoTipAccount,
                        lamports: this.config.tipAmount!,
                    })
                );
            } else {
                tx = web3.VersionedTransaction.deserialize(transactionBuffer);
            }

            currentStep = 'signing transaction';
            await this.rateLimiter?.waitForLimit('solana_signTransaction');
            const signedTransaction = await signer.signTransaction(tx);
            const serializedTransaction = Buffer.from(signedTransaction.serialize());
            const base64Transaction = serializedTransaction.toString('base64');

            currentStep = 'sending transaction to Jito';
            await this.rateLimiter?.waitForLimit('jito_sendTxn');
            const result = await this.client.sendTxn([base64Transaction, { encoding: 'base64' }], false);
            const signature = result.result;

            if (!signature) {
                throw new Error('Failed to get transaction signature from Jito response');
            }

            currentStep = 'waiting for confirmation';
            // Wait for confirmation
            let retries = 0;
            const maxRetries = 60; // 60 seconds

            while (retries < maxRetries) {
                await this.rateLimiter?.waitForLimit('solana_getSignatureStatus');
                const status = await connection.getSignatureStatus(signature);
                if (status.value?.confirmationStatus === 'finalized' || status.value?.confirmationStatus === 'confirmed') {
                    return { hash: [signature] }; // Return as array for consistency
                }

                if (status.value?.err) {
                    throw new Error(`Transaction failed: ${JSON.stringify(status.value.err)}`);
                }

                await new Promise(resolve => setTimeout(resolve, 1000));
                retries++;
            }

            throw new Error('Transaction failed to confirm within timeout');

        } catch (error: any) {
            // Log stack trace for debugging (server-side logs only)
            if (error && typeof error === 'object' && error.stack) {
                console.error(`Jito single transaction error stack trace at step '${currentStep}':`, error.stack);
            }

            // Extract detailed error information for client
            let errorDetails = '';

            if (error && typeof error === 'object') {
                // Try to capture response details from fetch errors
                if (error.response) {
                    errorDetails = `HTTP ${error.response.status || 'error'}`;
                    if (error.response.statusText) {
                        errorDetails += ` ${error.response.statusText}`;
                    }
                    if (error.response.data) {
                        try {
                            errorDetails += ` | Response: ${JSON.stringify(error.response.data)}`;
                        } catch {
                            errorDetails += ` | Response: ${String(error.response.data)}`;
                        }
                    }
                }
                // Capture error message
                if (error.message) {
                    errorDetails += errorDetails ? ` | ${error.message}` : error.message;
                }
                // Capture error code if present
                if (error.code) {
                    errorDetails += ` | Code: ${error.code}`;
                }
                // If we have a full error object, try to serialize it
                if (!errorDetails && error !== null) {
                    try {
                        errorDetails = JSON.stringify(error);
                    } catch {
                        errorDetails = String(error);
                    }
                }
            } else {
                errorDetails = String(error);
            }

            throw new Error(`Jito single transaction send failed at step '${currentStep}': ${errorDetails}`);
        }
    }
}

export function createJitoClient(config?: JitoConfig): JitoClient {
    return new JitoClient(config);
}

export function shouldUseJito(
    transactions: any[],
    configUseJito?: boolean,
    dataUseJito?: boolean
): { useJito: boolean } {
    // Check if all transactions are Solana
    const allSolana = transactions.every(tx => tx.chain === 'solana');
    
    if (!allSolana) {
        return { useJito: false }; // Don't use Jito if not all transactions are Solana
    }

    // Priority: config.useJito > data.useJito > default
    let shouldUseJito = false;
    if (configUseJito !== undefined) {
        shouldUseJito = configUseJito;
    } else if (dataUseJito !== undefined) {
        shouldUseJito = dataUseJito;
    } else {
        // Default: use Jito for multiple Solana transactions
        shouldUseJito = transactions.length > 1;
    }

    if (!shouldUseJito) {
        return { useJito: false };
    }

    return { useJito: true };
}
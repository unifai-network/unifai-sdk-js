import * as web3 from '@solana/web3.js';
import { JitoJsonRpcClient } from 'jito-js-rpc';
import { SolanaSigner } from './types';

export interface JitoConfig {
    jitoEndpoint?: string;
    apiKey?: string;
    tipAmount?: number;
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

    constructor(config: JitoConfig = {}) {
        this.config = {
            jitoEndpoint: config.jitoEndpoint || JITO_CONSTANTS.DEFAULT_ENDPOINT,
            apiKey: config.apiKey || JITO_CONSTANTS.DEFAULT_API_KEY,
            tipAmount: config.tipAmount || JITO_CONSTANTS.DEFAULT_TIP_AMOUNT,
        };
        
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
        try {
            if (transactions.length === 0) {
                throw new Error('No transactions to bundle');
            }

            if (transactions.length > JITO_CONSTANTS.MAX_BUNDLE_SIZE) {
                throw new Error(`Bundle size exceeds maximum of ${JITO_CONSTANTS.MAX_BUNDLE_SIZE} transactions`);
            }

            const randomTipAccount = await this.client.getRandomTipAccount();
            const jitoTipAccount = new web3.PublicKey(randomTipAccount);
            
            // Get signer's public key
            const signerPublicKey = new web3.PublicKey(signer.publicKey.toBase58());

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

            // Sign all transactions (batch or individual)
            let signedTransactions: (web3.Transaction | web3.VersionedTransaction)[];
            if (signer.signAllTransactions && unsignedTransactions.length > 1) {
                // Use signAllTransactions for batch signing when available
                signedTransactions = await signer.signAllTransactions(unsignedTransactions);
            } else {
                // Fallback to individual signing
                signedTransactions = [];
                for (const transaction of unsignedTransactions) {
                    const signedTransaction = await signer.signTransaction(transaction);
                    signedTransactions.push(signedTransaction);
                }
            }

            // Convert signed transactions to base64
            const base64SignedTransactions: string[] = signedTransactions.map(signedTx => {
                const serializedTransaction = Buffer.from(signedTx.serialize());
                return serializedTransaction.toString('base64');
            });

            // Send the bundle
            const result = await this.client.sendBundle([base64SignedTransactions, { encoding: 'base64' }]);
            const bundleId = result.result;

            if (!bundleId) {
                throw new Error('Failed to get bundle ID from Jito response');
            }

            // Wait for confirmation
            const inflightStatus = await this.client.confirmInflightBundle(bundleId, JITO_CONSTANTS.BUNDLE_TIMEOUT);
            
            if ('confirmation_status' in inflightStatus && inflightStatus.confirmation_status === 'confirmed') {
                // Get all transaction hashes from the bundle
                const finalStatus = await this.client.getBundleStatuses([[bundleId]]);
                
                if (finalStatus.result?.value?.[0]?.transactions) {
                    return { hash: finalStatus.result.value[0].transactions };
                }
                
                // Fallback: try to extract from inflight status if available
                if ('transactions' in inflightStatus && inflightStatus.transactions) {
                    return { hash: inflightStatus.transactions };
                }
                
                throw new Error('Could not retrieve transaction hashes from bundle');
            } else if ('err' in inflightStatus && inflightStatus.err) {
                throw new Error(`Bundle processing failed: ${JSON.stringify(inflightStatus.err)}`);
            } else {
                throw new Error('Bundle failed to confirm within timeout');
            }

        } catch (error) {
            throw new Error(`Jito bundle send failed: ${error}`);
        }
    }

    async sendSingleTransaction(transaction: any, signer: SolanaSigner, rpcUrls?: string[]): Promise<{ hash: string[] }> {
        try {
            const connection = this.getConnection(rpcUrls);
            const randomTipAccount = await this.client.getRandomTipAccount();
            const jitoTipAccount = new web3.PublicKey(randomTipAccount);
            
            const signerPublicKey = new web3.PublicKey(signer.publicKey.toBase58());

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

            // Sign the transaction
            const signedTransaction = await signer.signTransaction(tx);
            const serializedTransaction = Buffer.from(signedTransaction.serialize());
            const base64Transaction = serializedTransaction.toString('base64');

            // Send using Jito's sendTxn method
            const result = await this.client.sendTxn([base64Transaction, { encoding: 'base64' }], false);
            const signature = result.result;

            if (!signature) {
                throw new Error('Failed to get transaction signature from Jito response');
            }

            // Wait for confirmation
            let retries = 0;
            const maxRetries = 60; // 60 seconds
            
            while (retries < maxRetries) {
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

        } catch (error) {
            throw new Error(`Jito single transaction send failed: ${error}`);
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
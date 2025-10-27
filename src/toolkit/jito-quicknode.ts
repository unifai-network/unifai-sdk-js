import * as web3 from '@solana/web3.js';
import { SolanaSigner } from './types';

export interface QuickNodeJitoConfig {
    endpoint?: string;
    tipAmount?: number;
    pollIntervalMs?: number;
    pollTimeoutMs?: number;
    defaultWaitBeforePollMs?: number;
}

export const QUICKNODE_JITO_CONSTANTS = {
    DEFAULT_TIP_AMOUNT: 1000, // lamports
    DEFAULT_POLL_INTERVAL_MS: 3000,
    DEFAULT_POLL_TIMEOUT_MS: 120000,
    DEFAULT_WAIT_BEFORE_POLL_MS: 5000,
    BUNDLE_TIMEOUT: 120000, // 120 seconds
    MAX_BUNDLE_SIZE: 5,
    MINIMUM_JITO_TIP: 1000, // lamports
    DEFAULT_RPC_RETRIES: 3,
    DEFAULT_RPC_RETRY_DELAY_MS: 2000,
};

export interface RpcCallConfig {
    retries?: number;
    retryDelayMs?: number;
}

// QuickNode Lil' JIT API types
interface JitoBundleSimulationResponse {
    context: {
        apiVersion: string;
        slot: number;
    };
    value: {
        summary: 'succeeded' | {
            failed: {
                error: {
                    TransactionFailure: [number[], string];
                };
                tx_signature: string;
            };
        };
        transactionResults: Array<{
            err: null | unknown;
            logs: string[];
            postExecutionAccounts: null | unknown;
            preExecutionAccounts: null | unknown;
            returnData: null | unknown;
            unitsConsumed: number;
        }>;
    };
}

interface BundleStatus {
    context: { slot: number };
    value: {
        bundleId: string;
        transactions: string[];
        slot: number;
        confirmationStatus: string;
        err: any;
    }[];
}

interface InflightBundleStatus {
    context: { slot: number };
    value: {
        bundle_id: string;
        status: "Invalid" | "Pending" | "Landed" | "Failed";
        landed_slot: number | null;
    }[];
}

export class QuickNodeJitoClient {
    private config: QuickNodeJitoConfig;
    private connection: web3.Connection;

    constructor(config: QuickNodeJitoConfig = {}) {
        this.config = {
            endpoint: config.endpoint,
            tipAmount: config.tipAmount || QUICKNODE_JITO_CONSTANTS.DEFAULT_TIP_AMOUNT,
            pollIntervalMs: config.pollIntervalMs || QUICKNODE_JITO_CONSTANTS.DEFAULT_POLL_INTERVAL_MS,
            pollTimeoutMs: config.pollTimeoutMs || QUICKNODE_JITO_CONSTANTS.DEFAULT_POLL_TIMEOUT_MS,
            defaultWaitBeforePollMs: config.defaultWaitBeforePollMs || QUICKNODE_JITO_CONSTANTS.DEFAULT_WAIT_BEFORE_POLL_MS,
        };

        if (!this.config.endpoint) {
            throw new Error('QuickNode endpoint is required');
        }

        this.connection = new web3.Connection(this.config.endpoint, 'confirmed');
    }

    // Static method to create client with simplified config
    static createWithDefaults(config: Partial<QuickNodeJitoConfig> = {}): QuickNodeJitoClient {
        const fullConfig: QuickNodeJitoConfig = {
            endpoint: config.endpoint,
            tipAmount: config.tipAmount,
            pollIntervalMs: config.pollIntervalMs,
            pollTimeoutMs: config.pollTimeoutMs,
            defaultWaitBeforePollMs: config.defaultWaitBeforePollMs,
        };
        return new QuickNodeJitoClient(fullConfig);
    }


    private async makeRpcCall(method: string, params: any[], config?: RpcCallConfig): Promise<any> {
        const retries = Math.max(1, config?.retries ?? QUICKNODE_JITO_CONSTANTS.DEFAULT_RPC_RETRIES);
        const retryDelayMs = config?.retryDelayMs ?? QUICKNODE_JITO_CONSTANTS.DEFAULT_RPC_RETRY_DELAY_MS;

        for (let attempt = 0; attempt < retries; attempt++) {
            const response = await fetch(this.config.endpoint!, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: Date.now(),
                    method,
                    params,
                }),
            });

            const data = await response.json();

            if (!response.ok) {
                // Only retry on 429 (rate limit) errors
                if (response.status === 429 && attempt < retries - 1) {
                    const waitTime = retryDelayMs * Math.pow(2, attempt);
                    console.warn(`Rate limited on ${method} (attempt ${attempt + 1}/${retries}), retrying in ${waitTime}ms...`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    continue;
                }

                throw new Error(`HTTP error! status: ${response.status}`);
            }

            if (data.error) {
                throw new Error(`RPC error: ${data.error.message}`);
            }

            return data.result;
        }

        throw new Error('RPC call failed');
    }

    private async getTipAccounts(): Promise<string[]> {
        return await this.makeRpcCall('getTipAccounts', []);
    }

    private async getTipAccount(): Promise<string> {
        const tipAccounts = await this.getTipAccounts();
        if (!tipAccounts || tipAccounts.length === 0) {
            throw new Error('No JITO tip accounts found');
        }
        const randomIndex = Math.floor(Math.random() * tipAccounts.length);
        return tipAccounts[randomIndex];
    }

    private async simulateBundle(transactions: string[]): Promise<JitoBundleSimulationResponse> {
        return await this.makeRpcCall('simulateBundle', [[transactions]]);
    }

    private validateSimulation(simulation: JitoBundleSimulationResponse): void {
        if (simulation.value.summary !== 'succeeded') {
            const summary = simulation.value.summary as any;
            if (summary.failed) {
                throw new Error(`Simulation failed: ${summary.failed.error.TransactionFailure[1]}`);
            }
            throw new Error('Simulation failed with unknown error');
        }
    }

    private async sendBundleRpc(transactions: string[]): Promise<string> {
        return await this.makeRpcCall('sendBundle', [transactions]);
    }

    private async getInflightBundleStatuses(bundleIds: string[]): Promise<InflightBundleStatus> {
        return await this.makeRpcCall('getInflightBundleStatuses', [bundleIds]);
    }

    private async getBundleStatuses(bundleIds: string[]): Promise<BundleStatus> {
        return await this.makeRpcCall('getBundleStatuses', [bundleIds]);
    }

    private async pollBundleStatus(
        bundleId: string,
        timeoutMs = this.config.pollTimeoutMs!,
        pollIntervalMs = this.config.pollIntervalMs!,
        waitBeforePollMs = this.config.defaultWaitBeforePollMs!
    ): Promise<boolean> {
        // Wait before starting to poll
        await new Promise(resolve => setTimeout(resolve, waitBeforePollMs));

        const startTime = Date.now();
        let lastStatus = '';

        while (Date.now() - startTime < timeoutMs) {
            try {
                const inflightBundleStatus = await this.getInflightBundleStatuses([bundleId]);
                const status = inflightBundleStatus.value[0]?.status ?? 'Unknown';

                if (status !== lastStatus) {
                    lastStatus = status;
                }

                if (status === 'Landed') {
                    return true;
                }

                if (status === 'Failed') {
                    throw new Error(`Bundle failed with status: ${status}`);
                }

                await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
            } catch (error) {
                console.error('Error polling bundle status:', error);
                throw error;
            }
        }

        throw new Error('Polling timeout reached without confirmation');
    }

    async sendBundle(transactions: any[], signer: SolanaSigner): Promise<{ hash: string[] }> {
        try {
            if (transactions.length === 0) {
                throw new Error('No transactions to bundle');
            }

            if (transactions.length > QUICKNODE_JITO_CONSTANTS.MAX_BUNDLE_SIZE) {
                throw new Error(`Bundle size exceeds maximum of ${QUICKNODE_JITO_CONSTANTS.MAX_BUNDLE_SIZE} transactions`);
            }

            // Get a random tip account
            const jitoTipAccount = new web3.PublicKey(await this.getTipAccount());
            
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

            // Simulate the bundle first
            const simulation = await this.simulateBundle(base64SignedTransactions);
            this.validateSimulation(simulation);

            // Send the bundle
            const bundleId = await this.sendBundleRpc(base64SignedTransactions);
            console.log(`Bundle sent with ID: ${bundleId}`);

            // Poll for bundle status
            const success = await this.pollBundleStatus(bundleId);
            
            if (success) {
                // Retry logic with exponential backoff to retrieve transaction hashes
                const maxRetries = 3;
                let lastError: Error | undefined;

                for (let attempt = 0; attempt < maxRetries; attempt++) {
                    try {
                        // Exponential backoff: 1s, 2s, 4s
                        const waitTime = 1000 * Math.pow(2, attempt);
                        await new Promise(resolve => setTimeout(resolve, waitTime));

                        // Get final bundle status to retrieve transaction hashes
                        const bundleStatus = await this.getBundleStatuses([bundleId]);

                        if (bundleStatus.value?.[0]?.transactions) {
                            return { hash: bundleStatus.value[0].transactions };
                        }
                    } catch (error) {
                        lastError = error instanceof Error ? error : new Error(String(error));
                        console.error(`Attempt ${attempt + 1}/${maxRetries} failed to retrieve transaction hashes:`, error);
                    }
                }

                throw new Error(`Could not retrieve transaction hashes from bundle after ${maxRetries} attempts${lastError ? `: ${lastError.message}` : ''}`);
            } else {
                throw new Error('Bundle failed to land');
            }

        } catch (error) {
            throw new Error(`Jito bundle send failed: ${error}`);
        }
    }

    async sendSingleTransaction(transaction: any, signer: SolanaSigner): Promise<{ hash: string[] }> {
        return this.sendBundle([transaction], signer);
    }
}

export function createQuickNodeJitoClient(config: QuickNodeJitoConfig): QuickNodeJitoClient {
    return QuickNodeJitoClient.createWithDefaults(config);
}
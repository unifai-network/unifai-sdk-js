
import * as web3 from '@solana/web3.js';

const MAINNET_RPC_URL = 'https://api.mainnet-beta.solana.com';

export async function solSendTransaction(signer: any, tx: any, rpcUrls?: string[]): Promise<{ hash: string | undefined }> {
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

    if (!rpcUrls || rpcUrls.length === 0) {
        rpcUrls = [MAINNET_RPC_URL]; // set default RPC URLs if none provided
    }

    let signature;
    let connection;
    const successfulTransactions: { type: string; hash: string }[] = [];
    for (const rpcUrl of rpcUrls) {
        try {
            connection = new web3.Connection(rpcUrl, 'confirmed');
            signature = await connection.sendRawTransaction(serializedTransaction);
            successfulTransactions.push({
                type: tx.type,
                hash: signature,
            });
            break;

        } catch (error) {
            lastError = error as Error;
            continue;
        }
    }

    if (lastError && successfulTransactions.length === 0) {
        throw new Error(`${lastError?.message}, you may set your own RPC URLs when calling sendTransaction`);
    }

    const blockhash = await connection!.getLatestBlockhash();
    let transactionResult;
    if (signedTransaction instanceof web3.Transaction) {
        transactionResult = await connection!.confirmTransaction(
            {
                signature: signature!,
                blockhash: signedTransaction.recentBlockhash ?? blockhash.blockhash,
                lastValidBlockHeight:
                    signedTransaction.lastValidBlockHeight ?? blockhash.lastValidBlockHeight,
            },
            'confirmed',
        );
    } else {
        transactionResult = await connection!.confirmTransaction(
            {
                signature: signature!,
                blockhash: signedTransaction._message?.recentBlockhash ?? blockhash.blockhash,
                lastValidBlockHeight: signedTransaction.lastValidBlockHeight ?? blockhash.lastValidBlockHeight,
            },
            'confirmed',
        );
    }

    if (transactionResult.value.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(transactionResult.value.err)}`);
    }

    return { hash: signature }
}

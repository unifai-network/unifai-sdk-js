import { ethers } from "ethers";

export async function evmSendTransaction(signer: ethers.Wallet, tx: any): Promise<{ hash: string | undefined }> {
    try {
        const unsignedTx = ethers.Transaction.from(tx.hex); // Validate the transaction format

        const txParams: any = {
            to: unsignedTx.to? unsignedTx.to as `0x${string}` : ethers.ZeroAddress,
            data: unsignedTx.data as `0x${string}`,
        };

        if (unsignedTx.value) { txParams.value = unsignedTx.value; }
        if (unsignedTx.gasLimit) { txParams.gasLimit = unsignedTx.gasLimit; }
        if (unsignedTx.maxFeePerGas) { txParams.maxFeePerGas = unsignedTx.maxFeePerGas; }
        if (unsignedTx.maxPriorityFeePerGas) { txParams.maxPriorityFeePerGas = unsignedTx.maxPriorityFeePerGas; }

        const txResponse = await signer.sendTransaction(txParams);

        return { hash: txResponse.hash, };

    } catch (error) {
        throw new Error(`evmSendTransaction: ${error}`);
    }
}
import { ethers, toBeHex } from "ethers";
import {
  EtherSigner,
  WagmiSigner,
  isWagmiSigner,
  isEtherSigner,
} from "../types";
import { RateLimiter } from "../../common";

export class EVMHandler {
  constructor(private rateLimiter?: RateLimiter) {}

  async sendTransaction(
    signer: EtherSigner | WagmiSigner,
    tx: any
  ): Promise<{ hash: string | undefined }> {
    try {
      const unsignedTx = ethers.Transaction.from(tx.hex); // Validate the transaction format

      const txParams: any = {
        to: unsignedTx.to ? unsignedTx.to : ethers.ZeroAddress,
      };
      if (unsignedTx.data) {
        txParams.data = unsignedTx.data;
      }
      if (unsignedTx.value) {
        txParams.value = toBeHex(unsignedTx.value);
      }
      if (unsignedTx.gasLimit) {
        txParams.gasLimit = toBeHex(unsignedTx.gasLimit);
      }
      if (unsignedTx.maxFeePerGas) {
        txParams.maxFeePerGas = toBeHex(unsignedTx.maxFeePerGas);
      }
      if (unsignedTx.maxPriorityFeePerGas) {
        txParams.maxPriorityFeePerGas = toBeHex(
          unsignedTx.maxPriorityFeePerGas
        );
      }

      if (signer.sendTransaction) {
        let txResponse: any;
        let hash: string;
        try {
          await this.rateLimiter?.waitForLimit("evm_sendTransaction");
          txResponse = await signer.sendTransaction(txParams);
          hash = typeof txResponse === "string" ? txResponse : txResponse.hash;
          if (!hash) {
            throw new Error("Transaction response does not contain a hash");
          }
        } catch (error: any) {
          throw new Error(`signer.sendTransaction: ${error}`);
        }

        let receipt: any;
        if (isWagmiSigner(signer)) {
          const s = signer as WagmiSigner;
          if (s.waitForTransactionReceipt) {
            await this.rateLimiter?.waitForLimit(
              "evm_waitForTransactionReceipt"
            );
            receipt = await s.waitForTransactionReceipt({ hash });
            if (receipt.status != "success") {
              throw new Error("transaction reverted");
            }
          }
        } else if (isEtherSigner(signer)) {
          if (typeof txResponse.wait === "function") {
            await this.rateLimiter?.waitForLimit(
              "evm_waitForTransactionReceipt"
            );
            receipt = await txResponse.wait();
            if (!receipt || receipt.status == 0) {
              throw new Error("transaction reverted");
            }
          } else {
            console.log("txResponse: ", txResponse);
            throw new Error("Transaction response does not have wait method");
          }
        }

        return { hash: hash };
      } else {
        throw new Error("Signer should have sendTransaction method for evm.");
      }
    } catch (error) {
      throw new Error(`evmSendTransaction: ${error}`);
    }
  }
}

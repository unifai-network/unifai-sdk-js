import * as web3 from "@solana/web3.js";
import { SolanaSigner, SendConfig } from "../types";
import { RateLimiter, DEFAULT_CONFIG } from "../../common";
import { getSolanaErrorInfo } from "../solana-errors";

export class SolanaHandler {
  constructor(
    private rateLimiter?: RateLimiter,
    private maxPollTimes: number = DEFAULT_CONFIG.MAX_POLL_TIMES,
    private pollInterval: number = DEFAULT_CONFIG.POLL_INTERVAL
  ) {}

  async sendTransaction(
    signer: SolanaSigner,
    tx: any,
    config?: SendConfig
  ): Promise<{ hash: string | undefined }> {
    try {
      const transactionBuffer = new Uint8Array(
        atob(tx.base64)
          .split("")
          .map((c) => c.charCodeAt(0))
      );

      let transaction;
      if (tx.type === "legacy") {
        transaction = web3.Transaction.from(transactionBuffer);
      } else {
        transaction = web3.VersionedTransaction.deserialize(transactionBuffer);
      }

      await this.rateLimiter?.waitForLimit("solana_signTransaction");
      const signedTransaction = await signer.signTransaction(transaction);

      const serializedTransaction = Buffer.from(signedTransaction.serialize());

      let lastError: Error | null = null;
      let connection: web3.Connection | null = null;
      let signature: string | null = null;
      const successfulTransactions: { type: string; hash: string }[] = [];

      let rpcUrls =
        config?.rpcUrls && config.rpcUrls.length > 0
          ? config.rpcUrls
          : [web3.clusterApiUrl("mainnet-beta")];
      const broadcastMode = config?.broadcastMode || "sequential";

      if (broadcastMode === "concurrent") {
        // Send to all RPCs concurrently
        const sendPromises = rpcUrls.map(async (rpcUrl) => {
          try {
            const conn = new web3.Connection(rpcUrl, "confirmed");
            await this.rateLimiter?.waitForLimit("solana_sendRawTransaction");
            const sig = await conn.sendRawTransaction(serializedTransaction);
            return { success: true, connection: conn, signature: sig, rpcUrl };
          } catch (error) {
            console.error(`Error sending transaction to ${rpcUrl}:`, error);
            return { success: false, error: error as Error, rpcUrl };
          }
        });

        const results = await Promise.all(sendPromises);

        // Find first successful result
        const successResult = results.find((r) => r.success);
        if (
          successResult &&
          "signature" in successResult &&
          successResult.connection &&
          successResult.signature
        ) {
          connection = successResult.connection;
          signature = successResult.signature;
          successfulTransactions.push({
            type: tx.type,
            hash: successResult.signature,
          });
        } else {
          // All failed, use last error
          const failedResult = results.find((r) => !r.success && "error" in r);
          if (failedResult && "error" in failedResult && failedResult.error) {
            lastError = failedResult.error;
          }
        }
      } else {
        // Sequential mode (default)
        for (const rpcUrl of rpcUrls) {
          try {
            connection = new web3.Connection(rpcUrl, "confirmed");
            await this.rateLimiter?.waitForLimit("solana_sendRawTransaction");
            signature = await connection.sendRawTransaction(
              serializedTransaction
            );
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
      }

      if (lastError && successfulTransactions.length === 0) {
        const errorInfo = getSolanaErrorInfo(lastError);
        throw new Error(`Error sending transaction: ${errorInfo.message}`);
      }

      if (!connection || !signature) {
        throw new Error("Failed to establish connection or get signature");
      }

      const finalConnection = connection;
      const abortController = new AbortController();
      let pollResult = this.pollTransactionStatus(
        finalConnection,
        signature,
        this.maxPollTimes,
        this.pollInterval,
        abortController.signal
      );
      let wsResult = this.waitTransactionConfirmed(
        finalConnection,
        signature,
        signedTransaction
      );

      try {
        let result: any = await Promise.race([pollResult, wsResult]);
        if (result?.value?.err) {
          const errorInfo = getSolanaErrorInfo(result.value.err);
          throw new Error(
            `transaction ${signature} failed: ${errorInfo.message}`
          );
        }
      } catch (error) {
        throw new Error(`Error confirming transaction: ${error}`);
      } finally {
        abortController.abort();
      }

      return { hash: signature };
    } catch (error) {
      const errorInfo = getSolanaErrorInfo(error);
      throw new Error(`solSendTransaction: ${errorInfo.message}`);
    }
  }

  private async pollTransactionStatus(
    connection: web3.Connection,
    signature: string,
    maxPollTimes: number,
    pollInterval: number,
    signal?: AbortSignal
  ): Promise<any> {
    for (let pollTimes = 0; pollTimes < maxPollTimes; pollTimes++) {
      await new Promise((resolve) => setTimeout(resolve, pollInterval));

      if (signal?.aborted) {
        throw new Error("Polling aborted");
      }

      let err: any = null;
      try {
        await this.rateLimiter?.waitForLimit("solana_getSignatureStatus");
        const status = await connection.getSignatureStatus(signature, {
          searchTransactionHistory: true,
        });

        if (
          ["confirmed", "finalized"].includes(
            status?.value?.confirmationStatus || ""
          )
        ) {
          return status;
        }
      } catch (error) {
        err = error;
      }

      if (pollTimes >= maxPollTimes - 1) {
        throw (
          err ||
          new Error("Transaction not confirmed, please check solana explorer.")
        );
      }
    }
  }

  private async waitTransactionConfirmed(
    connection: web3.Connection,
    signature: string,
    signedTransaction: any
  ): Promise<any> {
    await this.rateLimiter?.waitForLimit("solana_getLatestBlockhash");
    const blockhash = await connection.getLatestBlockhash();
    if (signedTransaction instanceof web3.Transaction) {
      await this.rateLimiter?.waitForLimit("solana_confirmTransaction");
      return await connection.confirmTransaction(
        {
          signature: signature,
          blockhash: signedTransaction.recentBlockhash ?? blockhash.blockhash,
          lastValidBlockHeight:
            signedTransaction.lastValidBlockHeight ??
            blockhash.lastValidBlockHeight,
        },
        "confirmed"
      );
    } else {
      await this.rateLimiter?.waitForLimit("solana_confirmTransaction");
      return await connection.confirmTransaction(
        {
          signature: signature,
          blockhash:
            signedTransaction._message?.recentBlockhash ?? blockhash.blockhash,
          lastValidBlockHeight:
            signedTransaction.lastValidBlockHeight ??
            blockhash.lastValidBlockHeight,
        },
        "confirmed"
      );
    }
  }
}

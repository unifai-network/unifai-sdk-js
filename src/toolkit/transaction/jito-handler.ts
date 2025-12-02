import { RateLimiter } from "../../common";
import { SolanaSigner, SendConfig } from "../types";
import {
  createJitoClient,
  shouldUseJito,
  JitoConfig,
  JITO_CONSTANTS,
  JitoClient,
} from "../jito";
import {
  createQuickNodeJitoClient,
  QuickNodeJitoConfig,
  QuickNodeJitoClient,
} from "../jito-quicknode";
import { getSolanaErrorInfo } from "../solana-errors";

export class JitoHandler {
  constructor(private rateLimiter?: RateLimiter) {}

  public shouldUseJito(
    transactions: any[],
    configUseJito?: boolean,
    dataUseJito?: boolean
  ): { useJito: boolean } {
    return shouldUseJito(transactions, configUseJito, dataUseJito);
  }

  public createClient(
    config: SendConfig | undefined
  ): JitoClient | QuickNodeJitoClient {
    const jitoProvider = config?.jitoProvider || "quicknode";
    if (jitoProvider === "jito") {
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
        endpoint = config.rpcUrls.find((url) => url.includes("quiknode.pro"));
      }

      const quickNodeConfig: QuickNodeJitoConfig = {
        endpoint: endpoint,
        tipAmount: config?.jitoTipAmount,
        rateLimiter: this.rateLimiter,
      };
      return createQuickNodeJitoClient(quickNodeConfig);
    }
  }

  public async sendTransactions(
    jitoClient: JitoClient | QuickNodeJitoClient,
    transactions: any[],
    signer: SolanaSigner,
    config: SendConfig | undefined,
    onFailure: "skip" | "stop" = "stop"
  ): Promise<{ hash: string[]; error?: string }> {
    // Validate all transactions are Solana
    const allSolana = transactions.every((tx) => tx.chain === "solana");
    if (!allSolana) {
      throw new Error("Jito can only be used with Solana transactions");
    }

    if (transactions.length === 1) {
      // Single transaction case
      try {
        const result = await jitoClient.sendSingleTransaction(
          transactions[0],
          signer
        );
        return { hash: result.hash };
      } catch (error: any) {
        const errorInfo = getSolanaErrorInfo(error);
        throw new Error(`Jito single transaction failed: ${errorInfo.message}`);
      }
    }

    // Bundle case - handle batching with failure tracking
    const allHashes: string[] = [];
    let successful: Array<{ batchIndex: number; hashes: string[] }> = [];
    let failed: Array<{ batchIndex: number; error: string; txCount: number }> =
      [];

    // Split into batches if needed
    const batches: any[][] = [];
    if (transactions.length <= JITO_CONSTANTS.MAX_BUNDLE_SIZE) {
      batches.push(transactions);
    } else {
      for (
        let i = 0;
        i < transactions.length;
        i += JITO_CONSTANTS.MAX_BUNDLE_SIZE
      ) {
        batches.push(transactions.slice(i, i + JITO_CONSTANTS.MAX_BUNDLE_SIZE));
      }
    }

    // Send each batch
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      try {
        const result = await jitoClient.sendBundle(
          batch,
          signer,
          config?.rpcUrls
        );
        allHashes.push(...result.hash);
        successful.push({ batchIndex: i, hashes: result.hash });

        // Add interval between batches (except for the last one)
        if (i < batches.length - 1) {
          const interval = config?.txInterval || 2;
          await new Promise((resolve) => setTimeout(resolve, 1000 * interval));
        }
      } catch (error: any) {
        const errorInfo = getSolanaErrorInfo(error);
        failed.push({
          batchIndex: i,
          error: errorInfo.message,
          txCount: batch.length,
        });

        if (onFailure === "skip") {
          // Continue with next batch
          continue;
        } else {
          // Stop mode: throw error with details
          const successfulInfo =
            successful.length > 0
              ? `Successful batches: ${successful
                  .map(
                    (s) =>
                      `batch ${s.batchIndex + 1} (${
                        s.hashes.length
                      } txns: ${s.hashes.join(", ")})`
                  )
                  .join("; ")}`
              : "";

          const errorDetails = `Batch ${i + 1}/${batches.length} (${
            batch.length
          } transactions) failed: ${errorInfo.message}`;
          const fullError = successfulInfo
            ? `${errorDetails}. ${successfulInfo}`
            : errorDetails;

          throw new Error(`Jito bundle processing failed: ${fullError}`);
        }
      }
    }

    // Handle results based on onFailure mode
    if (onFailure === "skip") {
      // Check if all batches failed
      if (failed.length === batches.length) {
        const failedDetails = failed
          .map(
            (f) => `Batch ${f.batchIndex + 1} (${f.txCount} txns): ${f.error}`
          )
          .join("; ");
        throw new Error(`All Jito batches failed: ${failedDetails}`);
      }

      // Return with error info if there were any failures
      if (failed.length > 0) {
        const failedDetails = failed
          .map(
            (f) => `Batch ${f.batchIndex + 1} (${f.txCount} txns): ${f.error}`
          )
          .join("; ");
        const successfulDetails = successful
          .map((s) => `Batch ${s.batchIndex + 1}: ${s.hashes.length} txns`)
          .join(", ");
        const errorInfo = `Some batches failed: ${failedDetails}. Successful: ${successfulDetails}`;
        return { hash: allHashes, error: errorInfo };
      }

      return { hash: allHashes };
    } else {
      // For stop mode, we only reach here if all batches succeeded
      return { hash: allHashes };
    }
  }
}

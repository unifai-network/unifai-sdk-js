import { ethers, toBeHex } from "ethers";
import {
  EtherSigner,
  WagmiSigner,
  SendConfig,
  isWagmiSigner,
  isEtherSigner,
  getSignerAddress,
} from "../types";
import { RateLimiter } from "../../common";

const STUCK_THRESHOLD_DEFAULT = 10;
const SAFETY_MULTIPLIER_NUMERATOR = 125n;
const SAFETY_MULTIPLIER_DENOMINATOR = 100n;

function bigintMax(...vals: Array<bigint | undefined>): bigint | undefined {
  let max: bigint | undefined;
  for (const v of vals) {
    if (v == null) continue;
    if (max == null || v > max) max = v;
  }
  return max;
}

/**
 * Send via signer.sendTransaction, but first detect a gridlocked nonce queue
 * (pending - latest > stuckThreshold) and, if so, redirect this send to the
 * oldest stuck nonce with bumped gas (1.25x feeData, taking max with any
 * user-set gas) so the network treats it as a replacement and unblocks the
 * queue. Gracefully skips the check when the signer has no usable provider
 * (e.g. wagmi signers); behavior is unchanged below threshold.
 */
export async function smartSend(
  signer: EtherSigner | WagmiSigner,
  txParams: any,
  config?: SendConfig
): Promise<any> {
  const provider = (signer as any).provider;
  if (
    !provider ||
    typeof provider.getTransactionCount !== "function" ||
    typeof provider.getFeeData !== "function"
  ) {
    return await signer.sendTransaction(txParams);
  }

  let address: string;
  try {
    address = await getSignerAddress(signer as any);
  } catch {
    return await signer.sendTransaction(txParams);
  }
  if (!address) {
    return await signer.sendTransaction(txParams);
  }

  const stuckThreshold = config?.stuckThreshold ?? STUCK_THRESHOLD_DEFAULT;

  // Probe + replacement is best-effort. Any RPC failure (e.g. provider doesn't
  // support the `pending` tag, getFeeData missing) must not block the actual
  // send — we degrade to the native sendTransaction path with original params.
  try {
    const [latest, pending, fee] = await Promise.all([
      provider.getTransactionCount(address, "latest"),
      provider.getTransactionCount(address, "pending"),
      provider.getFeeData(),
    ]);
    const stuckCount = pending - latest;

    if (stuckCount > stuckThreshold) {
      const isEip1559 =
        fee.maxFeePerGas != null || fee.maxPriorityFeePerGas != null;
      const isLegacy = !isEip1559 && fee.gasPrice != null;

      // For legacy-fee chains (type-0 txs), we MUST bump gasPrice to avoid the
      // node rejecting the replacement as underpriced. If feeData gives us
      // nothing usable, skip the rewrite entirely — better to send the original
      // tx and let the queue stay stuck than ship an unreplaceable replacement.
      if (isEip1559 || isLegacy) {
        txParams.nonce = latest;

        if (isEip1559) {
          const bumpedMaxFee =
            fee.maxFeePerGas != null
              ? (BigInt(fee.maxFeePerGas) * SAFETY_MULTIPLIER_NUMERATOR) /
                SAFETY_MULTIPLIER_DENOMINATOR
              : undefined;
          const bumpedMaxPriority =
            fee.maxPriorityFeePerGas != null
              ? (BigInt(fee.maxPriorityFeePerGas) *
                  SAFETY_MULTIPLIER_NUMERATOR) /
                SAFETY_MULTIPLIER_DENOMINATOR
              : undefined;
          const userMaxFee =
            txParams.maxFeePerGas != null
              ? BigInt(txParams.maxFeePerGas)
              : undefined;
          const userMaxPriority =
            txParams.maxPriorityFeePerGas != null
              ? BigInt(txParams.maxPriorityFeePerGas)
              : undefined;
          const finalMaxFee = bigintMax(bumpedMaxFee, userMaxFee);
          const finalMaxPriority = bigintMax(
            bumpedMaxPriority,
            userMaxPriority
          );
          if (finalMaxFee != null) {
            txParams.maxFeePerGas = toBeHex(finalMaxFee);
          }
          if (finalMaxPriority != null) {
            txParams.maxPriorityFeePerGas = toBeHex(finalMaxPriority);
          }
        } else {
          // Legacy path
          const bumpedGasPrice =
            (BigInt(fee.gasPrice) * SAFETY_MULTIPLIER_NUMERATOR) /
            SAFETY_MULTIPLIER_DENOMINATOR;
          const userGasPrice =
            txParams.gasPrice != null ? BigInt(txParams.gasPrice) : undefined;
          const finalGasPrice = bigintMax(bumpedGasPrice, userGasPrice);
          if (finalGasPrice != null) {
            txParams.gasPrice = toBeHex(finalGasPrice);
          }
        }

        // stderr (not stdout) so CLI JSON output isn't corrupted
        console.warn(
          `[smartSend] queue=${stuckCount} replacing nonce=${latest}`
        );
      }
    }
  } catch (error: any) {
    console.warn(
      `[smartSend] probe failed, falling back to native send: ${error?.message || error}`
    );
  }

  return await signer.sendTransaction(txParams);
}

export class EVMHandler {
  constructor(private rateLimiter?: RateLimiter) {}

  async sendTransaction(
    signer: EtherSigner | WagmiSigner,
    tx: any,
    config?: SendConfig
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

      let txResponse: any;
      let hash: string;
      try {
        await this.rateLimiter?.waitForLimit("evm_sendTransaction");
        txResponse = await smartSend(signer, txParams, config);
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
    } catch (error) {
      throw new Error(`evmSendTransaction: ${error}`);
    }
  }
}

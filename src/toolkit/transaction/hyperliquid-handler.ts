import { signL1Action } from "@nktkas/hyperliquid/signing";
import { EtherSigner, WagmiSigner } from "../types";
import { RateLimiter } from "../../common";

export class HyperliquidHandler {
  private readonly url = "https://api.hyperliquid.xyz/exchange";

  constructor(private rateLimiter?: RateLimiter) {}

  async sendTransaction(
    signer: EtherSigner | WagmiSigner,
    tx: any
  ): Promise<{ hash: string | undefined }> {
    try {
      const order = JSON.parse(tx.order);

      await this.rateLimiter?.waitForLimit("evm_signTypedData");
      const signature = await signL1Action({
        wallet: signer,
        action: order.action,
        nonce: order.nonce,
      });

      await this.rateLimiter?.waitForLimit("hyperliquid_exchange");
      const response = await fetch(this.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: order.action,
          signature,
          nonce: order.nonce,
        }), // recommended to send the same formatted action
      });

      const responseClone = response.clone();
      let res: any;
      try {
        res = await response.json();
      } catch (error) {
        res = await responseClone.text();
        throw new Error(res);
      }

      let hash = "";
      if (
        res.response &&
        res.response.data &&
        res.response.data.statuses &&
        res.response.data.statuses.length > 0
      ) {
        if (
          res.response.data.statuses[0].resting &&
          res.response.data.statuses[0].resting.oid
        ) {
          hash = res.response.data.statuses[0].resting.oid;
        } else {
          hash = JSON.stringify(res.response.data.statuses[0]);
        }
      } else if (res.status == "ok") {
        hash = res.status;
      } else {
        // res.status == 'err'
        throw new Error(res.response);
      }

      return { hash: hash };
    } catch (error) {
      throw new Error(`hyperliquidSendTransaction: ${error}`);
    }
  }
}

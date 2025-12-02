import { OrderType, ApiKeyCreds } from "@polymarket/clob-client";
import { orderToJson } from "@polymarket/clob-client/dist/utilities";
import { EtherSigner, WagmiSigner, isWagmiSigner } from "../types";
import { RateLimiter } from "../../common";
import { deriveApiKey } from "../polymarket/apikey";
import { createL2Headers } from "../polymarket/l2header";
import {
  PolymarketOpenOrdersHexPayload,
  PolymarketOpenOrdersRequestParams,
  PolymarketCheckOrderLiquidityRewardPayload,
} from "../polymarket/types";

export class PolymarketHandler {
  constructor(
    private rateLimiter?: RateLimiter,
    private sendTransactionProxy?: (
      chain: string,
      name: string,
      txData: any
    ) => Promise<any>
  ) {}

  /**
   * Sends a Polymarket order transaction (limit or market order)
   * @param signer - The EVM signer to use for signing typed data
   * @param tx - Transaction data containing order details and typed data
   * @param address - The user's wallet address
   * @returns Promise with transaction hash and order ID
   */
  async sendOrderTransaction(
    signer: EtherSigner | WagmiSigner,
    tx: any,
    address: string
  ): Promise<{ hash?: string; data: any }> {
    try {
      let data = JSON.parse(tx.hex);
      let od = data.data;
      let orderData = od.orderData;
      let typedData = od.typedData;
      let orderType = data.orderType || OrderType.FAK; // FOK

      const { signature: existingSignature, ...cleanOrderData } = orderData;
      let signature: string;

      if (isWagmiSigner(signer)) {
        const s = signer as WagmiSigner;
        await this.rateLimiter?.waitForLimit("evm_signTypedData");
        signature = await s.signTypedData({
          account: s.account,
          domain: typedData.domain,
          types: typedData.types,
          primaryType: typedData.primaryType,
          message: cleanOrderData,
        });
      } else if (signer.signTypedData) {
        const typesCopy = { ...typedData.types };
        delete typesCopy.EIP712Domain;
        await this.rateLimiter?.waitForLimit("evm_signTypedData");
        signature = await signer.signTypedData(
          typedData.domain,
          typesCopy,
          cleanOrderData
        );
      } else {
        throw new Error("Signer doesn't have signTypedData");
      }
      orderData.signature = signature;

      const creds = await deriveApiKey(address, signer, this.rateLimiter);
      if (!creds) {
        throw new Error("Failed to derive API key for Polymarket");
      }

      const endpoint = "/order";
      const orderPayload = orderToJson(orderData, creds?.key || "", orderType);

      const l2HeaderArgs = {
        method: "POST",
        requestPath: endpoint,
        body: JSON.stringify(orderPayload),
      };

      const headers = await createL2Headers(
        address,
        creds as ApiKeyCreds,
        l2HeaderArgs
      );

      const isMarketOrder =
        orderType === OrderType.FAK || orderType === OrderType.FOK;
      const res = await this.sendTransactionProxy?.(
        "polymarket",
        isMarketOrder ? "MarketOrder" : "LimitOrder",
        { headers, data: orderPayload }
      );

      let response: { hash?: string; data: any } = { data: res };
      const hash = res.transactionsHashes?.join(",") || res.transactionHash;
      if (hash) {
        response.hash = hash;
      }
      return response;
    } catch (error) {
      throw new Error(`polymarketSendOrderTransaction: ${error}`);
    }
  }

  /**
   * Sends a Polymarket cancel order transaction
   * @param signer - The EVM signer to use for deriving API credentials
   * @param tx - Transaction data containing the order ID to cancel
   * @param address - The user's wallet address
   * @returns Promise with transaction hash and order ID
   */
  async sendCancelOrderTransaction(
    signer: EtherSigner | WagmiSigner,
    tx: any,
    address: string
  ): Promise<{ data: any }> {
    try {
      const data = JSON.parse(tx.hex);
      const orderID: string | undefined = data?.data?.orderID;
      if (!orderID) {
        throw new Error("Cancel order payload missing orderID");
      }

      const creds: ApiKeyCreds = await deriveApiKey(
        address,
        signer,
        this.rateLimiter
      );
      if (!creds) {
        throw new Error("Failed to derive API key for Polymarket");
      }

      const endpoint = "/order";
      const cancelPayload = { orderID };

      const l2HeaderArgs = {
        method: "DELETE",
        requestPath: endpoint,
        body: JSON.stringify(cancelPayload),
      };

      const headers = await createL2Headers(
        address,
        creds as ApiKeyCreds,
        l2HeaderArgs
      );

      const res = await this.sendTransactionProxy?.(
        "polymarket",
        "CancelOrder",
        { headers, data: cancelPayload }
      );

      // Check for orders that failed to cancel
      const canceled = res?.canceled;
      const notCanceled = res?.not_canceled;
      if (
        (!canceled || Object.keys(canceled).length == 0) &&
        notCanceled &&
        Object.keys(notCanceled).length > 0
      ) {
        const reasons = Object.entries(notCanceled)
          .map(([orderId, reason]) => `${orderId}: ${reason}`)
          .join("; ");
        throw new Error(`Polymarket cancel failed: ${reasons}`);
      }

      return { data: res };
    } catch (error) {
      throw new Error(`polymarketSendCancelOrderTransaction: ${error}`);
    }
  }

  /**
   * Retrieves a user's Polymarket open orders via the Unifai transaction proxy.
   */
  async getOpenOrdersTransaction(
    signer: EtherSigner | WagmiSigner,
    tx: any,
    address: string
  ): Promise<{ data?: any }> {
    try {
      const parsedPayload: PolymarketOpenOrdersHexPayload = JSON.parse(tx.hex);
      const requestData = parsedPayload.data;
      const params: PolymarketOpenOrdersRequestParams = requestData.params;
      const onlyFirstPage = requestData.onlyFirstPage;
      const nextCursor = requestData.nextCursor;

      const creds: ApiKeyCreds = await deriveApiKey(
        address,
        signer,
        this.rateLimiter
      );
      if (!creds) {
        throw new Error("Failed to derive API key for Polymarket");
      }

      const endpoint = "/data/orders";
      const l2HeaderArgs = {
        method: "GET",
        requestPath: endpoint,
      };

      const headers = await createL2Headers(
        address,
        creds as ApiKeyCreds,
        l2HeaderArgs
      );

      const requestPayload = {
        params,
        onlyFirstPage,
        nextCursor,
      };

      const res = await this.sendTransactionProxy?.(
        "polymarket",
        "GetOpenOrders",
        { headers, data: requestPayload }
      );

      return { data: res?.data };
    } catch (error) {
      throw new Error(`polymarketGetOpenOrdersTransaction: ${error}`);
    }
  }

  /**
   * Checks whether a Polymarket order is currently earning liquidity rewards.
   */
  async checkOrderLiquidityRewardTransaction(
    signer: EtherSigner | WagmiSigner,
    tx: any,
    address: string
  ): Promise<{ data?: any }> {
    try {
      const parsedPayload: PolymarketCheckOrderLiquidityRewardPayload =
        JSON.parse(tx.hex);
      const orderIds = parsedPayload?.data?.orderIds;
      if (!orderIds || orderIds.length === 0) {
        throw new Error("CheckOrderLiquidityReward payload missing orderIds");
      }

      const creds: ApiKeyCreds = await deriveApiKey(
        address,
        signer,
        this.rateLimiter
      );
      if (!creds) {
        throw new Error("Failed to derive API key for Polymarket");
      }

      const endpoint = "/orders-scoring";
      const requestPayload = orderIds;
      const body = JSON.stringify(requestPayload);
      const l2HeaderArgs = {
        method: "POST",
        requestPath: endpoint,
        body,
      };

      const headers = await createL2Headers(
        address,
        creds as ApiKeyCreds,
        l2HeaderArgs
      );

      const res = await this.sendTransactionProxy?.(
        "polymarket",
        "CheckOrderLiquidityReward",
        { headers, data: { orderIds } }
      );

      return { data: res?.data };
    } catch (error) {
      throw new Error(
        `polymarketCheckOrderLiquidityRewardTransaction: ${error}`
      );
    }
  }
}

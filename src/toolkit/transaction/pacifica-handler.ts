import { RateLimiter, DEFAULT_CONFIG } from "../../common";
import { SolanaSigner } from "../types";
import { encodeBase58 } from 'ethers/utils';

function sortObjectKeys(obj: any): any {
  return Object.keys(obj).sort().reduce((acc: any, key: any) => {
    let value = obj[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      value = sortObjectKeys(value);
    }
    acc[key] = value;
    return acc;
  }, {});
}


export class PacificaHandler {
  constructor(
    private rateLimiter?: RateLimiter,
    private maxPollTimes: number = DEFAULT_CONFIG.MAX_POLL_TIMES,
    private pollInterval: number = DEFAULT_CONFIG.POLL_INTERVAL,
    private sendTransactionProxy?: (
      chain: string,
      name: string,
      txData: any
    ) => Promise<any>
  ) { }

  async sendMarketOrderTransaction(
    signer: SolanaSigner,
    tx: any,
    address: string
  ): Promise<{ hash?: string; data: any }> {
    try {
      const orderTx = JSON.parse(tx.hex);
      const header = orderTx.header;
      const payload = orderTx.payload;

      const dataToSign = {
        ...header,
        "data": payload,
      }

      const sortedData = sortObjectKeys(dataToSign);

      const messageString = JSON.stringify(sortedData);

      let signature: string;

      const messageBytes = new TextEncoder().encode(messageString);

      if (signer.signMessage) {
        const signedMessage = await signer.signMessage(messageBytes);
        const signatureUint8 = signedMessage instanceof Uint8Array ? signedMessage : signedMessage.signature;
        signature = encodeBase58(signatureUint8);
      } else {
        throw new Error("Wallet does not support signMessage");
      }

      const requestBody = {
        account: address,
        signature: signature,
        timestamp: orderTx.header.timestamp,
        expiry_window: orderTx.header.expiry_window,
        ...orderTx.payload,
      };

      const res = await this.sendTransactionProxy?.(
        "solana",
        "Pacifica-PlaceMarketOrder",
        { data: requestBody }
      );

      return {
        hash: res?.data?.order_id,
        data: res
      };
    } catch (error) {
      throw new Error(`PacificaSendOrderTransaction Error: ${error}`);
    }
  }

  async sendLimitOrderTransaction(
    signer: SolanaSigner,
    tx: any,
    address: string
  ): Promise<{ hash?: string; data: any }> {
    try {
      const orderTx = JSON.parse(tx.hex);
      const header = orderTx.header;
      const payload = orderTx.payload;

      const dataToSign = {
        ...header,
        "data": payload,
      }

      const sortedData = sortObjectKeys(dataToSign);

      const messageString = JSON.stringify(sortedData);

      let signature: string;

      const messageBytes = new TextEncoder().encode(messageString);

      if (signer.signMessage) {
        const signedMessage = await signer.signMessage(messageBytes);
        const signatureUint8 = signedMessage instanceof Uint8Array ? signedMessage : signedMessage.signature;
        signature = encodeBase58(signatureUint8);
      } else {
        throw new Error("Wallet does not support signMessage");
      }

      const requestBody = {
        account: address,
        signature: signature,
        timestamp: orderTx.header.timestamp,
        expiry_window: orderTx.header.expiry_window,
        ...orderTx.payload,
      };

      const res = await this.sendTransactionProxy?.(
        "solana",
        "Pacifica-PlaceLimitOrder",
        { data: requestBody }
      );

      return {
        hash: res?.data?.order_id,
        data: res
      };
    } catch (error) {
      throw new Error(`PacificaSendOrderTransaction Error: ${error}`);
    }
  }

  async sendCancelOrderTransaction(
    signer: SolanaSigner,
    tx: any,
    address: string
  ): Promise<{ hash?: string; data: any }> {
    try {
      const orderTx = JSON.parse(tx.hex);
      const header = orderTx.header;
      const payload = orderTx.payload;

      const dataToSign = {
        ...header,
        "data": payload,
      }

      const sortedData = sortObjectKeys(dataToSign);

      const messageString = JSON.stringify(sortedData);

      let signature: string;

      const messageBytes = new TextEncoder().encode(messageString);

      if (signer.signMessage) {
        const signedMessage = await signer.signMessage(messageBytes);
        const signatureUint8 = signedMessage instanceof Uint8Array ? signedMessage : signedMessage.signature;
        signature = encodeBase58(signatureUint8);
      } else {
        throw new Error("Wallet does not support signMessage");
      }

      const requestBody = {
        account: address,
        signature: signature,
        timestamp: orderTx.header.timestamp,
        expiry_window: orderTx.header.expiry_window,
        ...orderTx.payload,
      };

      const res = await this.sendTransactionProxy?.(
        "solana",
        "Pacifica-CancelOrder",
        { data: requestBody }
      );

      return {
        hash: undefined,
        data: res
      };
    } catch (error) {
      throw new Error(`PacificaSendOrderTransaction Error: ${error}`);
    }
  }

  async sendCancelAllOrdersTransaction(
    signer: SolanaSigner,
    tx: any,
    address: string
  ): Promise<{ hash?: string; data: any }> {
    try {
      const orderTx = JSON.parse(tx.hex);
      const header = orderTx.header;
      const payload = orderTx.payload;

      const dataToSign = {
        ...header,
        "data": payload,
      }

      const sortedData = sortObjectKeys(dataToSign);

      const messageString = JSON.stringify(sortedData);

      let signature: string;

      const messageBytes = new TextEncoder().encode(messageString);

      if (signer.signMessage) {
        const signedMessage = await signer.signMessage(messageBytes);
        const signatureUint8 = signedMessage instanceof Uint8Array ? signedMessage : signedMessage.signature;
        signature = encodeBase58(signatureUint8);
      } else {
        throw new Error("Wallet does not support signMessage");
      }

      const requestBody = {
        account: address,
        signature: signature,
        timestamp: orderTx.header.timestamp,
        expiry_window: orderTx.header.expiry_window,
        ...orderTx.payload,
      };

      const res = await this.sendTransactionProxy?.(
        "solana",
        "Pacifica-CancelAllOrders",
        { data: requestBody }
      );

      return {
        hash: undefined,
        data: res
      };
    } catch (error) {
      throw new Error(`PacificaSendOrderTransaction Error: ${error}`);
    }
  }

}
import { API, APIConfig, TRANSACTION_API_ENDPOINT } from "../../common";
import { ActionContext } from "../context";
import { Signer, getSignerAddress } from "../types";

export class BaseTransactionAPI extends API {
  constructor(config: APIConfig) {
    if (!config.endpoint) {
      config.endpoint = TRANSACTION_API_ENDPOINT;
    }
    super(config);
  }

  public async createTransaction(
    type: string,
    ctx: ActionContext,
    payload: any = {}
  ) {
    const data = {
      agentId: ctx.agentId,
      actionId: ctx.actionId,
      actionName: ctx.actionName,
      type,
      payload,
    };
    return await this.request("POST", `/tx/create`, {
      json: data,
      timeout: 60000,
    });
  }

  public async buildTransaction(
    txId: string,
    signerOrAddress: Signer | string
  ) {
    let address =
      typeof signerOrAddress === "string"
        ? signerOrAddress
        : await getSignerAddress(signerOrAddress);
    let buildBody = { txId, address };
    let data = await this.request("POST", `/tx/build`, {
      json: buildBody,
      timeout: 60000,
    });
    if (!data.success) {
      throw new Error(`Build transaction failed: ${data.error}`);
    }
    return data;
  }

  public async completeTransaction(
    txId: string,
    txHash: string[],
    address: string
  ) {
    let completeBody = { txId, txHash: txHash.join(","), address };
    let data = await this.request("POST", `/tx/complete`, {
      json: completeBody,
    });
    if (data.success || data.message === "Transaction completed successfully") {
      return data;
    }
    throw new Error(`Complete transaction failed: ${data.error}`);
  }

  public async getTransaction(txId: string) {
    let data = await this.request("GET", `/tx/get/${txId}`);
    if (data.error) {
      throw new Error(`Get transaction failed: ${data.error}`);
    }
    return data;
  }

  public async sendTransaction(chain: string, name: string, txData: any) {
    const data = await this.request("POST", `/tx/sendtransaction`, {
      json: { ...txData, chain, name },
    });
    if (data.error) {
      throw new Error(`Send transaction failed: ${data.error}`);
    }
    return data;
  }
}

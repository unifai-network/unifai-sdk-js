import {
  API,
  APIConfig,
  TRANSACTION_API_ENDPOINT,
  DEFAULT_CONFIG,
} from "../../common";
import { ActionContext } from "../context";
import {
  Signer,
  EtherSigner,
  SolanaSigner,
  WagmiSigner,
  isEtherSigner,
  isSolanaSigner,
  isWagmiSigner,
} from "../types";

export class BaseTransactionAPI extends API {
  protected pollInterval: number;
  protected maxPollTimes: number;

  constructor(config: APIConfig) {
    if (!config.endpoint) {
      config.endpoint = TRANSACTION_API_ENDPOINT;
    }
    super(config);
    this.pollInterval = config.pollInterval ?? DEFAULT_CONFIG.POLL_INTERVAL;
    this.maxPollTimes = config.maxPollTimes ?? DEFAULT_CONFIG.MAX_POLL_TIMES;
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
        : await this.getAddress(signerOrAddress);
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

  protected async getAddress(signer: Signer): Promise<string> {
    let address: string = "";

    if (isEtherSigner(signer)) {
      address = (signer as EtherSigner).address; // ethers signer
    } else if (isSolanaSigner(signer)) {
      address = (signer as SolanaSigner).publicKey.toBase58(); // solana provider
    } else if (isWagmiSigner(signer)) {
      // wagmi wallet
      const addresses = await (signer as WagmiSigner).getAddresses(); // ethers signer with getAddresses method
      if (addresses.length > 0) {
        address = addresses[0]; // Use the first address
      }
    } else {
      throw new Error("Signer does not have an address or publicKey.");
    }

    return address;
  }
}

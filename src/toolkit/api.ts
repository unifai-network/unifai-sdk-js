import { API, APIConfig, FRONTEND_API_ENDPOINT, TRANSACTION_API_ENDPOINT } from '../common';
import { ActionContext } from './context';
import * as tran from './transaction';

export class ToolkitAPI extends API {
  constructor(config: APIConfig) {
    if (!config.endpoint) {
      config.endpoint = FRONTEND_API_ENDPOINT;
    }
    super(config);
  }

  public async updateToolkit(info: Record<string, any>): Promise<void> {
    await this.request('POST', '/toolkits/fields/', { json: info });
  }
}

export class TransactionAPI extends API {
  constructor(config: APIConfig) {
    if (!config.endpoint) {
      config.endpoint = TRANSACTION_API_ENDPOINT;
    }
    super(config);
  }

  public async createTransaction(type: string, ctx: ActionContext, payload: any = {}) {
    const data = {
      agentId: ctx.agentId,
      actionId: ctx.actionId,
      actionName: ctx.actionName,
      type,
      payload,
    }
    return await this.request('POST', `/tx/create`, { json: data });
  }

  // Sign and Sends a transaction to blockchains.
  public async sendTransaction(txId: string, signer: any, rpcUrls?: string[]): Promise<{ hash?: string[] }> {

    let address: string;
    if (signer.address) {
      address = signer.address; // ethers signer
    } else if (signer.publicKey) {
      address = signer.publicKey.toBase58(); // solana provider
    } else if (signer.getAddress) {
      address = await signer.getAddress(); // ethers signer with getAddress method
    } else {
      throw new Error('Signer does not have an address or publicKey.');
    }

    try {
      let data = await this.buildTransaction(txId, address);

      const transactions = data.transactions
      if (!transactions || transactions.length === 0) {
        throw new Error('No transactions to send.')
      }

      let res;
      let hashes: string[] = [];
      for (const tx of transactions) {
        switch (tx.chain) {
          case 'polygon': // Polygon Mainnet
            switch (tx.name) {
              case 'MarketOrder':
                res = await tran.polymarketSendTransaction(signer, tx);
                break;
              default:
                res = await tran.evmSendTransaction(signer, tx);
            }
            break;
          case 'solana': // Solana
            res = await tran.solSendTransaction(signer, tx, rpcUrls);
            break;

          default: // evm
            res = await tran.evmSendTransaction(signer, tx);
        }

        if (res.hash) {
          await this.completeTransaction(txId, res.hash, address);
          hashes.push(res.hash);
        }
      }

      return { hash: hashes };

    } catch (error) {
      throw new Error(`sendTransaction: ${error}`);
    }
  }

  public async buildTransaction(txId: string, address: string) {
    let buildBody = { txId, address };
    let data = await this.request('POST', `/tx/build`, { json: buildBody });
    if (!data.success) {
      throw data.error
    }
    return data
  }

  public async completeTransaction(txId: string, txHash: string, address: string) {
    let completeBody = { txId, txHash, address };
    let data = await this.request('POST', `/tx/complete`, { json: completeBody });
    if (!data.success) {
      throw data.error
    }
    return data
  }

  public async getTransaction(txId: string) {
    let data = await this.request('GET', `/tx/${txId}`);
    if (!data.success) {
      throw data.error
    }
    return data
  }

}

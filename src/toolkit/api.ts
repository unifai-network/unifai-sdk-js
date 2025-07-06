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
  // for solana transaction, please provide your own RPC endpoints.
  public async sendTransaction(txId: string, signer: tran.EtherSigner|tran.WagmiSigner|tran.SolanaSigner, rpcUrls?: string[]): Promise<{ hash?: string[] }> {

    let address: string = '';

    if (tran.isEtherSigner(signer)) {
      address = (signer as tran.EtherSigner).address; // ethers signer
    } else if (tran.isSolanaSigner(signer)) {
      address = (signer as tran.SolanaSigner).publicKey.toBase58(); // solana provider
    } else if (tran.isWagmiSigner(signer)) { // wagmi wallet
      const addresses = await (signer as tran.WagmiSigner).getAddresses(); // ethers signer with getAddresses method
      if (addresses.length > 0) {
        address = addresses[0]; // Use the first address
      } 
    }else {
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
                res = await tran.polymarketSendTransaction(signer as tran.EtherSigner|tran.WagmiSigner, tx);
                break;
              default:
                res = await tran.evmSendTransaction(signer as tran.EtherSigner|tran.WagmiSigner, tx);
            }
            break;
          case 'solana': // Solana
            res = await tran.solSendTransaction(signer as tran.SolanaSigner, tx, rpcUrls);
            break;

          default: // evm
            res = await tran.evmSendTransaction(signer as tran.EtherSigner|tran.WagmiSigner, tx);
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
    if (data.success || data.message === 'Transaction completed successfully')  {
      return data;
    }
    throw new Error(data.error || 'Transaction completion failed'); 
  }

  public async getTransaction(txId: string) {
    let data = await this.request('GET', `/tx/${txId}`);
    if (!data.success) {
      throw data.error
    }
    return data
  }

}

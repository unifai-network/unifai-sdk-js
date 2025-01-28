import { API, APIConfig, FRONTEND_API_ENDPOINT, TRANSACTION_API_ENDPOINT } from '../common';
import { ActionContext } from './context';

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
}

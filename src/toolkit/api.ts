import { API, APIConfig, FRONTEND_API_ENDPOINT } from '../common';
import { TransactionAPI } from './transaction';

export { TransactionAPI };

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

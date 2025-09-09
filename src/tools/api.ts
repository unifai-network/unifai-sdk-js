import { API, APIConfig, BACKEND_API_ENDPOINT } from '../common';

export class ToolsAPI extends API {
  constructor(config: APIConfig) {
    if (!config.endpoint) {
      config.endpoint = BACKEND_API_ENDPOINT;
    }
    super(config);
  }

  public async searchTools(args: Record<string, any>): Promise<any> {
    return await this.request('GET', '/actions/search', { params: args });
  }

  public async callTool(args: any): Promise<any> {
    return await this.request('POST', '/actions/call', { json: args, timeout: 50000 });
  }
}

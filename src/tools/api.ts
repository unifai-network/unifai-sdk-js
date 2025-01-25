import { API } from '../common';

export class ToolsAPI extends API {
  public async searchTools(args: Record<string, string>): Promise<any> {
    return await this.request('GET', '/actions/search', { params: args });
  }

  public async callTool(args: any): Promise<any> {
    return await this.request('POST', '/actions/call', { json: args, timeout: 50000 });
  }
}

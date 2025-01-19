import { API } from '../common/api';

export class ToolkitAPI extends API {
  public async updateToolkit(info: Record<string, any>): Promise<void> {
    await this.request('POST', '/toolkits/fields/', { json: info });
  }
}

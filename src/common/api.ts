export interface APIConfig {
  apiKey: string;
  endpoint?: string;
}

export class API {
  protected apiKey: string;
  protected apiUri: string;

  constructor(config: APIConfig) {
    this.apiKey = config.apiKey;
    this.apiUri = config.endpoint || '';
  }

  public setEndpoint(endpoint: string): void {
    this.apiUri = endpoint;
  }

  public async request(
    method: string,
    path: string,
    options: {
      timeout?: number;
      headers?: Record<string, any>;
      params?: Record<string, any>;
      json?: any;
      [key: string]: any;
    } = {}
  ): Promise<any> {
    const { timeout = 10000, headers = {}, params, json, ...rest } = options;

    if (!headers['Authorization']) {
      headers['Authorization'] = this.apiKey;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    // Construct the URL with query parameters
    const url = new URL(`${this.apiUri}${path}`);
    if (params) {
      Object.keys(params).forEach(key => url.searchParams.append(key, params[key]));
    }

    try {
      const response = await fetch(url.toString(), {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: json ? JSON.stringify(json) : undefined,
        signal: controller.signal,
        ...rest,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

export default API;

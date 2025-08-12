import urljoin from 'url-join';

export interface APIConfig {
  apiKey?: string;
  endpoint?: string;
}

export class APIError extends Error {
  status: number;
  responseData: any;

  constructor(status: number, responseData: any) {
    super(`API error ${status}: ${JSON.stringify(responseData)}`);
    this.name = 'APIError';
    this.status = status;
    this.responseData = responseData;
  }
}

export class API {
  protected apiKey: string;
  protected apiUri: string;

  constructor(config: APIConfig) {
    this.apiKey = config.apiKey || '';
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

    if (!headers['Authorization'] && this.apiKey) {
      headers['Authorization'] = this.apiKey;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    // Construct the URL with query parameters
    let fullUrl: string;
    
    // Check if apiUri is relative and we're in Node.js
    if (!this.apiUri.match(/^(https?:\/\/|\/\/)/i)) {
      const origin = (typeof window !== 'undefined' && window.location?.origin) || 
                     (typeof self !== 'undefined' && self.location?.origin);
      
      if (!origin) {
        throw new Error('Relative API URL not supported in Node.js environment');
      }
      
      fullUrl = urljoin(origin, this.apiUri, path);
    } else {
      fullUrl = urljoin(this.apiUri, path);
    }
    
    // Handle protocol-relative URLs by detecting current protocol or defaulting to https
    let url: URL;
    if (fullUrl.startsWith('//')) {
      const protocol = (typeof window !== 'undefined' && window.location?.protocol) || 
                       (typeof self !== 'undefined' && self.location?.protocol) || 
                       'https:';
      url = new URL(protocol + fullUrl);
    } else {
      url = new URL(fullUrl);
    }
    if (params) {
      Object.keys(params).forEach(key => {
        if (Array.isArray(params[key])) {
          // Handle arrays by appending each value with the same key
          params[key].forEach((value: any) => url.searchParams.append(key, value));
        } else {
          url.searchParams.append(key, params[key]);
        }
      });
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

      if (response.ok) {
        return await response.json();
      } else {
        let errorData;
        const clonedResponse = response.clone(); 
        try {
          errorData = await response.json();
        } catch {
          errorData = { detail: await clonedResponse.text() };
        }
        
        throw new APIError(response.status, errorData);
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

export default API;

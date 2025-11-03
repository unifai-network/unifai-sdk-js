import { RateLimiter, RateLimitGroups } from './rate-limiter';
import { Agent as HttpAgent } from 'http';
import { Agent as HttpsAgent } from 'https';
import { SocksProxyAgent } from 'socks-proxy-agent';
import axios, { AxiosInstance } from 'axios';

export interface ProxyConfig {
  protocol?: string;
  host: string;
  port: number;
  auth?: {
    username: string;
    password: string;
  };
  rejectUnauthorized?: boolean;
  fallbackToDirect?: boolean;
}

export interface APIConfig {
  endpoint?: string;
  apiKey?: string;
  apiKeyHeader?: string;
  timeout?: number;
  maxRetries?: number;
  baseRetryDelay?: number;
  rateLimitGroups?: RateLimitGroups;
  proxy?: ProxyConfig;
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
  protected apiKeyHeader: string;
  protected apiUri: string;
  protected timeout: number;
  protected maxRetries: number;
  protected baseRetryDelay: number;
  protected rateLimiter?: RateLimiter;
  protected proxyConfig?: ProxyConfig;
  protected axiosInstance: AxiosInstance;
  protected directAxiosInstance: AxiosInstance;

  constructor(config: APIConfig) {
    this.apiKey = config.apiKey || '';
    this.apiKeyHeader = config.apiKeyHeader || 'Authorization';
    this.apiUri = config.endpoint || '';
    this.timeout = config.timeout || 10000;
    this.maxRetries = config.maxRetries || 0;
    this.baseRetryDelay = config.baseRetryDelay || 1000;
    this.proxyConfig = config.proxy;

    // Initialize rate limiter if config is provided
    if (config.rateLimitGroups) {
      this.rateLimiter = new RateLimiter(config.rateLimitGroups);
    }

    // Base axios configuration
    const getBaseConfig = () => ({
      baseURL: this.apiUri,
      timeout: this.timeout,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Create axios instance with proxy support
    const axiosConfig: any = getBaseConfig();

    // Add proxy configuration based on protocol
    if (this.proxyConfig) {
      const protocol = this.proxyConfig.protocol?.toLowerCase();
      const rejectUnauthorized = this.proxyConfig.rejectUnauthorized ?? true;

      if (protocol === 'socks5' || protocol === 'socks5h') {
        // SOCKS5 proxy: use SocksProxyAgent for both HTTP and HTTPS
        const socksUrl = `${protocol}://${this.proxyConfig.auth ? `${this.proxyConfig.auth.username}:${this.proxyConfig.auth.password}@` : ''}${this.proxyConfig.host}:${this.proxyConfig.port}`;
        const socksAgent = new SocksProxyAgent(socksUrl);
        axiosConfig.httpAgent = socksAgent;
        axiosConfig.httpsAgent = socksAgent;
        // Don't set axiosConfig.proxy for SOCKS (agent handles it)
      } else {
        // HTTP/HTTPS proxy: use axios native proxy support
        axiosConfig.proxy = this.proxyConfig;

        // Add HTTPS agent configuration for HTTP/HTTPS proxies
        axiosConfig.httpsAgent = new HttpsAgent({
          rejectUnauthorized,
        });
        axiosConfig.httpAgent = new HttpAgent();
      }
    }

    this.axiosInstance = axios.create(axiosConfig);

    // Create direct axios instance without proxy for fallback
    this.directAxiosInstance = axios.create(getBaseConfig());
  }

  public setEndpoint(endpoint: string): void {
    this.apiUri = endpoint;
    this.axiosInstance.defaults.baseURL = endpoint;
    this.directAxiosInstance.defaults.baseURL = endpoint;
  }

  protected isProxyOrNetworkError(error: any): boolean {
    // If no response received, it's likely a connection/proxy/network issue
    if (!error.response) {
      return true;
    }

    const code = error.code;
    const status = error.response?.status;
    const message = error.message;

    // Proxy-specific errors
    if (code === 'EPROTO' || code === 'ERR_SSL_PROTOCOL_ERROR' || code === 'ERR_TLS_CERT_ALTNAME_INVALID') {
      return true; // SSL/TLS protocol errors
    }

    // Proxy authentication errors
    if (status === 407) {
      return true; // Proxy authentication required
    }

    // Forbidden (proxy IP may be blocked)
    if (status === 403) {
      return true;
    }

    // SOCKS5 proxy authentication failure
    if (message && message.includes('Socks5 Authentication failed')) {
      return true;
    }

    // Proxy gateway errors (proxy can't reach upstream or is overloaded)
    if (status === 502 || status === 503 || status === 504) {
      return true; // Bad Gateway, Service Unavailable, Gateway Timeout
    }

    // Connection errors that might be proxy-related
    if (
      code === 'ECONNREFUSED' || // Connection refused
      code === 'ENOTFOUND' ||    // DNS lookup failed
      code === 'ECONNRESET' ||   // Connection reset by peer
      code === 'EHOSTUNREACH' || // Host unreachable
      code === 'ENETUNREACH' ||  // Network unreachable
      code === 'EPIPE'           // Broken pipe
    ) {
      return true;
    }

    // Timeout errors
    if (
      code === 'ETIMEDOUT' ||       // Network timeout
      code === 'ESOCKETTIMEDOUT' || // Socket timeout
      code === 'ERR_SOCKET_TIMEOUT' // Socket timeout
    ) {
      return true;
    }

    // Abort/cancel errors
    if (code === 'ECONNABORTED' || code === 'ERR_CANCELED' || error.name === 'AbortError') {
      return true;
    }

    // DNS errors
    if (code === 'EAI_AGAIN') {
      return true; // DNS lookup timeout/temporary failure
    }

    return false;
  }

  protected async retryWithExponentialBackoff<T>(
    operation: () => Promise<T>,
    options: {
      maxRetries?: number;
      baseRetryDelay?: number;
    } = {},
  ): Promise<T> {
    const { maxRetries = 0, baseRetryDelay = 1000 } = options;

    if (maxRetries <= 0) {
      return await operation();
    }

    let lastError: Error;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt === maxRetries - 1) {
          throw lastError;
        }

        const delay = baseRetryDelay * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError!;
  }

  public async request(
    method: string,
    path: string,
    options: {
      timeout?: number;
      headers?: Record<string, any>;
      params?: Record<string, any>;
      json?: any;
      rateLimitEndpoint?: string;
      maxRetries?: number;
      baseRetryDelay?: number;
      [key: string]: any;
    } = {}
  ): Promise<any> {
    const { timeout, headers = {}, params, json, rateLimitEndpoint, maxRetries, baseRetryDelay, ...rest } = options;

    return this.retryWithExponentialBackoff(async () => {
      await this.rateLimiter?.waitForLimit(rateLimitEndpoint || path);

      if (!headers[this.apiKeyHeader] && this.apiKey) {
        headers[this.apiKeyHeader] = this.apiKey;
      }

      // Try with proxy first (if configured)
      try {
        const response = await this.axiosInstance.request({
          method,
          url: path,
          headers,
          params,
          data: json,
          timeout: timeout ?? this.timeout,
          ...rest,
        });
        return response.data;
      } catch (error) {
        // Check if we should fallback to direct connection
        const shouldFallback =
          this.proxyConfig &&
          (this.proxyConfig.fallbackToDirect ?? true) && // Default to true for backward compatibility
          this.isProxyOrNetworkError(error);

        if (shouldFallback) {
          // Retry without proxy using direct instance
          try {
            const response = await this.directAxiosInstance.request({
              method,
              url: path,
              headers,
              params,
              data: json,
              timeout: timeout ?? this.timeout,
              ...rest,
            });
            return response.data;
          } catch (directError) {
            // Throw the direct connection error as it's more relevant
            throw this.handleAxiosError(directError);
          }
        }

        // Not a proxy/network error, fallback disabled, or no proxy configured
        throw this.handleAxiosError(error);
      }
    }, {
      maxRetries: maxRetries ?? this.maxRetries,
      baseRetryDelay: baseRetryDelay ?? this.baseRetryDelay
    });
  }

  protected handleAxiosError(error: any): Error {
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      throw new APIError(error.response.status, error.response.data);
    } else {
      // Something happened in setting up the request or network error
      throw error;
    }
  }
}

export default API;

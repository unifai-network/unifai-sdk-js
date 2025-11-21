export const FRONTEND_API_ENDPOINT = 'https://api.unifai.network';
export const BACKEND_API_ENDPOINT = 'https://backend.unifai.network/api/v1';
export const BACKEND_WS_ENDPOINT = 'wss://backend.unifai.network/ws';
export const TRANSACTION_API_ENDPOINT = 'https://txbuilder.unifai.network/api';

export const PROXY_PROTOCOLS = {
  SOCKS5: 'socks5',
  SOCKS5H: 'socks5h',
  HTTP: 'http',
  HTTPS: 'https',
} as const;

export const ERROR_CODES = {
  // SSL/TLS protocol errors
  EPROTO: 'EPROTO',
  ERR_SSL_PROTOCOL_ERROR: 'ERR_SSL_PROTOCOL_ERROR',
  ERR_TLS_CERT_ALTNAME_INVALID: 'ERR_TLS_CERT_ALTNAME_INVALID',
  
  // Network connection errors
  ECONNREFUSED: 'ECONNREFUSED',
  ENOTFOUND: 'ENOTFOUND',
  ECONNRESET: 'ECONNRESET',
  EHOSTUNREACH: 'EHOSTUNREACH',
  ENETUNREACH: 'ENETUNREACH',
  EPIPE: 'EPIPE',
  
  // Timeout errors
  ETIMEDOUT: 'ETIMEDOUT',
  ESOCKETTIMEDOUT: 'ESOCKETTIMEDOUT',
  ERR_SOCKET_TIMEOUT: 'ERR_SOCKET_TIMEOUT',
  
  // Abort/cancel errors
  ECONNABORTED: 'ECONNABORTED',
  ERR_CANCELED: 'ERR_CANCELED',
  
  // DNS errors
  EAI_AGAIN: 'EAI_AGAIN',
} as const;

export const ERROR_NAMES = {
  ABORT_ERROR: 'AbortError',
} as const;

export const ERROR_MESSAGES = {
  SOCKS5_AUTH_FAILED: 'Socks5 Authentication failed',
} as const;

export const HTTP_STATUS = {
  FORBIDDEN: 403,
  PROXY_AUTH_REQUIRED: 407,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,
} as const;

export const DEFAULT_CONFIG = {
  POLL_INTERVAL: 5000,
  MAX_POLL_TIMES: 18,
  RECONNECT_INTERVAL: 5000,
  DEFAULT_TIMEOUT: 60000,
  MAX_RETRIES: 0,
  BASE_RETRY_DELAY: 1000,
  API_KEY_HEADER: 'Authorization',
} as const;
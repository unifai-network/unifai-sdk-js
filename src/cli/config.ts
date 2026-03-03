import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';
import { BACKEND_API_ENDPOINT } from '../common/const';

export type ValueSource = 'default' | 'config' | 'env' | 'flag';

export interface EffectiveConfig {
  apiKey: { value: string; source: ValueSource };
  endpoint: { value: string; source: ValueSource };
  timeout: { value: number; source: ValueSource };
  configPath: { value: string; source: ValueSource };
  solanaPrivateKey: { value: string; source: ValueSource };
  evmPrivateKey: { value: string; source: ValueSource };
  solanaRpcUrl: { value: string; source: ValueSource };
  ethereumRpcUrl: { value: string; source: ValueSource };
  baseRpcUrl: { value: string; source: ValueSource };
  bscRpcUrl: { value: string; source: ValueSource };
  polygonRpcUrl: { value: string; source: ValueSource };
}

interface ConfigFileData {
  api_key?: string;
  endpoint?: string;
  timeout?: number;
  solana_private_key?: string;
  evm_private_key?: string;
  solana_rpc_url?: string;
  ethereum_rpc_url?: string;
  base_rpc_url?: string;
  bsc_rpc_url?: string;
  polygon_rpc_url?: string;
}

export interface CLIFlags {
  config?: string;
  apiKey?: string;
  endpoint?: string;
  timeout?: string;
}

const DEFAULT_RPC_URLS = {
  solana: 'https://api.mainnet-beta.solana.com',
  ethereum: 'https://eth.llamarpc.com',
  base: 'https://mainnet.base.org',
  bsc: 'https://bsc-dataseed.binance.org',
  polygon: 'https://rpc-mainnet.matic.quiknode.pro',
};

const DEFAULTS = {
  endpoint: BACKEND_API_ENDPOINT,
  timeout: 60000,
};

export function defaultConfigPath(): string {
  return path.join(os.homedir(), '.config', 'unifai-cli', 'config.yaml');
}

function loadConfigFile(filePath: string): ConfigFileData {
  try {
    if (!fs.existsSync(filePath)) return {};
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = yaml.load(content);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as ConfigFileData;
  } catch {
    return {};
  }
}

function val<T>(value: T, source: ValueSource): { value: T; source: ValueSource } {
  return { value, source };
}

export function resolveConfig(flags: CLIFlags): EffectiveConfig {
  const configPath = flags.config || process.env.UNIFAI_CONFIG_PATH || defaultConfigPath();
  const configSource: ValueSource = flags.config ? 'flag' : process.env.UNIFAI_CONFIG_PATH ? 'env' : 'default';
  const file = loadConfigFile(configPath);

  function resolve(
    flagVal: string | undefined,
    envVar: string | undefined,
    fileVal: string | undefined,
    defaultVal: string,
  ): { value: string; source: ValueSource } {
    if (flagVal !== undefined && flagVal !== '') return val(flagVal, 'flag');
    if (envVar !== undefined && envVar !== '') return val(envVar, 'env');
    if (fileVal !== undefined && fileVal !== '') return val(fileVal, 'config');
    return val(defaultVal, 'default');
  }

  const apiKey = resolve(flags.apiKey, process.env.UNIFAI_AGENT_API_KEY, file.api_key, '');
  const endpoint = resolve(flags.endpoint, process.env.UNIFAI_ENDPOINT, file.endpoint, DEFAULTS.endpoint);

  const timeoutFlag = flags.timeout ? parseInt(flags.timeout, 10) : undefined;
  const timeoutEnv = process.env.UNIFAI_TIMEOUT ? parseInt(process.env.UNIFAI_TIMEOUT, 10) : undefined;
  const timeoutFile = file.timeout;
  let timeout: { value: number; source: ValueSource };
  if (timeoutFlag !== undefined && !isNaN(timeoutFlag)) {
    timeout = val(timeoutFlag, 'flag');
  } else if (timeoutEnv !== undefined && !isNaN(timeoutEnv)) {
    timeout = val(timeoutEnv, 'env');
  } else if (timeoutFile !== undefined && typeof timeoutFile === 'number' && !isNaN(timeoutFile)) {
    timeout = val(timeoutFile, 'config');
  } else {
    timeout = val(DEFAULTS.timeout, 'default');
  }

  return {
    apiKey,
    endpoint,
    timeout,
    configPath: val(configPath, configSource),
    solanaPrivateKey: resolve(undefined, process.env.SOLANA_PRIVATE_KEY, file.solana_private_key, ''),
    evmPrivateKey: resolve(undefined, process.env.EVM_PRIVATE_KEY, file.evm_private_key, ''),
    solanaRpcUrl: resolve(undefined, process.env.SOLANA_RPC_URL, file.solana_rpc_url, DEFAULT_RPC_URLS.solana),
    ethereumRpcUrl: resolve(undefined, process.env.ETHEREUM_RPC_URL, file.ethereum_rpc_url, DEFAULT_RPC_URLS.ethereum),
    baseRpcUrl: resolve(undefined, process.env.BASE_RPC_URL, file.base_rpc_url, DEFAULT_RPC_URLS.base),
    bscRpcUrl: resolve(undefined, process.env.BSC_RPC_URL, file.bsc_rpc_url, DEFAULT_RPC_URLS.bsc),
    polygonRpcUrl: resolve(undefined, process.env.POLYGON_RPC_URL, file.polygon_rpc_url, DEFAULT_RPC_URLS.polygon),
  };
}

export function requireApiKey(config: EffectiveConfig): string {
  if (!config.apiKey.value) {
    throw new Error(
      'API key is required. Set it via:\n' +
      '  --api-key flag\n' +
      '  UNIFAI_AGENT_API_KEY environment variable\n' +
      '  api_key in config file (~/.config/unifai-cli/config.yaml)',
    );
  }
  return config.apiKey.value;
}

export const CONFIG_TEMPLATE = `# UnifAI CLI Configuration
# Documentation: https://docs.unifai.network

# API key (required for most commands)
# api_key: your-api-key-here

# API endpoint (optional, defaults to production)
# endpoint: ${BACKEND_API_ENDPOINT}

# Request timeout in milliseconds (optional, default 60000)
# timeout: 60000

# Solana private key (base58, JSON array, or file path)
# solana_private_key: ""

# EVM private key (hex, with or without 0x prefix)
# evm_private_key: ""

# RPC URLs (optional, defaults to public endpoints)
# solana_rpc_url: "${DEFAULT_RPC_URLS.solana}"
# ethereum_rpc_url: "${DEFAULT_RPC_URLS.ethereum}"
# base_rpc_url: "${DEFAULT_RPC_URLS.base}"
# bsc_rpc_url: "${DEFAULT_RPC_URLS.bsc}"
# polygon_rpc_url: "${DEFAULT_RPC_URLS.polygon}"
`;

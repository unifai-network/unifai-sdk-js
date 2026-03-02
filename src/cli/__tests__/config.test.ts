import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveConfig, requireApiKey, defaultConfigPath, type CLIFlags } from '../config';
import { BACKEND_API_ENDPOINT } from '../../common/const';

jest.mock('fs');
const mockedFs = fs as jest.Mocked<typeof fs>;

describe('config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    // Remove all relevant env vars
    delete process.env.UNIFAI_AGENT_API_KEY;
    delete process.env.UNIFAI_ENDPOINT;
    delete process.env.UNIFAI_TIMEOUT;
    delete process.env.UNIFAI_CONFIG_PATH;
    delete process.env.SOLANA_PRIVATE_KEY;
    delete process.env.EVM_PRIVATE_KEY;
    delete process.env.SOLANA_RPC_URL;
    delete process.env.ETHEREUM_RPC_URL;
    delete process.env.BASE_RPC_URL;
    delete process.env.BSC_RPC_URL;
    delete process.env.POLYGON_RPC_URL;
    // Default: no config file
    mockedFs.existsSync.mockReturnValue(false);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('defaultConfigPath', () => {
    it('should return expected path', () => {
      const expected = path.join(os.homedir(), '.config', 'unifai-cli', 'config.yaml');
      expect(defaultConfigPath()).toBe(expected);
    });
  });

  describe('resolveConfig', () => {
    it('should return defaults when nothing is set', () => {
      const config = resolveConfig({});
      expect(config.endpoint.value).toBe(BACKEND_API_ENDPOINT);
      expect(config.endpoint.source).toBe('default');
      expect(config.timeout.value).toBe(60000);
      expect(config.timeout.source).toBe('default');
      expect(config.apiKey.value).toBe('');
      expect(config.apiKey.source).toBe('default');
    });

    it('should load from config file', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(
        'api_key: file-key\nendpoint: https://file.example.com\ntimeout: 30000\n'
      );

      const config = resolveConfig({});
      expect(config.apiKey.value).toBe('file-key');
      expect(config.apiKey.source).toBe('config');
      expect(config.endpoint.value).toBe('https://file.example.com');
      expect(config.endpoint.source).toBe('config');
      expect(config.timeout.value).toBe(30000);
      expect(config.timeout.source).toBe('config');
    });

    it('should override config file with env vars', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue('api_key: file-key\n');

      process.env.UNIFAI_AGENT_API_KEY = 'env-key';
      process.env.UNIFAI_ENDPOINT = 'https://env.example.com';

      const config = resolveConfig({});
      expect(config.apiKey.value).toBe('env-key');
      expect(config.apiKey.source).toBe('env');
      expect(config.endpoint.value).toBe('https://env.example.com');
      expect(config.endpoint.source).toBe('env');
    });

    it('should override env vars with flags', () => {
      process.env.UNIFAI_AGENT_API_KEY = 'env-key';

      const config = resolveConfig({ apiKey: 'flag-key', endpoint: 'https://flag.example.com', timeout: '5000' });
      expect(config.apiKey.value).toBe('flag-key');
      expect(config.apiKey.source).toBe('flag');
      expect(config.endpoint.value).toBe('https://flag.example.com');
      expect(config.endpoint.source).toBe('flag');
      expect(config.timeout.value).toBe(5000);
      expect(config.timeout.source).toBe('flag');
    });

    it('should handle missing config file gracefully', () => {
      mockedFs.existsSync.mockReturnValue(false);
      const config = resolveConfig({});
      expect(config.endpoint.value).toBe(BACKEND_API_ENDPOINT);
    });

    it('should handle malformed YAML gracefully', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(': : : bad yaml');

      // Should not throw
      const config = resolveConfig({});
      expect(config.endpoint.value).toBe(BACKEND_API_ENDPOINT);
    });

    it('should resolve private key env vars', () => {
      process.env.SOLANA_PRIVATE_KEY = 'sol-key';
      process.env.EVM_PRIVATE_KEY = 'evm-key';

      const config = resolveConfig({});
      expect(config.solanaPrivateKey.value).toBe('sol-key');
      expect(config.solanaPrivateKey.source).toBe('env');
      expect(config.evmPrivateKey.value).toBe('evm-key');
      expect(config.evmPrivateKey.source).toBe('env');
    });

    it('should resolve RPC URL env vars', () => {
      process.env.SOLANA_RPC_URL = 'https://solana.rpc';
      process.env.ETHEREUM_RPC_URL = 'https://eth.rpc';
      process.env.BASE_RPC_URL = 'https://base.rpc';
      process.env.BSC_RPC_URL = 'https://bsc.rpc';
      process.env.POLYGON_RPC_URL = 'https://polygon.rpc';

      const config = resolveConfig({});
      expect(config.solanaRpcUrl.value).toBe('https://solana.rpc');
      expect(config.ethereumRpcUrl.value).toBe('https://eth.rpc');
      expect(config.baseRpcUrl.value).toBe('https://base.rpc');
      expect(config.bscRpcUrl.value).toBe('https://bsc.rpc');
      expect(config.polygonRpcUrl.value).toBe('https://polygon.rpc');
    });
  });

  describe('requireApiKey', () => {
    it('should throw when API key is empty', () => {
      const config = resolveConfig({});
      expect(() => requireApiKey(config)).toThrow('API key is required');
    });

    it('should return key when set', () => {
      process.env.UNIFAI_AGENT_API_KEY = 'my-key';
      const config = resolveConfig({});
      expect(requireApiKey(config)).toBe('my-key');
    });
  });
});

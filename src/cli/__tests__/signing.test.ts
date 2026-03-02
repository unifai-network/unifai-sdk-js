import * as fs from 'fs';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import {
  parseChainFromTxId,
  createSolanaSignerFromKey,
  createEVMSignerFromKey,
  getSignerForChain,
  getRpcUrlForChain,
  buildSendConfig,
  executeSigningFlow,
} from '../signing';
import type { EffectiveConfig } from '../config';

jest.mock('ethers', () => {
  const mockWallet = {
    address: '0xMockAddress',
    sendTransaction: jest.fn(),
    signTypedData: jest.fn(),
  };
  return {
    Wallet: jest.fn().mockReturnValue(mockWallet),
    JsonRpcProvider: jest.fn(),
  };
});

jest.mock('../../toolkit/transaction/index', () => ({
  TransactionAPI: jest.fn().mockImplementation(() => ({
    signAndSendTransaction: jest.fn().mockResolvedValue({
      hash: ['0xhash123'],
      data: { key: 'val' },
    }),
  })),
}));

jest.mock('../../toolkit/types', () => ({
  getSignerAddress: jest.fn().mockResolvedValue('mockAddress'),
}));

function makeConfig(overrides: Partial<Record<keyof EffectiveConfig, { value: any; source: string }>> = {}): EffectiveConfig {
  const defaults: EffectiveConfig = {
    apiKey: { value: 'test-key', source: 'default' },
    endpoint: { value: 'https://backend.unifai.network/api/v1', source: 'default' },
    timeout: { value: 60000, source: 'default' },
    configPath: { value: '/tmp/config.yaml', source: 'default' },
    solanaPrivateKey: { value: '', source: 'default' },
    evmPrivateKey: { value: '', source: 'default' },
    solanaRpcUrl: { value: '', source: 'default' },
    ethereumRpcUrl: { value: '', source: 'default' },
    baseRpcUrl: { value: '', source: 'default' },
    bscRpcUrl: { value: '', source: 'default' },
    polygonRpcUrl: { value: '', source: 'default' },
  };
  return { ...defaults, ...overrides } as EffectiveConfig;
}

describe('signing', () => {
  describe('parseChainFromTxId', () => {
    it('should parse solana chain', () => {
      expect(parseChainFromTxId('solana-abc123')).toBe('solana');
    });

    it('should parse ethereum chain', () => {
      expect(parseChainFromTxId('ethereum-0xdef')).toBe('ethereum');
    });

    it('should return empty for no dash', () => {
      expect(parseChainFromTxId('nodash')).toBe('');
    });

    it('should return empty for empty string', () => {
      expect(parseChainFromTxId('')).toBe('');
    });

    it('should handle multiple dashes', () => {
      expect(parseChainFromTxId('base-tx-extra-stuff')).toBe('base');
    });
  });

  describe('createSolanaSignerFromKey', () => {
    it('should create signer from base58 key', () => {
      const keypair = Keypair.generate();
      const base58Key = bs58.encode(keypair.secretKey);
      const signer = createSolanaSignerFromKey(base58Key);
      expect(signer.publicKey.toBase58()).toBe(keypair.publicKey.toBase58());
      expect(typeof signer.signTransaction).toBe('function');
    });

    it('should create signer from JSON array string', () => {
      const keypair = Keypair.generate();
      const jsonArr = JSON.stringify(Array.from(keypair.secretKey));
      const signer = createSolanaSignerFromKey(jsonArr);
      expect(signer.publicKey.toBase58()).toBe(keypair.publicKey.toBase58());
    });

    it('should handle invalid base58 key gracefully', () => {
      expect(() => createSolanaSignerFromKey('')).toThrow();
    });
  });

  describe('createEVMSignerFromKey', () => {
    it('should create signer with 0x prefix', () => {
      const signer = createEVMSignerFromKey('0xabc123', 'https://rpc.example.com');
      expect(signer.address).toBe('0xMockAddress');
      expect(typeof signer.sendTransaction).toBe('function');
      expect(typeof signer.signTypedData).toBe('function');
    });

    it('should create signer without 0x prefix', () => {
      const signer = createEVMSignerFromKey('abc123', 'https://rpc.example.com');
      expect(signer.address).toBe('0xMockAddress');
    });
  });

  describe('getRpcUrlForChain', () => {
    it('should return correct URL for each chain', () => {
      const config = makeConfig({
        solanaRpcUrl: { value: 'https://sol.rpc', source: 'env' },
        ethereumRpcUrl: { value: 'https://eth.rpc', source: 'env' },
        baseRpcUrl: { value: 'https://base.rpc', source: 'env' },
        bscRpcUrl: { value: 'https://bsc.rpc', source: 'env' },
        polygonRpcUrl: { value: 'https://polygon.rpc', source: 'env' },
      });

      expect(getRpcUrlForChain('solana', config)).toBe('https://sol.rpc');
      expect(getRpcUrlForChain('ethereum', config)).toBe('https://eth.rpc');
      expect(getRpcUrlForChain('base', config)).toBe('https://base.rpc');
      expect(getRpcUrlForChain('bsc', config)).toBe('https://bsc.rpc');
      expect(getRpcUrlForChain('polygon', config)).toBe('https://polygon.rpc');
      expect(getRpcUrlForChain('polymarket', config)).toBe('https://polygon.rpc');
    });

    it('should return empty for unknown chain', () => {
      const config = makeConfig();
      expect(getRpcUrlForChain('unknown', config)).toBe('');
      expect(getRpcUrlForChain('hyperliquid', config)).toBe('');
    });
  });

  describe('getSignerForChain', () => {
    it('should throw when solana key is missing', () => {
      const config = makeConfig();
      expect(() => getSignerForChain('solana', config)).toThrow('Solana private key is required');
    });

    it('should throw when EVM key is missing', () => {
      const config = makeConfig();
      expect(() => getSignerForChain('ethereum', config)).toThrow('EVM private key is required');
    });

    it('should throw when RPC URL is missing for EVM chain', () => {
      const config = makeConfig({
        evmPrivateKey: { value: '0xabc', source: 'env' },
      });
      expect(() => getSignerForChain('ethereum', config)).toThrow('RPC URL is required');
    });

    it('should throw for unsupported chain', () => {
      const config = makeConfig();
      expect(() => getSignerForChain('unsupported', config)).toThrow('Unsupported chain');
    });

    it('should create EVM signer for supported EVM chains', () => {
      const config = makeConfig({
        evmPrivateKey: { value: '0xabc', source: 'env' },
        ethereumRpcUrl: { value: 'https://eth.rpc', source: 'env' },
        baseRpcUrl: { value: 'https://base.rpc', source: 'env' },
        bscRpcUrl: { value: 'https://bsc.rpc', source: 'env' },
        polygonRpcUrl: { value: 'https://polygon.rpc', source: 'env' },
      });

      for (const chain of ['ethereum', 'base', 'bsc', 'polygon', 'polymarket']) {
        const signer = getSignerForChain(chain, config);
        expect(signer).toBeDefined();
        expect((signer as any).address).toBe('0xMockAddress');
      }
    });

    it('should create hyperliquid signer without RPC URL', () => {
      const config = makeConfig({
        evmPrivateKey: { value: '0xabc', source: 'env' },
      });
      const signer = getSignerForChain('hyperliquid', config);
      expect(signer).toBeDefined();
      expect((signer as any).address).toBe('0xMockAddress');
    });

    it('should throw when EVM key is missing for hyperliquid', () => {
      const config = makeConfig();
      expect(() => getSignerForChain('hyperliquid', config)).toThrow('EVM private key is required');
    });
  });

  describe('buildSendConfig', () => {
    it('should return rpcUrls for solana when configured', () => {
      const config = makeConfig({
        solanaRpcUrl: { value: 'https://my-solana-rpc.com', source: 'env' },
      });
      const sendConfig = buildSendConfig('solana', config);
      expect(sendConfig).toEqual({ rpcUrls: ['https://my-solana-rpc.com'] });
    });

    it('should return undefined for solana when no RPC configured', () => {
      const config = makeConfig();
      expect(buildSendConfig('solana', config)).toBeUndefined();
    });

    it('should return undefined for non-solana chains', () => {
      const config = makeConfig({
        ethereumRpcUrl: { value: 'https://eth.rpc', source: 'env' },
      });
      expect(buildSendConfig('ethereum', config)).toBeUndefined();
    });
  });

  describe('executeSigningFlow', () => {
    it('should return structured result', async () => {
      const mockSigner = { publicKey: { toBase58: () => 'solPubKey' }, signTransaction: jest.fn() };
      const result = await executeSigningFlow('api-key', 'solana-123', mockSigner as any);
      expect(result.address).toBe('mockAddress');
      expect(result.txId).toBe('solana-123');
      expect(result.hash).toEqual(['0xhash123']);
      expect(result.data).toEqual({ key: 'val' });
    });

    it('should pass rpcUrls via SendConfig when config has solana RPC', async () => {
      const { TransactionAPI } = require('../../toolkit/transaction/index');
      const mockSignAndSend = jest.fn().mockResolvedValue({ hash: ['0xhash'] });
      TransactionAPI.mockImplementation(() => ({
        signAndSendTransaction: mockSignAndSend,
      }));

      const mockSigner = { publicKey: { toBase58: () => 'solPubKey' }, signTransaction: jest.fn() };
      const config = makeConfig({
        solanaRpcUrl: { value: 'https://my-rpc.com', source: 'env' },
      });

      await executeSigningFlow('api-key', 'solana-123', mockSigner as any, config);
      expect(mockSignAndSend).toHaveBeenCalledWith(
        'solana-123',
        mockSigner,
        { rpcUrls: ['https://my-rpc.com'] },
      );
    });
  });
});

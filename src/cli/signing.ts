import * as fs from 'fs';
import { Keypair, VersionedTransaction } from '@solana/web3.js';
import { Wallet, JsonRpcProvider } from 'ethers';
import bs58 from 'bs58';
import { TransactionAPI } from '../toolkit/transaction/index';
import { getSignerAddress } from '../toolkit/types';
import type { SolanaSigner, EtherSigner, Signer, SendConfig } from '../toolkit/types';
import type { EffectiveConfig } from './config';

export function parseChainFromTxId(txId: string): string {
  if (!txId || !txId.includes('-')) return '';
  return txId.split('-')[0].toLowerCase();
}

export function createSolanaSignerFromKey(privateKey: string): SolanaSigner {
  let keypair: Keypair;

  // Try as file path first
  if (fs.existsSync(privateKey)) {
    const content = fs.readFileSync(privateKey, 'utf-8').trim();
    const arr = JSON.parse(content);
    keypair = Keypair.fromSecretKey(Uint8Array.from(arr));
  } else if (privateKey.startsWith('[')) {
    // JSON array string
    const arr = JSON.parse(privateKey);
    keypair = Keypair.fromSecretKey(Uint8Array.from(arr));
  } else {
    // Base58 string
    keypair = Keypair.fromSecretKey(bs58.decode(privateKey));
  }

  const signOne = (tx: any) => {
    if (tx instanceof VersionedTransaction) {
      tx.sign([keypair]); // VersionedTransaction.sign(signers: Signer[])
    } else {
      tx.sign(keypair); // Transaction.sign(...signers: Signer[])
    }
  };

  return {
    publicKey: keypair.publicKey,
    signTransaction: async (tx: any) => {
      signOne(tx);
      return tx;
    },
    signAllTransactions: async (txs: any[]) => {
      for (const tx of txs) {
        signOne(tx);
      }
      return txs;
    },
  };
}

export function createEVMSignerFromKey(privateKey: string, rpcUrl: string): EtherSigner {
  const key = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
  const provider = new JsonRpcProvider(rpcUrl);
  const wallet = new Wallet(key, provider);

  return {
    address: wallet.address,
    sendTransaction: wallet.sendTransaction.bind(wallet),
    signTypedData: wallet.signTypedData.bind(wallet),
  };
}

export function getRpcUrlForChain(chain: string, config: EffectiveConfig): string {
  switch (chain) {
    case 'solana':
      return config.solanaRpcUrl.value;
    case 'ethereum':
      return config.ethereumRpcUrl.value;
    case 'base':
      return config.baseRpcUrl.value;
    case 'bsc':
      return config.bscRpcUrl.value;
    case 'polygon':
    case 'polymarket':
      return config.polygonRpcUrl.value;
    default:
      return '';
  }
}

function requireEvmKey(config: EffectiveConfig): string {
  const key = config.evmPrivateKey.value;
  if (!key) {
    throw new Error(
      'EVM private key is required for signing. Set EVM_PRIVATE_KEY environment variable or evm_private_key in config file.',
    );
  }
  return key;
}

export function getSignerForChain(chain: string, config: EffectiveConfig): Signer {
  if (chain === 'solana') {
    const key = config.solanaPrivateKey.value;
    if (!key) {
      throw new Error(
        'Solana private key is required for signing. Set SOLANA_PRIVATE_KEY environment variable or solana_private_key in config file.',
      );
    }
    return createSolanaSignerFromKey(key);
  }

  // Hyperliquid uses its own API for signing — no RPC URL needed
  if (chain === 'hyperliquid') {
    const key = requireEvmKey(config);
    const normalizedKey = key.startsWith('0x') ? key : `0x${key}`;
    const wallet = new Wallet(normalizedKey);
    return {
      address: wallet.address,
      sendTransaction: wallet.sendTransaction.bind(wallet),
      signTypedData: wallet.signTypedData.bind(wallet),
    };
  }

  // EVM-compatible chains (polymarket uses polygon RPC)
  const evmChains = ['ethereum', 'base', 'bsc', 'polygon', 'polymarket'];
  if (evmChains.includes(chain)) {
    const key = requireEvmKey(config);
    const rpcUrl = getRpcUrlForChain(chain, config);
    if (!rpcUrl) {
      throw new Error(
        `RPC URL is required for chain "${chain}". Set the appropriate RPC URL environment variable or config value.`,
      );
    }
    return createEVMSignerFromKey(key, rpcUrl);
  }

  throw new Error(`Unsupported chain: ${chain}`);
}

export function buildSendConfig(chain: string, config: EffectiveConfig): SendConfig | undefined {
  if (chain === 'solana') {
    const rpcUrl = config.solanaRpcUrl.value;
    if (rpcUrl) {
      return { rpcUrls: [rpcUrl] };
    }
  }
  return undefined;
}

export async function executeSigningFlow(
  apiKey: string,
  txId: string,
  signer: Signer,
  config?: EffectiveConfig,
): Promise<{ address: string; txId: string; hash?: string[]; data?: any; error?: any }> {
  const txApi = new TransactionAPI({ apiKey });
  const address = await getSignerAddress(signer);

  let sendConfig: SendConfig | undefined;
  if (config) {
    const chain = parseChainFromTxId(txId);
    sendConfig = buildSendConfig(chain, config);
  }

  const result = await txApi.signAndSendTransaction(txId, signer, sendConfig);

  return {
    address,
    txId,
    hash: result.hash,
    data: result.data,
    error: result.error,
  };
}

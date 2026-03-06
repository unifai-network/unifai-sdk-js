import { config } from 'dotenv';
import OpenAI from 'openai';
import { Tools } from '../src';
import { TransactionAPI } from '../src/toolkit/transaction/index';
import { Wallet, JsonRpcProvider } from 'ethers';
import { Keypair, VersionedTransaction } from '@solana/web3.js';
import nacl from 'tweetnacl';
// @ts-ignore
const bs58 = require('bs58');

config({ path: 'examples/.env' });


const EVM_PRIVATE_KEY = process.env.EVM_PRIVATE_KEY || '';
const EVM_RPC_URL = process.env.EVM_RPC_URL || '';
const SOLANA_PRIVATE_KEY = process.env.SOLANA_PRIVATE_KEY || '';

async function run(msg: string) {
  const tools = new Tools({ apiKey: process.env.UNIFAI_AGENT_API_KEY || '' });
  const txnApi = new TransactionAPI({
    endpoint: 'http://localhost:8001/api',
    apiKey: process.env.UNIFAI_AGENT_API_KEY || ''
  });


  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.deepseek.com/v1/',
  });

  // Initialize unified signer that automatically routes to correct chain
  // Create EVM wallet with provider
  let evmWallet: Wallet | null = null;
  if (EVM_PRIVATE_KEY) {
    if (!EVM_RPC_URL) {
      throw new Error('EVM_RPC_URL is required when using EVM_PRIVATE_KEY');
    }
    const provider = new JsonRpcProvider(EVM_RPC_URL);
    evmWallet = new Wallet(EVM_PRIVATE_KEY, provider);
  }

  // Support multiple Solana private key formats
  const solanaKeypair = SOLANA_PRIVATE_KEY ? (() => {
    try {
      // Try as base58 string (most common, from Phantom/Solflare export)
      if (SOLANA_PRIVATE_KEY.length > 80 && !SOLANA_PRIVATE_KEY.startsWith('[')) {
        return Keypair.fromSecretKey(bs58.decode(SOLANA_PRIVATE_KEY));
      }
      // Try as JSON array (e.g., [1,2,3,...])
      if (SOLANA_PRIVATE_KEY.startsWith('[')) {
        return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(SOLANA_PRIVATE_KEY)));
      }
      // Try as hex string
      return Keypair.fromSecretKey(Buffer.from(SOLANA_PRIVATE_KEY, 'hex'));
    } catch (error) {
      console.error('Failed to parse Solana private key:', error);
      return null;
    }
  })() : null;

  const signer: any = {
    // Spread Solana signer methods (publicKey, signTransaction)
    ...(solanaKeypair && {
      publicKey: solanaKeypair.publicKey,
      signTransaction: async (tx: any) => {
        if (tx instanceof VersionedTransaction) {
          tx.sign([solanaKeypair]);
        } else {
          tx.sign(solanaKeypair);
        }
        return tx;
      },
      signMessage: async (message: Uint8Array) => {
        const signature = nacl.sign.detached(message, solanaKeypair.secretKey);
        return signature;
      }
    }),
  };

  const systemPrompt = `You are a trading platforms assistant. 
  When the user wants to trade on Pacifica,:
  1. First, use retrieveMarket to find the market symbol and market details.
  2. Then, use the retrieved information to call placeLimitOrder or placeMarketOrder or cancelOrder based on the user's intent.
  3. Always output standard tool_calls.`;

  // const systemPrompt = `You are a trading platforms assistant. 
  // When the user wants to cancel an order on Pacifica,
  // 1. If the user wants to cancel a SPECIFIC order, first user retrieveMarket to find market symbols, then call cancelOrder.
  // 2. If the user wants to cancel ALL orders, call cancelAllOrders.
  // 3. Information Retrieval: If you lack a market symbol or order ID, always use the retrieval tools first.
  // 4. Always output standard tool_calls.`;

  const messages: any[] = [
    { content: systemPrompt, role: 'system' },
    { content: msg, role: 'user' },
  ];


  const availableTools = await tools.getTools({ staticToolkits: ['Pacifica'] });

  while (true) {
    const response = await openai.chat.completions.create({
      model: 'deepseek-chat',
      messages,
      tools: availableTools,
    });

    const message = response.choices[0].message;
    messages.push(message);

    if (message.content) console.log(`[Assistant]: ${message.content}`);

    if (!message.tool_calls || message.tool_calls.length === 0) break;

    console.log('🛠 toolkit:', message.tool_calls.map(tc => tc.function.name));


    const results = await tools.callTools(message.tool_calls);


    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.content && typeof result.content === 'string') {
        try {
          const parsed = JSON.parse(result.content);

          const txId = parsed?.payload?.txId || parsed?.txId;

          if (txId) {

            const txResult = await txnApi.signAndSendTransaction(txId, signer);

            if (txResult.hash) {
              parsed.payload = { ...parsed.payload, status: 'success', hash: txResult.hash };
              results[i].content = JSON.stringify(parsed);
            }
          }
        } catch (e) {
          console.error('error:', e);
        }
      }
    }

    messages.push(...results);
  }
}


// run("Place a limit order to buy 0.13 SOL at $83 on the Pacifica SOL market.").catch(console.error);
// run("Place a market order to buy 0.12 SOL on the Pacifica SOL market.").catch(console.error);
// run("Cancel my order with ID 5801807344 on the Pacifica SOL market.");
run("Use the toolkit to cancel all my orders on Pacifica.");
import { config } from 'dotenv';
import OpenAI from 'openai';
import { Tools, TransactionAPI } from '../dist';
import { Wallet } from 'ethers';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

config({ path: 'examples/.env' });

// Load private keys from env or file
const EVM_PRIVATE_KEY = process.env.EVM_PRIVATE_KEY || '';
const SOLANA_PRIVATE_KEY = process.env.SOLANA_PRIVATE_KEY || '';

async function run(msg: string) {
  const tools = new Tools({ apiKey: process.env.UNIFAI_AGENT_API_KEY || '' });
  const txnApi = new TransactionAPI({ apiKey: process.env.UNIFAI_AGENT_API_KEY || '' });
  const openai = new OpenAI({
    apiKey: process.env.ANTHROPIC_API_KEY,
    baseURL: 'https://api.anthropic.com/v1/',
  });

  // Initialize unified signer that automatically routes to correct chain
  const evmWallet = EVM_PRIVATE_KEY ? new Wallet(EVM_PRIVATE_KEY) : null;

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
    // Spread EVM wallet methods (address, sendTransaction, signTypedData)
    ...(evmWallet && {
      address: evmWallet.address,
      sendTransaction: evmWallet.sendTransaction.bind(evmWallet),
      signTypedData: evmWallet.signTypedData.bind(evmWallet),
    }),
    // Spread Solana signer methods (publicKey, signTransaction)
    ...(solanaKeypair && {
      publicKey: solanaKeypair.publicKey,
      signTransaction: async (tx: any) => { tx.sign([solanaKeypair]); return tx; },
    }),
  };

  const systemPrompt = `You are a personal assistant capable of doing many things with your tools.`;

  const messages: any[] = [
    { content: systemPrompt, role: 'system' },
    { content: msg, role: 'user' },
  ];

  const availableTools = await tools.getTools({ dynamicTools: true });

  while (true) {
    const response = await openai.chat.completions.create({
      model: 'claude-sonnet-4-5',
      messages,
      tools: availableTools,
    });

    const message = response.choices[0].message;

    if (message.content) {
      console.log(message.content);
    }

    messages.push(message);

    if (!message.tool_calls || message.tool_calls.length === 0) {
      break;
    }

    console.log('Calling tools:', message.tool_calls.map(tc => tc.function.name));

    const results = await tools.callTools(message.tool_calls);

    // Check for txId in results and automatically sign & send
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.content && typeof result.content === 'string') {
        try {
          const parsed = JSON.parse(result.content);
          const response = parsed?.payload;
          const txId = response?.txId;

          if (txId && typeof txId === 'string') {
            console.log(`Detected txId: ${txId}, signing and sending...`);

            // Remove the transaction approval message to avoid confusion
            delete response.message;

            try {
              const txResult = await txnApi.signAndSendTransaction(txId, signer);

              if (txResult.hash) {
                console.log(`✅ Transaction sent: ${txResult.hash.join(', ')}`);
                response.message = 'Transaction sent successfully';
                response.hashes = txResult.hash;
              }

              if (txResult.data) {
                response.data = txResult.data;
              }

              if (txResult.error) {
                response.error = txResult.error;
              }

              parsed.payload = response;
              results[i].content = JSON.stringify(parsed);
            } catch (error: any) {
              console.error(`❌ Transaction failed: ${error.message}`);
              response.error = error.message;
              parsed.payload = response;
              results[i].content = JSON.stringify(parsed);
            }
          }
        } catch (parseError) {
          // Not JSON or doesn't contain txId, skip
          continue;
        }
      }
    }

    if (results.length === 0) {
      break;
    }

    messages.push(...results);
  }
}

if (require.main === module) {
  const msg = process.argv.slice(2).join(' ');
  if (!msg) {
    console.log('Usage: npm run use-tools-txn "your message here"');
    console.log('Example: npm run use-tools-txn "swap 0.01 SOL to USDC"');
    console.log('\nEnvironment variables required:');
    console.log('  UNIFAI_AGENT_API_KEY - UnifAI API key');
    console.log('  ANTHROPIC_API_KEY - Anthropic API key');
    console.log('  EVM_PRIVATE_KEY - EVM wallet private key (if you plan to send evm transactions)');
    console.log('  SOLANA_PRIVATE_KEY - Solana wallet private key in hex (if you plan to send solana transactions)');
    process.exit(1);
  }

  run(msg).catch(console.error);
}

---
name: unifai
description: Search, invoke, and sign transactions with UnifAI tools from the command line
allowed-tools:
  - Bash(unifai:*)
  - Bash(npx -p unifai-sdk unifai:*)
version: "1.0.0"
openclaw:
  requires:
    env:
      - UNIFAI_AGENT_API_KEY
    bins:
      - npx
  optional-env:
    - SOLANA_PRIVATE_KEY
    - EVM_PRIVATE_KEY
    - SOLANA_RPC_URL
    - ETHEREUM_RPC_URL
    - BASE_RPC_URL
    - BSC_RPC_URL
    - POLYGON_RPC_URL
---

# UnifAI CLI Skill

The `unifai` CLI lets you search for tools, invoke actions, and sign blockchain transactions from the command line. It is designed for AI agent use.

## Installation

```bash
# Global install
npm install -g unifai-sdk

# Or use via npx (no install needed)
npx -p unifai-sdk unifai <command>
```

## Setup

Set your API key:

```bash
export UNIFAI_AGENT_API_KEY="your-key-here"
```

Or create a config file:

```bash
unifai config init
# Edit ~/.config/unifai-cli/config.yaml
```

## Commands

### Search for tools

Always returns JSON with full payload schemas (best for agents):

```bash
unifai search --query "solana swap"
unifai search --query "token price" --limit 5
```

Compact numbered list (strips schemas):

```bash
unifai search --query "solana" --no-schema
```

### Invoke an action

```bash
unifai invoke --action "Solana--7--getBalance" --payload '{"address":"..."}'
```

With transaction signing:

```bash
unifai invoke --action "Solana--7--transfer" --payload '{"toWalletAddress":"...","amount":0.01}' --sign
```

Payload from file:

```bash
unifai invoke --action "MyAction" --payload @payload.json
```

### Sign a transaction

```bash
unifai tx sign <txId>
unifai tx sign <txId> --json
```

### Configuration

```bash
unifai config init          # Create config file
unifai config show          # Show current config and sources
unifai config show --json   # JSON output
```

### Version

```bash
unifai version
unifai --version
```

## Agent Workflow

**CRITICAL: Always search before invoking.** Each action has its own field names (e.g. `toWalletAddress` for Solana, `recipientWalletAddress` for Polygon). Do NOT guess field names — they will fail silently or return cryptic server errors.

1. **Search** to get the action ID and exact payload schema:
   ```bash
   unifai search --query "swap SOL to USDC"
   ```

2. **Read the `payload` field** in the JSON response. It contains every field name, type, and whether it's required. Use these exact field names.

3. **Invoke** with the correct payload:
   ```bash
   unifai invoke --action "Jupiter--5--swap" --payload '{"inputToken":"SOL","outputToken":"USDC","inAmount":0.1}' --sign
   ```

4. If `--sign` is used and the response contains a `txId`, the transaction is automatically signed and submitted locally.

## Important: Field Names Are Not Guessable

Different actions use different field names for similar concepts. Examples:

| Action | "Send to" field | "Amount" field |
|--------|----------------|----------------|
| `Solana--7--transfer` | `toWalletAddress` | `amount` |
| `Polygon--160--transfer` | `recipientWalletAddress` | `amount` |
| `Jupiter--5--swap` | `outputToken` | `inAmount` |

**Always use `unifai search` first** and read the payload schema. Never guess field names.

## Understanding Errors

- **`Error: API key is required`** — Set `UNIFAI_AGENT_API_KEY` env var
- **`Error: ... private key is required`** — Set `SOLANA_PRIVATE_KEY` or `EVM_PRIVATE_KEY` for signing
- **`Error: RPC URL is required`** — Public defaults are provided, but you can override with env vars (e.g. `POLYGON_RPC_URL`)
- **Server-side errors** (e.g. `"error": "Failed to create transaction: ..."`) — Usually wrong field names or invalid values. Re-check the payload schema from `unifai search`
- **`--sign` with no txId** — Normal. The action didn't need signing; the response is returned as-is

## Transaction Signing

Transaction signing is optional and requires private keys via environment variables:

- `SOLANA_PRIVATE_KEY` — Solana key (base58, JSON array, or path to keystore file from `solana-keygen`)
- `EVM_PRIVATE_KEY` — EVM key (hex, with or without 0x prefix). Used for Ethereum, Polygon, Base, BSC, Hyperliquid, and Polymarket

RPC URLs (optional, public defaults are provided):

- `SOLANA_RPC_URL` — default: `https://api.mainnet-beta.solana.com`
- `ETHEREUM_RPC_URL` — default: `https://eth.llamarpc.com`
- `BASE_RPC_URL` — default: `https://mainnet.base.org`
- `BSC_RPC_URL` — default: `https://bsc-dataseed.binance.org`
- `POLYGON_RPC_URL` — default: `https://rpc-mainnet.matic.quiknode.pro`

Public RPCs are rate-limited. Set your own RPC URLs for production use.

All signing happens locally within the CLI process. Private keys are used only by the local `@solana/web3.js` and `ethers` libraries to sign transactions before submission. The CLI source code is available at https://github.com/unifai-network/unifai-sdk-js/tree/main/src/cli.

## Common Examples

```bash
# Step 1: Always search first to get the exact schema
unifai search --query "solana transfer"

# Solana transfer (uses toWalletAddress, not "to")
unifai invoke --action "Solana--7--transfer" \
  --payload '{"toWalletAddress":"...","amount":0.01}' --sign

# Jupiter swap on Solana
unifai invoke --action "Jupiter--5--swap" \
  --payload '{"inputToken":"SOL","outputToken":"USDC","inAmount":0.1}' --sign

# Polygon transfer (uses recipientWalletAddress)
unifai invoke --action "Polygon--160--transfer" \
  --payload '{"recipientWalletAddress":"0x...","amount":0.01}' --sign

# Polymarket - get open orders (read-only, but still needs signing)
unifai invoke --action "polymarket--127--getOpenOrders" --payload '{}' --sign

# Read-only actions don't need --sign
unifai invoke --action "Birdeye--174--RetrieveTheLatestPrice" \
  --payload '{"address":"So11111111111111111111111111111111111111112","chain":"solana"}'

# Search for any capability
unifai search --query "weather forecast"
unifai search --query "sports scores"
```

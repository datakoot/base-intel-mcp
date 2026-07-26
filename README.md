# Base Intel MCP — by Datakoot

Read-only on-chain intelligence for AI agents on **Base**. No API keys.

Give an agent a Base address, token, or transaction hash and it reads balances, token metadata, gas, and transaction status live from chain.

## Tools

| Tool | What it does |
|---|---|
| `address_report` | ETH + USDC balance, tx count, and contract check for an address |
| `token_info` | ERC-20 name, symbol, decimals, total supply |
| `token_balance` | Any ERC-20 balance for any holder (formatted + raw) |
| `gas_now` | Current Base gas price (gwei + wei) |
| `tx_status` | Transaction status, from/to, value, block, gas used |

No API keys required. Data read live from Base mainnet public RPC (with fallbacks).

## Quick start (hosted)

```bash
claude mcp add --transport http base-intel https://base.datakoot.com/mcp
```

## Example agent workflows

- "What is in wallet 0x... on Base?" -> `address_report`
- "What token is 0x833589... and what is its supply?" -> `token_info`
- "Did transaction 0x... succeed?" -> `tx_status`

Part of [Datakoot](https://datakoot.com) — intelligence APIs for AI agents.

## License

MIT. On-chain data via public Base RPC. Read-only; informational only, not financial advice.

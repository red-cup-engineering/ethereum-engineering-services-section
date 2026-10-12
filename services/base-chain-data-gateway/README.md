# Base chain-data gateway

Three keyless-public-RPC Base network chain-data reads, owned here as pure operations and sold by the call through the one market, market.
561.group (`@red-cup-engineering/market-561-group`):

- `readAddressBalance({ address })` -- native ETH balance (`eth_getBalance`).
- `readGasOracle()` -- current network gas price (`eth_gasPrice`).
- `readTransactionByHash({ hash })` -- one transaction by hash (`eth_getTransactionByHash`).

Each read is proxied from a free, keyless public Base JSON-RPC endpoint (`rpcUrl`, default `https://mainnet.base.org`); no paid RPC provider is used.
This package carries no transport, payment boundary, domain, or runner of its own: the market's catalog names these exports as its `base-chain` offers (`GET /v1/base-chain/balance`, `/v1/base-chain/gas-oracle`, `/v1/base-chain/transaction`, at $0.001, $0.001, and $0.002) and the market prices, admits, settles, and witnesses them.
The Cloudflare Worker, its `wrangler.toml`, and the base-chain.
561.group origin were retired on the Founder's 2026-09-11 one-market ruling; the prior 402index listing is kept under the market app's `data/records/legacy/base-chain-data-gateway/`.

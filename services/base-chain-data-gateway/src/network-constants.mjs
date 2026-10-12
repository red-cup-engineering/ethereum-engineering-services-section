// Network constants for the base-chain gateway. Kept out of worker.mjs because the
// Workers runtime reads every named export of the entry module as an entrypoint and
// refuses a plain value there ("not of type 'function or ExportedHandler'").
export const MAINNET_NETWORK = "eip155:8453";
export const SEPOLIA_NETWORK = "eip155:84532";
export const DEFAULT_NETWORK = SEPOLIA_NETWORK;
export const DEFAULT_BASE_RPC_URL = "https://mainnet.base.org";
/** Coinbase's official free, keyless x402 facilitator; verified live for the "exact" scheme on eip155:84532 only. */
export const PUBLIC_TESTNET_FACILITATOR_URL = "https://x402.org/facilitator";
/** Circle-issued USDC, verified against developers.circle.com/stablecoins/usdc-contract-addresses. */
export const USDC_BASE_MAINNET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

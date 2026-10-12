import { jsonRpc } from "@red-cup-engineering/ethereum-engineering-services-section/public-evm-ledger";

import { DEFAULT_BASE_RPC_URL } from "./network-constants.mjs";

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/u;
const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/u;

function requireAddress(value) {
  if (typeof value !== "string" || !ADDRESS_PATTERN.test(value)) {
    throw new TypeError("address must be one EVM address (0x + 40 hex characters)");
  }
  return value.toLowerCase();
}

function requireHash(value) {
  if (typeof value !== "string" || !HASH_PATTERN.test(value)) {
    throw new TypeError("hash must be one EVM transaction hash (0x + 64 hex characters)");
  }
  return value.toLowerCase();
}

/**
 * Read one address's native ETH balance and the snapshot block it was read
 * at, from a keyless public Base JSON-RPC endpoint. `rpcUrl` defaults to the
 * package's own public Base mainnet endpoint, so this is directly callable
 * with just `{address}` (the shape a market's request query already is).
 * @param {{rpcUrl?: string, address: string, rpc?: typeof jsonRpc}} args
 * @returns {Promise<{address: string, weiBalance: string, snapshotBlock: string}>}
 */
export async function readAddressBalance({ rpcUrl = DEFAULT_BASE_RPC_URL, address, rpc = jsonRpc }) {
  const account = requireAddress(address);
  const [balance, blockNumber] = await Promise.all([
    rpc(rpcUrl, "eth_getBalance", [account, "latest"]),
    rpc(rpcUrl, "eth_blockNumber", []),
  ]);
  return {
    address: account,
    weiBalance: BigInt(balance).toString(),
    snapshotBlock: BigInt(blockNumber).toString(),
  };
}

/**
 * Read Base's current network gas price and the snapshot block it was read
 * at, from a keyless public Base JSON-RPC endpoint. `rpcUrl` defaults to the
 * package's own public Base mainnet endpoint, so this is directly callable
 * with an empty query.
 * @param {{rpcUrl?: string, rpc?: typeof jsonRpc}} [args]
 * @returns {Promise<{weiGasPrice: string, gweiGasPrice: number, snapshotBlock: string}>}
 */
export async function readGasOracle({ rpcUrl = DEFAULT_BASE_RPC_URL, rpc = jsonRpc } = {}) {
  const [gasPrice, blockNumber] = await Promise.all([
    rpc(rpcUrl, "eth_gasPrice", []),
    rpc(rpcUrl, "eth_blockNumber", []),
  ]);
  const wei = BigInt(gasPrice);
  return {
    weiGasPrice: wei.toString(),
    gweiGasPrice: Number(wei) / 1e9,
    snapshotBlock: BigInt(blockNumber).toString(),
  };
}

/**
 * Read one transaction by its hash from a keyless public Base JSON-RPC
 * endpoint. `found: false` (with `transaction: null`) is a successful,
 * billable read of a hash the node does not (yet, or ever) know about.
 * `rpcUrl` defaults to the package's own public Base mainnet endpoint, so
 * this is directly callable with just `{hash}`.
 * @param {{rpcUrl?: string, hash: string, rpc?: typeof jsonRpc}} args
 * @returns {Promise<{hash: string, found: boolean, transaction: object|null}>}
 */
export async function readTransactionByHash({ rpcUrl = DEFAULT_BASE_RPC_URL, hash, rpc = jsonRpc }) {
  const txHash = requireHash(hash);
  const transaction = await rpc(rpcUrl, "eth_getTransactionByHash", [txHash]);
  return { hash: txHash, found: transaction != null, transaction: transaction ?? null };
}

// ERC-1271: a contract wallet answers isValidSignature(bytes32, bytes) with
// its own selector when the signature is its own.
const ERC1271_MAGIC = "0x1626ba7e";

/**
 * Ask a contract wallet on Base whether `signature` is its signature over
 * `digest` (ERC-1271). An address with no code, or a revert, reads as false.
 * @param {{rpcUrl?: string, address: string, digest: string, signature: string, rpc?: typeof jsonRpc}} args
 * @returns {Promise<boolean>}
 */
export async function readContractSignatureValidity({ rpcUrl = DEFAULT_BASE_RPC_URL, address, digest, signature, rpc = jsonRpc }) {
  const account = requireAddress(address);
  const hash = requireHash(digest).slice(2);
  if (typeof signature !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/u.test(signature)) throw new TypeError("signature must be 0x-prefixed hex bytes");
  const bytes = signature.slice(2).toLowerCase();
  const word = (value) => value.toString(16).padStart(64, "0");
  const data = `${ERC1271_MAGIC}${hash}${word(64)}${word(bytes.length / 2)}${bytes.padEnd(Math.ceil(bytes.length / 64) * 64, "0")}`;
  try {
    const result = await rpc(rpcUrl, "eth_call", [{ to: account, data }, "latest"]);
    return typeof result === "string" && result.slice(0, 10).toLowerCase() === ERC1271_MAGIC;
  } catch {
    return false;
  }
}

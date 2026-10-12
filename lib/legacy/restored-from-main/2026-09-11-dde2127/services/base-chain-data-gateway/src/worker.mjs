import { createExactEvmFetchPaymentBoundary } from "@red-cup-engineering/x402-services-section/fetch";
import { readAddressBalance, readGasOracle, readTransactionByHash } from "./base-reads.mjs";

import {
  MAINNET_NETWORK,
  SEPOLIA_NETWORK,
  DEFAULT_NETWORK,
  DEFAULT_BASE_RPC_URL,
  PUBLIC_TESTNET_FACILITATOR_URL,
  USDC_BASE_MAINNET,
  USDC_BASE_SEPOLIA,
} from "./network-constants.mjs";
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/u;

function required(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} is required`);
  return value;
}

/**
 * Read and validate this worker's runtime configuration from its Cloudflare
 * Workers environment bindings. Nothing here is a source-code constant
 * except the two well-known Base USDC contract addresses and the public
 * Base Sepolia facilitator; every settlement-affecting value (network,
 * payee, facilitator, prices) is deployment-supplied, matching the house
 * convention already live in metered-inference-tollbooth and
 * paid-ephemeris-gateway (X402_NETWORK / X402_PAY_TO / X402_FACILITATOR).
 * @param {Record<string, string|undefined>} env
 */
export function envConfiguration(env) {
  const network = env.X402_NETWORK ?? DEFAULT_NETWORK;
  if (!/^eip155:[1-9][0-9]*$/u.test(network)) throw new Error("X402_NETWORK must be an explicit EVM CAIP-2 identifier");
  const payTo = required(env.X402_PAY_TO, "X402_PAY_TO");
  if (!ADDRESS_PATTERN.test(payTo)) throw new Error("X402_PAY_TO must be one EVM address");
  const knownAsset = network === MAINNET_NETWORK ? USDC_BASE_MAINNET : network === SEPOLIA_NETWORK ? USDC_BASE_SEPOLIA : undefined;
  const asset = env.X402_ASSET ?? knownAsset;
  if (!asset) throw new Error("X402_ASSET is required; no built-in USDC default exists for this network");
  if (!ADDRESS_PATTERN.test(asset)) throw new Error("X402_ASSET must be one EVM address");
  const knownFacilitator = network === SEPOLIA_NETWORK ? PUBLIC_TESTNET_FACILITATOR_URL : undefined;
  const facilitatorUrl = env.X402_FACILITATOR ?? knownFacilitator;
  if (!facilitatorUrl) {
    throw new Error(
      "X402_FACILITATOR is required for this network; Base mainnet (eip155:8453) additionally needs an "
      + "authenticated facilitator (this package does not implement CDP JWT signing) or another explicit "
      + "mainnet-capable facilitator URL",
    );
  }
  const rpcUrl = env.BASE_RPC_URL ?? DEFAULT_BASE_RPC_URL;
  return {
    network,
    payTo: payTo.toLowerCase(),
    asset: asset.toLowerCase(),
    facilitatorUrl,
    rpcUrl,
    balancePriceAtomic: env.X402_BALANCE_PRICE_ATOMIC ?? "1000",
    gasOraclePriceAtomic: env.X402_GAS_ORACLE_PRICE_ATOMIC ?? "1000",
    transactionPriceAtomic: env.X402_TRANSACTION_PRICE_ATOMIC ?? "2000",
    indexVerificationHash: env.INDEX_VERIFICATION_HASH,
  };
}

function priceAccept(config, amount, description) {
  return {
    accepts: [{
      scheme: "exact",
      network: config.network,
      price: { amount, asset: config.asset },
      payTo: config.payTo,
    }],
    description,
  };
}

/** Construct the x402 fetch payment boundary for this worker's three priced Base read routes. */
export function buildPaymentBoundary(config, { facilitatorClient } = {}) {
  return createExactEvmFetchPaymentBoundary({
    network: config.network,
    facilitatorUrl: config.facilitatorUrl,
    facilitatorClient,
    routes: {
      "GET /base/balance": priceAccept(config, config.balancePriceAtomic, "Base network address balance (eth_getBalance) read."),
      "GET /base/gas-oracle": priceAccept(config, config.gasOraclePriceAtomic, "Base network current gas price (eth_gasPrice) read."),
      "GET /base/transaction": priceAccept(config, config.transactionPriceAtomic, "Base network transaction-by-hash (eth_getTransactionByHash) read."),
    },
  });
}

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/**
 * Dispatch one already-payment-cleared (or unpriced) request to its Base
 * read handler. Injectable `deps` lets tests replace the RPC call without a
 * network.
 * @param {Request} request
 * @param {{rpcUrl: string, network: string}} config
 * @param {{readAddressBalance?: typeof readAddressBalance, readGasOracle?: typeof readGasOracle, readTransactionByHash?: typeof readTransactionByHash}} [deps]
 */
export async function respond(request, config, deps = {}) {
  const readBalance = deps.readAddressBalance ?? readAddressBalance;
  const readGas = deps.readGasOracle ?? readGasOracle;
  const readTransaction = deps.readTransactionByHash ?? readTransactionByHash;
  const url = new URL(request.url);
  try {
    if (url.pathname === "/.well-known/402index-verify.txt") {
      if (typeof config.indexVerificationHash !== "string" || config.indexVerificationHash === "") {
        return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
      }
      return new Response(config.indexVerificationHash, { status: 200, headers: { "content-type": "text/plain" } });
    }
    if (url.pathname === "/healthz") return json(200, { ok: true, network: config.network });
    if (url.pathname === "/base/balance") {
      const result = await readBalance({ rpcUrl: config.rpcUrl, address: url.searchParams.get("address") });
      return json(200, { ok: true, network: config.network, result });
    }
    if (url.pathname === "/base/gas-oracle") {
      const result = await readGas({ rpcUrl: config.rpcUrl });
      return json(200, { ok: true, network: config.network, result });
    }
    if (url.pathname === "/base/transaction") {
      const result = await readTransaction({ rpcUrl: config.rpcUrl, hash: url.searchParams.get("hash") });
      return json(200, { ok: true, network: config.network, result });
    }
    return json(404, { ok: false, error: "not found" });
  } catch (error) {
    return json(400, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

let cachedBoundary;

/** Build (once per isolate) and return this worker's `{ boundary, config }`, or rebuild after a config error. */
function boundaryFor(env) {
  if (cachedBoundary === undefined) {
    const config = envConfiguration(env);
    cachedBoundary = { boundary: buildPaymentBoundary(config), config };
  }
  return cachedBoundary;
}

export default {
  /** @param {Request} request @param {Record<string, string|undefined>} env */
  async fetch(request, env) {
    let boundary, config;
    try {
      ({ boundary, config } = boundaryFor(env));
    } catch (error) {
      return json(500, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
    return boundary.handle(request, (req) => respond(req, config));
  },
};


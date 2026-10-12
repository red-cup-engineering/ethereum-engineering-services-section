import { test } from "node:test";
import assert from "node:assert/strict";
import { envConfiguration, respond } from "../src/worker.mjs";
import {
  MAINNET_NETWORK,
  SEPOLIA_NETWORK,
  USDC_BASE_MAINNET,
  USDC_BASE_SEPOLIA,
  PUBLIC_TESTNET_FACILITATOR_URL,
} from "../src/network-constants.mjs";

const PAY_TO = "0x1234567890123456789012345678901234567890";
const ADDRESS = "0x4200000000000000000000000000000000000006";
const HASH = "0x".padEnd(66, "a");

test("envConfiguration defaults to Base Sepolia with the public facilitator and USDC-Sepolia", () => {
  const config = envConfiguration({ X402_PAY_TO: PAY_TO });
  assert.equal(config.network, SEPOLIA_NETWORK);
  assert.equal(config.asset, USDC_BASE_SEPOLIA.toLowerCase());
  assert.equal(config.facilitatorUrl, PUBLIC_TESTNET_FACILITATOR_URL);
  assert.equal(config.payTo, PAY_TO.toLowerCase());
  assert.equal(config.rpcUrl, "https://mainnet.base.org");
  assert.equal(config.balancePriceAtomic, "1000");
  assert.equal(config.gasOraclePriceAtomic, "1000");
  assert.equal(config.transactionPriceAtomic, "2000");
});

test("envConfiguration requires X402_PAY_TO", () => {
  assert.throws(() => envConfiguration({}), /X402_PAY_TO/);
});

test("envConfiguration rejects a malformed X402_PAY_TO", () => {
  assert.throws(() => envConfiguration({ X402_PAY_TO: "not-an-address" }), /X402_PAY_TO/);
});

test("envConfiguration defaults Base mainnet asset to Circle's mainnet USDC but requires an explicit facilitator", () => {
  assert.throws(
    () => envConfiguration({ X402_PAY_TO: PAY_TO, X402_NETWORK: MAINNET_NETWORK }),
    /X402_FACILITATOR/,
  );
  const config = envConfiguration({ X402_PAY_TO: PAY_TO, X402_NETWORK: MAINNET_NETWORK, X402_FACILITATOR: "https://api.cdp.coinbase.com/platform/v2/x402" });
  assert.equal(config.asset, USDC_BASE_MAINNET.toLowerCase());
});

test("envConfiguration rejects a malformed X402_NETWORK", () => {
  assert.throws(() => envConfiguration({ X402_PAY_TO: PAY_TO, X402_NETWORK: "base" }), /CAIP-2/);
});

test("envConfiguration lets env override price, asset, RPC endpoint, and facilitator", () => {
  const config = envConfiguration({
    X402_PAY_TO: PAY_TO,
    X402_ASSET: PAY_TO,
    X402_FACILITATOR: "https://example.test/facilitator",
    BASE_RPC_URL: "https://example.test/rpc",
    X402_BALANCE_PRICE_ATOMIC: "500",
    X402_GAS_ORACLE_PRICE_ATOMIC: "750",
    X402_TRANSACTION_PRICE_ATOMIC: "3000",
  });
  assert.equal(config.asset, PAY_TO.toLowerCase());
  assert.equal(config.facilitatorUrl, "https://example.test/facilitator");
  assert.equal(config.rpcUrl, "https://example.test/rpc");
  assert.equal(config.balancePriceAtomic, "500");
  assert.equal(config.gasOraclePriceAtomic, "750");
  assert.equal(config.transactionPriceAtomic, "3000");
});

test("envConfiguration passes INDEX_VERIFICATION_HASH through when set, and leaves it undefined otherwise", () => {
  assert.equal(envConfiguration({ X402_PAY_TO: PAY_TO }).indexVerificationHash, undefined);
  assert.equal(
    envConfiguration({ X402_PAY_TO: PAY_TO, INDEX_VERIFICATION_HASH: "deadbeef" }).indexVerificationHash,
    "deadbeef",
  );
});

const config = { network: SEPOLIA_NETWORK, rpcUrl: "https://mainnet.base.org" };

test("respond serves /healthz without touching any read dependency", async () => {
  const response = await respond(new Request("https://gateway.test/healthz"), config, {
    readAddressBalance: async () => { throw new Error("must not be called"); },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, network: SEPOLIA_NETWORK });
});

test("respond dispatches /base/balance to readAddressBalance with the query address", async () => {
  let received;
  const response = await respond(new Request(`https://gateway.test/base/balance?address=${ADDRESS}`), config, {
    readAddressBalance: async (args) => { received = args; return { address: ADDRESS, weiBalance: "1", snapshotBlock: "2" }; },
  });
  assert.equal(response.status, 200);
  assert.equal(received.address, ADDRESS);
  assert.equal(received.rpcUrl, config.rpcUrl);
  assert.deepEqual(await response.json(), { ok: true, network: SEPOLIA_NETWORK, result: { address: ADDRESS, weiBalance: "1", snapshotBlock: "2" } });
});

test("respond dispatches /base/gas-oracle to readGasOracle", async () => {
  const response = await respond(new Request("https://gateway.test/base/gas-oracle"), config, {
    readGasOracle: async (args) => { assert.equal(args.rpcUrl, config.rpcUrl); return { weiGasPrice: "1", gweiGasPrice: 0, snapshotBlock: "1" }; },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.result.weiGasPrice, "1");
});

test("respond dispatches /base/transaction to readTransactionByHash with the query hash", async () => {
  let received;
  const response = await respond(new Request(`https://gateway.test/base/transaction?hash=${HASH}`), config, {
    readTransactionByHash: async (args) => { received = args; return { hash: HASH, found: false, transaction: null }; },
  });
  assert.equal(response.status, 200);
  assert.equal(received.hash, HASH);
});

test("respond returns 400 with the error message when the read handler rejects", async () => {
  const response = await respond(new Request(`https://gateway.test/base/balance?address=bad`), config, {
    readAddressBalance: async () => { throw new TypeError("address must be one EVM address (0x + 40 hex characters)"); },
  });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.match(body.error, /EVM address/);
});

test("respond returns 404 for an unrecognized path", async () => {
  const response = await respond(new Request("https://gateway.test/nope"), config, {});
  assert.equal(response.status, 404);
});

test("respond serves the 402index verification hash as text/plain when configured", async () => {
  const withHash = { ...config, indexVerificationHash: "abc123" };
  const response = await respond(new Request("https://gateway.test/.well-known/402index-verify.txt"), withHash, {});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/plain");
  assert.equal(await response.text(), "abc123");
});

test("respond returns 404 for the 402index verification route when unset", async () => {
  const response = await respond(new Request("https://gateway.test/.well-known/402index-verify.txt"), config, {});
  assert.equal(response.status, 404);
});

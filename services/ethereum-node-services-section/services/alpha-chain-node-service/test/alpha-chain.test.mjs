import assert from "node:assert/strict";
import test from "node:test";

import {
  ALPHA_CHAIN_ID,
  assertPrivateOutputPath,
  nodeArguments,
  qbftConfiguration,
  VALIDATOR_COUNT,
} from "../src/alpha-chain.mjs";

test("fresh genesis is chain-pinned, single-domain QBFT, current-EVM, and intentionally funded", () => {
  const treasury = "0x1111111111111111111111111111111111111111";
  const executor = "0x2222222222222222222222222222222222222222";
  const configuration = qbftConfiguration({ treasuryAddress: treasury, bootstrapAddresses: [executor, treasury] });
  assert.equal(configuration.genesis.config.chainId, ALPHA_CHAIN_ID);
  assert.equal(configuration.genesis.config.osakaTime, 0);
  assert.equal(configuration.genesis.config.qbft.blockperiodseconds, 2);
  assert.equal(configuration.genesis.config.qbft.emptyblockperiodseconds, 30);
  assert.equal(configuration.blockchain.nodes.count, VALIDATOR_COUNT);
  assert.ok(BigInt(configuration.genesis.alloc[treasury].balance) > 0n);
  assert.ok(BigInt(configuration.genesis.alloc[executor].balance) > 0n);
  assert.equal(Object.keys(configuration.genesis.alloc).length, 2);
});

test("node RPC remains loopback-only and private material remains outside Git", () => {
  assert.throws(() => assertPrivateOutputPath({
    outputPath: "/repo/private-keys",
    repositoryRoot: "/repo",
  }), /outside the repository/u);
  assert.throws(() => nodeArguments({
    dataPath: "/state/node-1",
    genesisPath: "/state/genesis.json",
    p2pHost: "100.64.0.1",
    rpcHost: "0.0.0.0",
  }), /loopback-bound or bind one explicit private-overlay/u);
  assert.throws(() => nodeArguments({
    dataPath: "/state/node-1",
    genesisPath: "/state/genesis.json",
    p2pHost: "100.64.0.1",
    rpcHost: "8.8.8.8",
  }), /loopback-bound or bind one explicit private-overlay/u);
});

test("node RPC may bind one explicit private-overlay address and allowlists it", () => {
  const args = nodeArguments({
    dataPath: "/state/node-1",
    genesisPath: "/state/genesis.json",
    p2pHost: "100.64.0.1",
    rpcHost: "100.64.0.1",
    rpcPort: "8562",
  });
  assert.ok(args.includes("--rpc-http-host=100.64.0.1"));
  assert.ok(args.includes("--rpc-http-port=8562"));
  assert.ok(args.includes("--host-allowlist=localhost,127.0.0.1,100.64.0.1"));
});

test("node arguments expose standard RPC and peer faces without signer custody", () => {
  const args = nodeArguments({
    dataPath: "/state/node-1",
    genesisPath: "/state/genesis.json",
    p2pHost: "100.64.0.1",
    bootnodes: ["enode://public-key@100.64.0.2:30303"],
  });
  assert.ok(args.includes(`--network-id=${ALPHA_CHAIN_ID}`));
  assert.ok(args.includes("--p2p-interface=100.64.0.1"));
  assert.ok(args.includes("--rpc-http-host=127.0.0.1"));
  assert.ok(args.includes("--rpc-http-api=ETH,NET,WEB3,QBFT"));
  assert.equal(args.some((argument) => /unlock|password|key=/u.test(argument)), false);
});

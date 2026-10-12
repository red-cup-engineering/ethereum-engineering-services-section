#!/usr/bin/env node

import { spawn } from "node:child_process";

import { nodeArguments } from "../src/alpha-chain.mjs";

function required(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value.length === 0) throw new Error(`${name} is required`);
  return value;
}

const besu = required("BESU_BIN");
const child = spawn(besu, nodeArguments({
  dataPath: required("ALPHA_CHAIN_DATA_PATH"),
  genesisPath: required("ALPHA_CHAIN_GENESIS_PATH"),
  p2pHost: required("ALPHA_CHAIN_P2P_HOST"),
  p2pPort: process.env.ALPHA_CHAIN_P2P_PORT,
  rpcHost: process.env.ALPHA_CHAIN_RPC_HOST,
  rpcPort: process.env.ALPHA_CHAIN_RPC_PORT,
  bootnodes: process.env.ALPHA_CHAIN_BOOTNODES?.split(",").filter(Boolean) ?? [],
  validator: process.env.ALPHA_CHAIN_VALIDATOR !== "false",
}), { stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.once("error", (error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exit(1);
});
child.once("exit", (code, signal) => process.exit(signal ? 128 : (code ?? 1)));

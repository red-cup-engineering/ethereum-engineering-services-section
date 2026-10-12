#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function option(name) { const at = process.argv.indexOf(name); return at === -1 ? undefined : process.argv[at + 1]; }
const rpcUrl = option("--rpc-url");
const network = option("--network");
const holder = option("--initial-holder");
const supply = option("--initial-supply") ?? "1000000000000";
const privateKey = process.env.UNION_EVM_DEPLOYER_PRIVATE_KEY;
if (!rpcUrl || !/^eip155:[1-9][0-9]*$/u.test(network ?? "")
    || !/^0x[0-9a-fA-F]{40}$/u.test(holder ?? "")
    || !/^[1-9][0-9]*$/u.test(supply) || !privateKey) {
  throw new Error("--rpc-url, --network, --initial-holder, canonical --initial-supply, and UNION_EVM_DEPLOYER_PRIVATE_KEY are required");
}
const chain = await fetch(rpcUrl, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] })
}).then((response) => response.json());
if (`eip155:${BigInt(chain.result)}` !== network) throw new Error("integration settlement token RPC and selected network differ");
const result = spawnSync("forge", [
  "create",
  "src/IntegrationSettlementToken.sol:IntegrationSettlementToken",
  "--broadcast",
  "--json",
  "--rpc-url", rpcUrl,
  "--private-key", privateKey,
  "--constructor-args", holder, supply
], { cwd: ROOT, encoding: "utf8", env: process.env });
if (result.status !== 0) throw new Error((result.stderr || result.stdout).trim());
const start = result.stdout.indexOf("{");
const receipt = JSON.parse(result.stdout.slice(start));
process.stdout.write(`${JSON.stringify({
  type: "IntegrationSettlementTokenDeployment",
  standard: "org.emsenn.evm.integration-settlement-token.eip3009.v1",
  chainId: network,
  address: receipt.deployedTo,
  transactionHash: receipt.transactionHash,
  initialHolder: holder.toLowerCase(),
  initialSupply: supply,
  productionEligible: false
}, null, 2)}\n`);

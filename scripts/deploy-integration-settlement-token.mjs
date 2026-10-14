#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { lstatSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function option(name) { const at = process.argv.indexOf(name); return at === -1 ? undefined : process.argv[at + 1]; }
const rpcUrl = option("--rpc-url");
const network = option("--network");
const holder = option("--initial-holder");
const supply = option("--initial-supply") ?? "1000000000000";
const keystore = option("--keystore");
const passwordFile = option("--password-file");
function privateRegularFile(path, label) {
  if (typeof path !== "string" || !isAbsolute(path)) throw new TypeError(`${label} must name one absolute private file`);
  const file = lstatSync(path);
  if (!file.isFile() || file.isSymbolicLink() || (file.mode & 0o077) !== 0) {
    throw new TypeError(`${label} must be an owner-only regular file without symlink indirection`);
  }
}
if (!rpcUrl || !/^eip155:[1-9][0-9]*$/u.test(network ?? "")
    || !/^0x[0-9a-fA-F]{40}$/u.test(holder ?? "")
    || !/^[1-9][0-9]*$/u.test(supply) || !keystore || !passwordFile) {
  throw new Error("--rpc-url, --network, --initial-holder, canonical --initial-supply, --keystore, and --password-file are required");
}
// Never put raw private-key material in argv or in a Foundry subprocess
// environment; explicit encrypted custody is required even for dev chains.
privateRegularFile(keystore, "deployer keystore");
privateRegularFile(passwordFile, "deployer password file");
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
  "--keystore", keystore,
  "--password-file", passwordFile,
  "--constructor-args", holder, supply
], { cwd: ROOT, encoding: "utf8", env: (() => {
  const admitted = { ...process.env };
  // Prevent Forge's ambient wallet selectors from superseding the selected
  // encrypted key and never export any legacy raw deployment secret.
  for (const key of ["UNION_EVM_DEPLOYER_PRIVATE_KEY", "ETH_PRIVATE_KEY",
    "ETH_KEYSTORE", "ETH_KEYSTORE_ACCOUNT", "ETH_PASSWORD"]) delete admitted[key];
  return admitted;
})() });
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

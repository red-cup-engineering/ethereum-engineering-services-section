#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { lstatSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { jsonRpc } from "../src/public-evm-ledger.mjs";

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
const chainId = await jsonRpc(rpcUrl, "eth_chainId", []);
if (`eip155:${BigInt(chainId)}` !== network) throw new Error("integration settlement token RPC and selected network differ");
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
if (!/^0x[0-9a-fA-F]{40}$/u.test(receipt.deployedTo ?? "") ||
    !/^0x[0-9a-fA-F]{64}$/u.test(receipt.transactionHash ?? "")) {
  throw new Error("Foundry did not report one valid deployment address and transaction");
}
// A Forge exit status is not an installed-contract receipt. Require exact
// chain evidence before producing a deployment record; no second registry
// or mutable claim of successful installation is created by this program.
const observed = await jsonRpc(rpcUrl, "eth_getTransactionReceipt", [receipt.transactionHash]);
if (observed?.status !== "0x1" ||
    observed.contractAddress?.toLowerCase() !== receipt.deployedTo.toLowerCase() ||
    observed.transactionHash?.toLowerCase() !== receipt.transactionHash.toLowerCase() ||
    !/^0x[0-9a-fA-F]+$/u.test(observed.blockNumber ?? "")) {
  throw new Error("deployed token transaction was not independently received on the selected chain");
}
const code = await jsonRpc(rpcUrl, "eth_getCode", [receipt.deployedTo, observed.blockNumber]);
if (typeof code !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/u.test(code)) {
  throw new Error("deployed token has no installed runtime bytecode at its receipt block");
}
process.stdout.write(`${JSON.stringify({
  type: "IntegrationSettlementTokenDeployment",
  standard: "org.emsenn.evm.integration-settlement-token.eip3009.v1",
  chainId: network,
  address: receipt.deployedTo,
  transactionHash: receipt.transactionHash,
  blockNumber: BigInt(observed.blockNumber).toString(),
  codeSizeBytes: (code.length - 2) / 2,
  receiptStatus: "0x1",
  sourceObservation: "receipt-and-nonempty-bytecode-at-receipt-block",
  initialHolder: holder.toLowerCase(),
  initialSupply: supply,
  productionEligible: false
}, null, 2)}\n`);

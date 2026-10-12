#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EAS_ROOT = resolve(ROOT, "node_modules/@ethereum-attestation-service/eas-contracts");
const ARTIFACTS = {
  registry: resolve(EAS_ROOT, "artifacts/contracts/SchemaRegistry.sol/SchemaRegistry.json"),
  eas: resolve(EAS_ROOT, "artifacts/contracts/EAS.sol/EAS.json"),
};

function option(name) {
  const at = process.argv.indexOf(name);
  return at < 0 ? undefined : process.argv[at + 1];
}

function cast(args) {
  const result = spawnSync("cast", args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`cast-refused:${(result.stderr || result.stdout).trim()}`);
  return result.stdout.trim();
}

function artifact(path) {
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (!/^0x[0-9a-f]+$/iu.test(parsed.bytecode ?? "")) throw new Error(`official-EAS-artifact-has-no-bytecode:${path}`);
  return parsed;
}

function authorization() {
  const unlocked = option("--unlocked-from");
  const privateKey = process.env.UNION_EVM_DEPLOYER_PRIVATE_KEY;
  if (Boolean(unlocked) === Boolean(privateKey)) throw new Error("select-exactly-one-of-unlocked-from-or-UNION_EVM_DEPLOYER_PRIVATE_KEY");
  return unlocked ? ["--unlocked", "--from", unlocked] : ["--private-key", privateKey];
}

function deploy(bytecode, constructorTypes, constructorValues, rpcUrl, auth) {
  const encoded = constructorTypes.length
    ? cast(["abi-encode", `constructor(${constructorTypes.join(",")})`, ...constructorValues]).slice(2)
    : "";
  const receipt = JSON.parse(cast(["send", "--rpc-url", rpcUrl, ...auth, "--json", "--create", `${bytecode}${encoded}`]));
  if (!receipt.contractAddress || !receipt.transactionHash || ![1, "0x1", "0x01"].includes(receipt.status)) throw new Error("EAS-deployment-transaction-failed");
  return { address: receipt.contractAddress.toLowerCase(), transactionHash: receipt.transactionHash.toLowerCase(), blockNumber: Number(BigInt(receipt.blockNumber)) };
}

export function deployEasProtocol({ rpcUrl, auth }) {
  const registryArtifact = artifact(ARTIFACTS.registry);
  const easArtifact = artifact(ARTIFACTS.eas);
  const registry = deploy(registryArtifact.bytecode, [], [], rpcUrl, auth);
  const eas = deploy(easArtifact.bytecode, ["address"], [registry.address], rpcUrl, auth);
  const reportedRegistry = cast(["call", eas.address, "getSchemaRegistry()(address)", "--rpc-url", rpcUrl]).toLowerCase();
  if (reportedRegistry !== registry.address) throw new Error("EAS-registry-constructor-binding-mismatch");
  return Object.freeze({
    type: "EthereumAttestationServiceDeployment",
    protocol: "Ethereum Attestation Service",
    upstreamPackage: "@ethereum-attestation-service/eas-contracts",
    upstreamVersion: JSON.parse(readFileSync(resolve(EAS_ROOT, "package.json"), "utf8")).version,
    schemaRegistry: { ...registry, version: cast(["call", registry.address, "version()(string)", "--rpc-url", rpcUrl]) },
    eas: { ...eas, version: cast(["call", eas.address, "version()(string)", "--rpc-url", rpcUrl]), schemaRegistry: registry.address },
  });
}

async function main() {
  const rpcUrl = option("--rpc-url");
  if (!rpcUrl) throw new Error("--rpc-url-is-required");
  const deployment = deployEasProtocol({ rpcUrl, auth: authorization() });
  const chain = await (await fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) })).json();
  if (!chain.result || chain.error) throw new Error(`chain-id-unavailable:${chain.error?.message ?? "missing-result"}`);
  process.stdout.write(`${JSON.stringify({ ...deployment, chainId: `eip155:${BigInt(chain.result)}` }, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try { await main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 2; }
}

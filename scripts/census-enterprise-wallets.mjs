#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_WORKSPACE = resolve(HERE, "../../../../../../../../../..");
const PROFILE = "org.emsenn.evm.sovereign-enterprise-account.v3";
const SKIP = new Set([".git", ".agents", ".codex", "node_modules", "content", "data", "out", "cache"]);
const CLOUD_KMS_KEY_VERSION = /^projects\/[^/]+\/locations\/[^/]+\/keyRings\/[^/]+\/cryptoKeys\/[^/]+\/cryptoKeyVersions\/[^/]+$/u;

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function packageFiles(root) {
  const found = [];
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP.has(entry.name)) walk(join(directory, entry.name));
      } else if (entry.isFile() && entry.name === "package.json") {
        found.push(join(directory, entry.name));
      }
    }
  }
  walk(root);
  return found;
}

function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

export function validateEnterpriseAccountBinding(binding, nodeId) {
  const failures = [];
  const topology = Object.keys(binding ?? {}).sort().join("\0");
  const legacyTopology = ["account", "chain", "deployment", "enterprise", "factory", "policy", "profile"].sort().join("\0");
  const accountedTopology = ["accounting", "account", "chain", "deployment", "enterprise", "factory", "policy", "profile"].sort().join("\0");
  if (topology !== legacyTopology && topology !== accountedTopology) failures.push("topology");
  if (binding?.profile !== PROFILE) failures.push("profile");
  const expectedEnterpriseId = binding?.enterprise?.urn ? castKeccak(binding.enterprise.urn) : "";
  if (!exactKeys(binding?.enterprise, ["enterpriseId", "nodeId", "urn"]) || binding.enterprise.nodeId !== nodeId || !binding.enterprise.urn?.startsWith("urn:") || !/^0x[0-9a-fA-F]{64}$/u.test(binding.enterprise.enterpriseId ?? "") || binding.enterprise.enterpriseId.toLowerCase() !== expectedEnterpriseId) failures.push("enterprise");
  if (!exactKeys(binding?.chain, ["caip2", "chainId"]) || !Number.isSafeInteger(binding.chain.chainId) || binding.chain.chainId < 1 || binding.chain.caip2 !== `eip155:${binding.chain.chainId}`) failures.push("CAIP-2");
  if (!exactKeys(binding?.account, ["address", "caip10"]) || !/^0x[0-9a-fA-F]{40}$/u.test(binding.account.address ?? "") || binding.account.caip10 !== `${binding.chain?.caip2}:${binding.account.address}`) failures.push("CAIP-10");
  if (!exactKeys(binding?.factory, ["address", "userSalt"]) || !/^0x[0-9a-fA-F]{40}$/u.test(binding.factory.address ?? "") || !/^0x[0-9a-fA-F]{64}$/u.test(binding.factory.userSalt ?? "")) failures.push("factory");
  const localPolicy = exactKeys(binding?.policy, ["custody", "signer"])
    && binding?.policy?.custody === "settlement-private";
  const cloudKmsPolicy = exactKeys(binding?.policy, ["custody", "keyVersion", "signer"])
    && binding?.policy?.custody === "remote-cloud-kms-hsm"
    && CLOUD_KMS_KEY_VERSION.test(binding?.policy?.keyVersion ?? "");
  if ((!localPolicy && !cloudKmsPolicy) || !/^0x[0-9a-fA-F]{40}$/u.test(binding?.policy?.signer ?? "")) failures.push("policy");
  if (binding?.policy?.signer?.toLowerCase() === binding?.account?.address?.toLowerCase()) failures.push("self-policy");
  if (!exactKeys(binding?.deployment, ["block", "transaction"]) || !Number.isSafeInteger(binding.deployment.block) || binding.deployment.block < 0 || !/^0x[0-9a-fA-F]{64}$/u.test(binding.deployment.transaction ?? "")) failures.push("deployment");
  if (binding?.accounting !== undefined) {
    const accounting = binding.accounting;
    const authority = exactKeys(accounting?.authority, ["enterpriseUrn", "nodeId"])
      && accounting.authority.enterpriseUrn === binding.enterprise?.urn && accounting.authority.nodeId === binding.enterprise?.nodeId;
    const funding = exactKeys(accounting?.funding, ["balanceWei", "custody", "keyVersion", "minimumWei", "source", "transactions", "treasury"])
      && accounting.funding.source === "remote-cloud-kms-treasury" && /^0x[0-9a-fA-F]{40}$/u.test(accounting.funding.treasury ?? "")
      && accounting.funding.custody === "remote-cloud-kms-hsm" && CLOUD_KMS_KEY_VERSION.test(accounting.funding.keyVersion ?? "")
      && /^\d+$/u.test(accounting.funding.minimumWei ?? "") && /^\d+$/u.test(accounting.funding.balanceWei ?? "")
      && Array.isArray(accounting.funding.transactions) && accounting.funding.transactions.every((transaction) => /^0x[0-9a-fA-F]{64}$/u.test(transaction));
    const chain = exactKeys(accounting?.chain, ["deployment", "idempotentReconciliation"])
      && accounting.chain.deployment?.transaction === binding.deployment?.transaction && accounting.chain.deployment?.block === binding.deployment?.block
      && typeof accounting.chain.idempotentReconciliation === "boolean";
    if (!exactKeys(accounting, ["authority", "chain", "funding"]) || !authority || !funding || !chain) failures.push("accounting");
  }
  return failures;
}

function castKeccak(value) {
  const result = spawnSync("cast", ["keccak", value], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`cast keccak failed: ${(result.stderr || result.stdout).trim()}`);
  return result.stdout.trim().toLowerCase();
}

export function censusEnterpriseWallets(workspaceRoot) {
  const packages = packageFiles(workspaceRoot);
  const settlements = [];
  for (const packagePath of packages) {
    let manifest;
    try { manifest = JSON.parse(readFileSync(packagePath, "utf8")); } catch { continue; }
    const node = manifest["x-agentic-metro-enterprise"];
    if (!node?.["node-id"]) continue;
    const root = dirname(packagePath);
    const bindingDirectory = join(root, "content", "evm", "accounts");
    const bindingFiles = existsSync(bindingDirectory)
      ? readdirSync(bindingDirectory).filter((name) => name.endsWith(".json")).sort()
      : [];
    if (bindingFiles.length === 0) {
      settlements.push({ nodeId: node["node-id"], root: relative(workspaceRoot, root), status: "unbound", failures: ["missing-binding"] });
      continue;
    }
    const failures = [];
    const chains = [];
    for (const file of bindingFiles) {
      let binding;
      try { binding = JSON.parse(readFileSync(join(bindingDirectory, file), "utf8")); } catch {
        failures.push(`${file}:invalid-json`);
        continue;
      }
      for (const failure of validateEnterpriseAccountBinding(binding, node["node-id"])) failures.push(`${file}:${failure}`);
      if (binding?.chain?.caip2) chains.push(binding.chain.caip2);
    }
    if (new Set(chains).size !== chains.length) failures.push("duplicate-chain-binding");
    settlements.push({ nodeId: node["node-id"], root: relative(workspaceRoot, root), status: failures.length ? "invalid" : "bound", chains: [...new Set(chains)].sort(), failures });
  }
  settlements.sort((left, right) => left.root.localeCompare(right.root));
  const counts = settlements.reduce((all, settlement) => ({ ...all, [settlement.status]: (all[settlement.status] ?? 0) + 1 }), { total: settlements.length, bound: 0, unbound: 0, invalid: 0 });
  return { profile: PROFILE, workspace: workspaceRoot, counts, settlements };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = censusEnterpriseWallets(resolve(option("--workspace", DEFAULT_WORKSPACE)));
  const projection = process.argv.includes("--summary")
    ? { profile: report.profile, workspace: report.workspace, counts: report.counts }
    : report;
  process.stdout.write(`${JSON.stringify(projection, null, 2)}\n`);
  if (process.argv.includes("--enforce") && (report.counts.unbound > 0 || report.counts.invalid > 0)) process.exitCode = 1;
}

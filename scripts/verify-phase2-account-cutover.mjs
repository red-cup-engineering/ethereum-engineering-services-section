#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { censusEnterpriseWallets } from "./census-enterprise-wallets.mjs";

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_WORKSPACE = resolve(HERE, "../../../../../../../../../..");
const ROOT = "lib/emsenn/services";
const SKIP = new Set([".git", ".agents", ".codex", "node_modules", "out", "cache"]);
const PRIVATE_CONTROLLER = /UNION_EVM_CONTROLLER_PRIVATE_KEY|--private-key\b/u;
const LEGACY_PROFILE = /org\.emsenn\.evm\.sovereign-enterprise-account\.v[12]\b/u;

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function files(root) {
  const result = [];
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP.has(entry.name)) walk(path);
      } else if (entry.isFile()) result.push(path);
    }
  }
  if (existsSync(root)) walk(root);
  return result.sort();
}

export function verifyPhase2AccountCutover(workspace) {
  const territory = join(workspace, ROOT);
  const failures = [];
  const census = censusEnterpriseWallets(workspace);
  // Phase two is the live settlement cut named by the deployment manifest
  // below.  The recovered legacy development chain must never make this
  // gate green.
  const standards = JSON.parse(readFileSync(join(HERE, "content", "deployments", "eip155-5615610.json"), "utf8"));
  const standardsChain = standards.chainId;
  const canonicalFactory = standards.deployments.find(({ standard }) => standard === "org.emsenn.evm.sovereign-enterprise-account.v3")?.address?.toLowerCase();
  if (!canonicalFactory) failures.push({ type: "missing-canonical-account-factory", path: relative(workspace, HERE) });
  for (const settlement of census.settlements) {
    if (settlement.status !== "bound") failures.push({ type: "non-v3-binding", path: settlement.root, detail: settlement.failures });
    if (settlement.status === "bound") {
      const bindingDirectory = join(workspace, settlement.root, "content", "evm", "accounts");
      for (const name of readdirSync(bindingDirectory).filter((entry) => entry.endsWith(".json")).sort()) {
        const bindingPath = join(bindingDirectory, name);
        const binding = JSON.parse(readFileSync(bindingPath, "utf8"));
        if (binding.chain.caip2 === standardsChain && binding.factory.address.toLowerCase() !== canonicalFactory) {
          failures.push({ type: "noncanonical-account-factory", path: relative(workspace, bindingPath) });
        }
      }
    }
  }
  for (const path of files(territory)) {
    const local = relative(workspace, path);
    if (/\/data\/evm\/controller-eip155-[0-9]+\.env$/u.test(path.replaceAll("\\", "/"))) {
      failures.push({ type: "private-controller-artifact", path: local });
      continue;
    }
    if (!/\.(?:mjs|js|json)$/u.test(path)) continue;
    const text = readFileSync(path, "utf8");
    const preservedBytes = /(?:^|\/)data\//u.test(local.replaceAll("\\", "/")) || /\/content\/assets\/legacy\//u.test(`/${local.replaceAll("\\", "/")}`);
    if (!preservedBytes && path.endsWith(".json") && LEGACY_PROFILE.test(text)) failures.push({ type: "legacy-account-profile", path: local });
    const enforcementCarrier = local.replaceAll("\\", "/").endsWith("/standards-conformance-services-section/src/scan-territory.mjs");
    if (!enforcementCarrier && /\/src\//u.test(path.replaceAll("\\", "/")) && PRIVATE_CONTROLLER.test(text)) failures.push({ type: "direct-private-controller-execution", path: local });
  }
  return { profile: "org.emsenn.evm.sovereign-enterprise-account.v3", workspace, counts: { settlements: census.counts, failures: failures.length }, failures };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = verifyPhase2AccountCutover(resolve(option("--workspace", DEFAULT_WORKSPACE)));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (process.argv.includes("--enforce") && report.failures.length) process.exitCode = 1;
}

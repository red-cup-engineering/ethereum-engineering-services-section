#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { makeNiUri as rawNiUri } from "@red-cup-engineering/uri-services-section/ni-uri";
import { encryptSettlementPrivateKey, ensureSettlementPassword } from "../src/settlement-key-custody.mjs";

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_WORKSPACE = resolve(HERE, "../../../../../../../../../..");
const SKIP = new Set([".git", ".agents", ".codex", "node_modules", "out", "cache"]);

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function controllerFiles(root) {
  const found = [];
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP.has(entry.name)) walk(path);
      } else if (entry.isFile() && /^controller-eip155-[0-9]+\.env$/u.test(entry.name) && dirname(path).endsWith(join("data", "evm"))) {
        found.push(path);
      }
    }
  }
  walk(root);
  return found.sort();
}

function envValue(bytes, name) {
  const match = bytes.toString("utf8").match(new RegExp(`^${name}=(.+)$`, "mu"));
  if (!match) throw new Error(`legacy controller is missing ${name}`);
  return match[1].trim();
}

function nqString(value) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export async function migrateSettlementControllerCustody({ workspace, credentialRoot }) {
  const territory = join(workspace, "lib", "emsenn", "services");
  const migrated = [];
  for (const controllerPath of controllerFiles(territory)) {
    const match = controllerPath.match(/controller-eip155-([0-9]+)\.env$/u);
    const chainId = Number(match[1]);
    const settlement = resolve(controllerPath, "../../..");
    const bindingPath = join(settlement, "content", "evm", "accounts", `eip155-${chainId}.json`);
    if (!existsSync(bindingPath)) throw new Error(`legacy controller has no account binding: ${relative(workspace, controllerPath)}`);
    const binding = JSON.parse(readFileSync(bindingPath, "utf8"));
    const urn = binding.enterprise?.urn;
    const expectedSigner = binding.policy?.signer?.toLowerCase();
    if (!urn?.startsWith("urn:") || !/^0x[0-9a-f]{40}$/u.test(expectedSigner ?? "")) throw new Error(`binding cannot govern custody migration: ${relative(workspace, bindingPath)}`);

    const legacyBytes = readFileSync(controllerPath);
    const privateKey = envValue(legacyBytes, "UNION_EVM_CONTROLLER_PRIVATE_KEY");
    const keystorePath = join(settlement, "data", "evm", "keystores", `eip155-${chainId}.json`);
    if (existsSync(keystorePath)) throw new Error(`refusing dual controller custody: ${relative(workspace, keystorePath)}`);
    const passwordFile = ensureSettlementPassword({ credentialRoot, urn, chainId });
    mkdirSync(dirname(keystorePath), { recursive: true });
    const encrypted = await encryptSettlementPrivateKey({ path: keystorePath, passwordFile, privateKey });
    if (encrypted.signer !== expectedSigner) throw new Error(`legacy controller does not match binding: ${relative(workspace, controllerPath)}`);

    const retiredDigestUri = rawNiUri(legacyBytes);
    legacyBytes.fill(0);
    const provenance = join(settlement, "data", "provenance", "2026", "07", "19", "2026-07-19-controller-custody-cutover.nq");
    mkdirSync(dirname(provenance), { recursive: true });
    const graph = `${urn}:controller-custody-cutover:eip155-${chainId}`;
    writeFileSync(provenance, [
      `<${urn}> <urn:emsenn:evm:retired-controller-artifact> <${retiredDigestUri}> <${graph}> .`,
      `<${retiredDigestUri}> <urn:emsenn:evm:retired-path> ${nqString(relative(settlement, controllerPath))} <${graph}> .`,
      `<${urn}> <urn:emsenn:evm:controller-keystore-format> ${nqString("Ethereum Secret Storage v3")} <${graph}> .`,
      `<${urn}> <urn:emsenn:evm:controller-chain> <eip155:${chainId}> <${graph}> .`,
      "",
    ].join("\n"), { encoding: "utf8", flag: "wx", mode: 0o600 });
    unlinkSync(controllerPath);
    migrated.push({ settlement: relative(workspace, settlement), chain: `eip155:${chainId}`, signer: expectedSigner, retiredDigest: retiredDigestUri, keystore: relative(settlement, keystorePath) });
  }
  return Object.freeze({ type: "SettlementControllerCustodyMigration", migrated: migrated.length, settlements: migrated });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const workspace = resolve(option("--workspace", DEFAULT_WORKSPACE));
  const suppliedCredentialRoot = option("--credential-root");
  if (!suppliedCredentialRoot) throw new Error("--credential-root is required");
  const credentialRoot = resolve(suppliedCredentialRoot);
  const result = await migrateSettlementControllerCustody({ workspace, credentialRoot });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

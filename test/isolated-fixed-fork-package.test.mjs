import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { promisify } from "node:util";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const execFileAsync = promisify(execFile);
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REGISTRY = "https://registry.561.group/";
const ENABLED = process.env.ETHEREUM_ISOLATED_FIXED_FORK_PACKAGE === "1";

const invocation = String.raw`
import { observeFixedForkBeefyVaultExits } from "@red-cup-engineering/ethereum-engineering-services-section/fixed-fork-beefy-vault-exit-observation";
const rpcUrl = "https://mainnet.base.org/";
const block = "50761308";
const response = await fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBlockByNumber",
    params: ["0x" + BigInt(block).toString(16), false] }) });
const body = await response.json();
if (!response.ok || body.error || body.result == null) throw new Error("fixed block identity read failed");
const result = await observeFixedForkBeefyVaultExits({
  profile: "org.emsenn.evm.fixed-fork-beefy-vault-exit-observation.v1",
  authority: { fixedForkEvidenceOnly: true, liveMutation: false, signerMaterialPresent: false,
    transactionAssembly: false, signing: false, broadcast: false, chainMutation: false, outputCalldata: false },
  chain: "eip155:8453", rpcUrl, block, blockHash: body.result.hash,
  timestamp: BigInt(body.result.timestamp).toString(), candidates: ["sigmund-beefy-tbtc-cbbtc"]
});
console.log(JSON.stringify({ outcome: result.outcome, candidateId: result.candidates[0].candidateId,
  executionAdmitted: result.gate.executionAdmitted }));
`;

test("packed package runs the public fixed-fork API from an isolated hoisted install",
  { skip: ENABLED ? false : "set ETHEREUM_ISOLATED_FIXED_FORK_PACKAGE=1 for the canonical live package assay",
    timeout: 300_000 }, async () => {
    const scratch = await mkdtemp("/var/tmp/ethereum-fixed-fork-package-");
    try {
      const { stdout: packed } = await execFileAsync("npm", ["pack", "--json", "--pack-destination", scratch],
        { cwd: PACKAGE_ROOT, encoding: "utf8", maxBuffer: 2_000_000 });
      const tarball = join(scratch, JSON.parse(packed)[0].filename);
      await execFileAsync("npm", ["install", "--registry", REGISTRY, "--install-strategy", "hoisted",
        "--ignore-scripts", "--no-audit", "--no-fund", tarball],
      { cwd: scratch, encoding: "utf8", maxBuffer: 4_000_000, timeout: 180_000 });
      const lock = JSON.parse(await readFile(join(scratch, "package-lock.json"), "utf8"));
      const resolved = Object.entries(lock.packages).flatMap(([key, entry]) =>
        entry?.resolved == null ? [] : [{ key, resolved: entry.resolved }]);
      assert.deepEqual(resolved.filter((entry) => !entry.resolved.startsWith(REGISTRY)), [{
        key: "node_modules/@red-cup-engineering/ethereum-engineering-services-section",
        resolved: `file:${basename(tarball)}`,
      }]);
      await assert.rejects(readFile(join(scratch, "node_modules/@red-cup-engineering/ethereum-engineering-services-section/node_modules/@foundry-rs/forge/package.json")), /ENOENT/u);
      const { stdout } = await execFileAsync(process.execPath, ["--input-type=module", "--eval", invocation],
        { cwd: scratch, env: { HOME: process.env.HOME }, encoding: "utf8", maxBuffer: 12_000_000, timeout: 180_000 });
      const result = JSON.parse(stdout);
      assert.deepEqual(result, { outcome: "completed-fixed-fork-beefy-vault-exit-observation",
        candidateId: "sigmund-beefy-tbtc-cbbtc", executionAdmitted: false });
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

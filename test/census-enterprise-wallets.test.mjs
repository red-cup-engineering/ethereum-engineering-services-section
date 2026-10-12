import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { censusEnterpriseWallets } from "../scripts/census-enterprise-wallets.mjs";

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value)}\n`, "utf8");
}

test("the census distinguishes absent, conforming, and invalid settlement-owned bindings", () => {
  const workspace = mkdtempSync(join(tmpdir(), "enterprise-wallet-census-"));
  const settlement = join(workspace, "lib", "emsenn", "services", "one");
  writeJson(join(settlement, "package.json"), {
    name: "one",
    "x-agentic-metro-enterprise": { "node-id": "one", "organizational-kind": "micro-enterprise" }
  });
  assert.deepEqual(censusEnterpriseWallets(workspace).counts, { total: 1, bound: 0, unbound: 1, invalid: 0 });

  const bindingPath = join(settlement, "content", "evm", "accounts", "eip155-31337.json");
  const binding = {
    profile: "org.emsenn.evm.sovereign-enterprise-account.v3",
    enterprise: { nodeId: "one", urn: "urn:ame:one", enterpriseId: spawnSync("cast", ["keccak", "urn:ame:one"], { encoding: "utf8" }).stdout.trim() },
    chain: { chainId: 31337, caip2: "eip155:31337" },
    account: { address: `0x${"22".repeat(20)}`, caip10: `eip155:31337:0x${"22".repeat(20)}` },
    factory: { address: `0x${"33".repeat(20)}`, userSalt: `0x${"44".repeat(32)}` },
    policy: { signer: `0x${"55".repeat(20)}`, custody: "settlement-private" },
    deployment: { transaction: `0x${"66".repeat(32)}`, block: 1 }
  };
  writeJson(bindingPath, binding);
  assert.deepEqual(censusEnterpriseWallets(workspace).counts, { total: 1, bound: 1, unbound: 0, invalid: 0 });

  binding.policy = {
    signer: `0x${"55".repeat(20)}`,
    custody: "remote-cloud-kms-hsm",
    keyVersion: "projects/union/locations/us-central1/keyRings/settlement/cryptoKeys/one-policy/cryptoKeyVersions/1"
  };
  writeJson(bindingPath, binding);
  assert.deepEqual(censusEnterpriseWallets(workspace).counts, { total: 1, bound: 1, unbound: 0, invalid: 0 });

  binding.policy.keyVersion = "not-a-cloud-kms-key-version";
  writeJson(bindingPath, binding);
  assert.deepEqual(censusEnterpriseWallets(workspace).settlements[0].failures, ["eip155-31337.json:policy"]);

  binding.policy = { signer: `0x${"55".repeat(20)}`, custody: "settlement-private" };

  binding.account.caip10 = `eip155:1:0x${"22".repeat(20)}`;
  writeJson(bindingPath, binding);
  const invalid = censusEnterpriseWallets(workspace);
  assert.deepEqual(invalid.counts, { total: 1, bound: 0, unbound: 0, invalid: 1 });
  assert.deepEqual(invalid.settlements[0].failures, ["eip155-31337.json:CAIP-10"]);
});
import { spawnSync } from "node:child_process";

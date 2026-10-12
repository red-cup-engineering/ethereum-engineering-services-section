import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { verifyPhase2AccountCutover } from "../scripts/verify-phase2-account-cutover.mjs";

function write(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value, "utf8");
}

test("Phase 2 gate rejects the private-controller artifact and legacy account profile", () => {
  const workspace = mkdtempSync(join(tmpdir(), "phase2-account-cutover-"));
  const settlement = join(workspace, "lib", "emsenn", "services", "one");
  write(join(settlement, "package.json"), JSON.stringify({ name: "one", "x-agentic-metro-enterprise": { "node-id": "one" } }));
  write(join(settlement, "content", "evm", "accounts", "eip155-31337.json"), JSON.stringify({ profile: "org.emsenn.evm.sovereign-enterprise-account.v1" }));
  write(join(settlement, "data", "evm", "controller-eip155-31337.env"), "UNION_EVM_CONTROLLER_PRIVATE_KEY=not-a-key\n");
  const report = verifyPhase2AccountCutover(workspace);
  assert.deepEqual(report.failures.map((failure) => failure.type).sort(), ["legacy-account-profile", "non-v3-binding", "private-controller-artifact"]);
});

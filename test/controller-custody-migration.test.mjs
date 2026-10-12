import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { Wallet } from "ethers";
import { migrateSettlementControllerCustody } from "../scripts/migrate-settlement-controller-custody.mjs";

function write(path, value, mode = 0o600) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value, { encoding: "utf8", mode });
}

test("controller migration encrypts custody, records only its digest, and removes plaintext", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "controller-migration-"));
  const credentialRoot = join(workspace, "device-credentials");
  const settlement = join(workspace, "lib", "emsenn", "services", "test-settlement");
  const privateKey = `0x${"01".padStart(64, "0")}`;
  const signer = new Wallet(privateKey).address.toLowerCase();
  const controller = join(settlement, "data", "evm", "controller-eip155-31337.env");
  const binding = join(settlement, "content", "evm", "accounts", "eip155-31337.json");
  write(controller, `UNION_EVM_CONTROLLER_PRIVATE_KEY=${privateKey}\n`);
  write(binding, `${JSON.stringify({ enterprise: { urn: "urn:ame:test-settlement" }, policy: { signer } })}\n`, 0o644);

  const result = await migrateSettlementControllerCustody({ workspace, credentialRoot });
  assert.equal(result.migrated, 1);
  assert.equal(existsSync(controller), false);
  const keystore = join(settlement, "data", "evm", "keystores", "eip155-31337.json");
  assert.equal(JSON.parse(readFileSync(keystore, "utf8")).version, 3);
  const provenance = readFileSync(join(settlement, "data", "provenance", "2026", "07", "19", "2026-07-19-controller-custody-cutover.nq"), "utf8");
  assert.match(provenance, /ni:\/\/\/sha-256;/u);
  assert.equal(provenance.includes(privateKey), false);
});

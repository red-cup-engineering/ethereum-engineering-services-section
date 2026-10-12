import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { keccak256, recoverAddress, toUtf8Bytes } from "ethers";
import { createSettlementKeystore, encryptSettlementMnemonic, inspectSettlementMnemonic, openSettlementSigner } from "../src/settlement-key-custody.mjs";

const TEST_MNEMONIC = "test test test test test test test test test test test junk";
const TEST_SIGNER = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";

test("settlement custody creates an encrypted standard keystore and signs without exporting a key", async () => {
  const directory = mkdtempSync(join(tmpdir(), "settlement-custody-"));
  const passwordFile = join(directory, "password");
  const keystorePath = join(directory, "controller.json");
  writeFileSync(passwordFile, "this-is-a-test-only-settlement-password\n", { mode: 0o600 });
  const created = await createSettlementKeystore({ path: keystorePath, passwordFile });
  assert.equal(created.format, "ethereum-secret-storage-v3");
  assert.equal(Object.hasOwn(created, "privateKey"), false);

  const signer = await openSettlementSigner({ path: keystorePath, passwordFile });
  assert.equal(signer.address.toLowerCase(), created.signer);
  const digest = keccak256(toUtf8Bytes("typed RMN effect"));
  assert.equal(recoverAddress(digest, signer.signingKey.sign(digest)), signer.address);
});

test("settlement custody rejects a publicly readable password file", async () => {
  const directory = mkdtempSync(join(tmpdir(), "settlement-custody-mode-"));
  const passwordFile = join(directory, "password");
  writeFileSync(passwordFile, "this-is-a-test-only-settlement-password\n", { mode: 0o600 });
  chmodSync(passwordFile, 0o644);
  await assert.rejects(
    createSettlementKeystore({ path: join(directory, "controller.json"), passwordFile }),
    /group or other users/u,
  );
});

test("imports a mnemonic only into create-only encrypted custody after exact signer verification", async () => {
  const directory = mkdtempSync(join(tmpdir(), "settlement-mnemonic-custody-"));
  const passwordFile = join(directory, "password");
  const keystorePath = join(directory, "controller.json");
  writeFileSync(passwordFile, "this-is-a-test-only-settlement-password\n", { mode: 0o600 });
  assert.deepEqual(inspectSettlementMnemonic({ mnemonic: TEST_MNEMONIC }), { signer: TEST_SIGNER, wordCount: 12 });
  const created = await encryptSettlementMnemonic({ path: keystorePath, passwordFile, mnemonic: TEST_MNEMONIC, expectedSigner: TEST_SIGNER });
  assert.equal(created.signer, TEST_SIGNER);
  assert.equal(created.sourceRetained, false);
  assert.equal(Object.hasOwn(created, "mnemonic"), false);
  assert.equal(Object.hasOwn(created, "privateKey"), false);
  assert.equal((await openSettlementSigner({ path: keystorePath, passwordFile })).address.toLowerCase(), TEST_SIGNER);
  await assert.rejects(encryptSettlementMnemonic({ path: join(directory, "wrong.json"), passwordFile, mnemonic: TEST_MNEMONIC, expectedSigner: "0x1111111111111111111111111111111111111111" }), /exact expected signer/u);
});

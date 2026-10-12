import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createSettlementKeystore,
  ensureSettlementPassword,
  openSettlementSigner,
  reencryptSettlementKeystore,
} from "../src/settlement-key-custody.mjs";

test("rebinds one controller keystore to a renamed enterprise credential namespace", async () => {
  const root = mkdtempSync(join(tmpdir(), "enterprise-account-custody-"));
  const keystore = join(root, "controller.json");
  const priorPassword = ensureSettlementPassword({
    credentialRoot: root,
    urn: "urn:ame:prior-enterprise",
    chainId: 5615610,
  });
  const renamedPassword = ensureSettlementPassword({
    credentialRoot: root,
    urn: "urn:ame:renamed-enterprise",
    chainId: 5615610,
  });
  const created = await createSettlementKeystore({ path: keystore, passwordFile: priorPassword });
  const prior = await openSettlementSigner({ path: keystore, passwordFile: priorPassword });

  await reencryptSettlementKeystore({ path: keystore, signer: prior, passwordFile: renamedPassword });

  const renamed = await openSettlementSigner({ path: keystore, passwordFile: renamedPassword });
  assert.equal(renamed.address.toLowerCase(), created.signer);
  await assert.rejects(openSettlementSigner({ path: keystore, passwordFile: priorPassword }));
});

import assert from "node:assert/strict";
import test from "node:test";

import { PUBLIC_EVM_WALLET_OBSERVATION_PRODUCT } from "../src/public-wallet-observation-product.mjs";

test("declares the deterministic wallet observation as its provider's deployment-neutral product", () => {
  assert.deepEqual(PUBLIC_EVM_WALLET_OBSERVATION_PRODUCT, {
    profile: "org.emsenn.public-service-product-declaration.v1",
    provider: "urn:ame:ethereum-services-section",
    skill: { id: "observe-public-evm-wallet", name: "Observe a public EVM wallet" },
    epistemicStatus: "deterministic-public-observation",
    reproducibility: "exact-sources-and-chain-snapshots",
    credentialAccess: false,
    inference: false,
    custody: "none",
    settlementPolicy: "deployment-supplied-never-inferred",
  });
  assert.equal(Object.isFrozen(PUBLIC_EVM_WALLET_OBSERVATION_PRODUCT), true);
  assert.equal(Object.isFrozen(PUBLIC_EVM_WALLET_OBSERVATION_PRODUCT.skill), true);
  assert.equal(Object.hasOwn(PUBLIC_EVM_WALLET_OBSERVATION_PRODUCT, "payTo"), false);
  assert.equal(Object.hasOwn(PUBLIC_EVM_WALLET_OBSERVATION_PRODUCT, "resourceUrl"), false);
});

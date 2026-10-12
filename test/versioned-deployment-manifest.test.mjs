import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTIVE_CHAIN,
  loadVerifiedDeploymentManifest,
  MANIFEST_PROFILE,
} from "../src/versioned-deployment-manifest.mjs";

const evidence = (letter) => `urn:sha256:${letter.repeat(64)}`;
const hash = (letter) => `0x${letter.repeat(64)}`;
const address = (letter) => `0x${letter.repeat(40)}`;

function manifest() {
  return {
    profile: MANIFEST_PROFILE,
    version: 1,
    receipt: evidence("a"),
    chain: { caip2: ACTIVE_CHAIN, genesisHash: "unknown" },
    contracts: [{
      standard: "org.example.contract.v1",
      contractName: "Example",
      address: address("1"),
      deployer: "unknown",
      transactionHash: "unknown",
      blockNumber: "unknown",
      runtimeBytecodeHash: hash("1"),
      verification: { addressEvidence: evidence("1"), runtimeBytecodeEvidence: evidence("1") },
    }],
  };
}

test("normalizes the versioned ACTIVE_CHAIN receipt shape without inventing unavailable fields", () => {
  const normalized = loadVerifiedDeploymentManifest(manifest(), { requiredStandards: ["org.example.contract.v1"] });
  assert.equal(normalized.chain.caip2, ACTIVE_CHAIN);
  assert.equal(normalized.chain.genesisHash, "unknown");
  assert.equal(normalized.contracts[0].deployer, "unknown");
  assert.equal(normalized.contracts[0].transactionHash, "unknown");
  assert.equal(normalized.contracts[0].blockNumber, "unknown");
});

test("refuses a missing companion, unknown bytecode, or unverified evidence", () => {
  assert.throws(
    () => loadVerifiedDeploymentManifest(manifest(), { requiredStandards: ["org.example.missing.v1"] }),
    /lacks/i,
  );
  const undeployed = manifest();
  undeployed.contracts[0].runtimeBytecodeHash = "unknown";
  assert.throws(
    () => loadVerifiedDeploymentManifest(undeployed, { requiredStandards: ["org.example.contract.v1"] }),
    /undeployed|unverified/i,
  );
  const unevidenced = manifest();
  unevidenced.contracts[0].verification.runtimeBytecodeEvidence = "receipt-42";
  assert.throws(
    () => loadVerifiedDeploymentManifest(unevidenced, { requiredStandards: ["org.example.contract.v1"] }),
    /evidence/i,
  );
});

test("admits only canonical RFC 6920 spellings at the ni reference boundary", () => {
  const named = manifest();
  named.receipt = "ni:///sha-256;AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  assert.equal(loadVerifiedDeploymentManifest(named).receipt, named.receipt);

  for (const malformed of [
    "ni:///sha-256;short",
    "ni:///sha-256;AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB",
  ]) {
    const source = manifest();
    source.receipt = malformed;
    assert.throws(() => loadVerifiedDeploymentManifest(source), /invalid verified receipt/u);
  }
});

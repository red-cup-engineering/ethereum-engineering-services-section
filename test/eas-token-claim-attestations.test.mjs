import assert from "node:assert/strict";
import test from "node:test";
import { EAS_ATTEST_SIGNATURE, EAS_REGISTER_SCHEMA_SIGNATURE, TOKEN_CLAIM_EAS_SCHEMA, prepareTokenClaimEasAttestation, prepareTokenClaimEasSchemaRegistration } from "../src/eas-token-claim-attestations.mjs";

const word = (byte) => `0x${byte.repeat(32)}`;

test("prepares the official EAS AttestationRequest ABI with a refUID chain and zero resolver value", () => {
  const request = prepareTokenClaimEasAttestation({
    eas: `0x${"11".repeat(20)}`,
    schemaUID: word("22"),
    tokenCommitment: word("33"),
    claimCommitment: word("44"),
    lotCommitment: word("55"),
    witnessProductionCommitment: word("66"),
    relationCommitment: word("77"),
    articulation: "active",
    refUID: word("88"),
    recipient: `0x${"99".repeat(20)}`
  });
  assert.equal(request.schema, TOKEN_CLAIM_EAS_SCHEMA);
  assert.equal(request.call.signature, EAS_ATTEST_SIGNATURE);
  assert.equal(request.request.data.refUID, word("88"));
  assert.equal(request.request.data.revocable, false);
  assert.equal(request.request.data.value, "0");
  assert.equal(request.monetaryValue, "0");
  assert.equal(request.truthClaimed, false);
  assert.match(request.request.data.data, /^0x[0-9a-f]+$/u);
});

test("refuses malformed commitments, unknown articulation, and any implicit payment path", () => {
  const base = { eas: `0x${"11".repeat(20)}`, schemaUID: word("22"), tokenCommitment: word("33"), claimCommitment: word("44"), lotCommitment: word("55"), witnessProductionCommitment: word("66"), articulation: "active" };
  assert.throws(() => prepareTokenClaimEasAttestation({ ...base, claimCommitment: "sha256:not-a-word" }), /claimCommitment/);
  assert.throws(() => prepareTokenClaimEasAttestation({ ...base, articulation: "truth" }), /articulation/);
});

test("prepares an irrevocable zero-resolver registration against the official EAS registry ABI", () => {
  const registration = prepareTokenClaimEasSchemaRegistration({ schemaRegistry: `0x${"aa".repeat(20)}` });
  assert.equal(registration.schema, TOKEN_CLAIM_EAS_SCHEMA);
  assert.equal(registration.revocable, false);
  assert.equal(registration.resolver, `0x${"00".repeat(20)}`);
  assert.match(registration.calldata, /^0x[0-9a-f]+$/u);
  assert.equal(EAS_REGISTER_SCHEMA_SIGNATURE, "register(string,address,bool)(bytes32)");
});

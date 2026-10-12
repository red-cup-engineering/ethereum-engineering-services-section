import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ACTOR,
  MISSING_PRODUCTION_CAPABILITIES,
  UNION_ROOT_ROLE,
  UPSTREAM_DEMANDS,
  run,
} from "../src/enterprise-account-provisioning-contract.mjs";

const at = "2026-07-24T12:00:00.000Z";
const recorded = [];
const recorder = async (entry) => { recorded.push(entry); return { documentNi: "ni:///sha-256;AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }; };
const env = { WITNESS_JOURNAL_RDF_AGENT: "https://witnessJournal.example/.well-known/agent-card.json", ENTERPRISE_ACCOUNT_PROVISIONING_DATA_ROOT: "/tmp/eap-test" };
function solicitation(request = {
  type: "EnterpriseAccountProvisioningDemand",
  chain: { caip2: "eip155:1", role: UNION_ROOT_ROLE, settlementParent: null, executionLifetime: "persistent" },
  enterprise: { urn: "urn:ame:customer" },
}) {
  return { "@context": "https://www.w3.org/ns/activitystreams", id: "urn:test:solicitation", type: "Offer", actor: "urn:ame:customer", target: ACTOR,
    object: { type: "ServiceSolicitation", request } };
}

test("the discoverable manifest operations remain declared", () => {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const catalog = manifest["x-agentic-metro-enterprise"]["operation-catalog"];
  assert.equal(catalog["solicit-service"].accepts, "ActivityStreams Offer<ServiceSolicitation<EnterpriseAccountProvisioningDemand>>");
  assert.equal(catalog["solicit-service"].returns, "ActivityStreams Question<MissingProductionEnterpriseAccountCapability>|Reject<EnterpriseAccountProvisioningRefusal>");
  assert.equal(catalog["invoke-service"].returns, "ActivityStreams Question<MissingProductionEnterpriseAccountCapability>|Reject<EnterpriseAccountProvisioningRefusal>");
});

test("advertises a canonical discoverable face without inventing production chain capability", async () => {
  const result = await run(solicitation(), "solicit-service", at, env, recorder);
  assert.equal(result.type, "Question");
  assert.equal(result.object.type, "MissingProductionEnterpriseAccountCapability");
  assert.ok(result.id.startsWith("ni:///sha-256;"));
  assert.equal(result.object.chainMutation, false);
  assert.equal(result.object.customerWalletSelected, false);
  assert.deepEqual(result.object.missing, MISSING_PRODUCTION_CAPABILITIES);
  assert.ok(result.object.missing.every((articulation) => (
    typeof articulation.token === "string"
    && articulation.token.startsWith("urn:")
    && typeof articulation.claim === "string"
    && articulation.claim.length > 0
    && Object.keys(articulation).length === 2
  )));
  assert.deepEqual(result.object.upstreamDemands, UPSTREAM_DEMANDS);
  assert.equal(result.object.upstreamDemands[0].type, "UnionSovereignSettlementRootCapabilityDemand");
  assert.equal(result.object.upstreamDemands[0].articulation.claim, "persistent-parentless-common-settlement-time-coordinate-for-the-whole-union");
  assert.ok(result.object.upstreamDemands[0].prohibitedSubstitutions.includes("parent-settled-rollup"));
  assert.deepEqual(result.object.requiredCustomerInputs, [
    "stable-settlement-urn",
    "territory",
    "union-sovereign-settlement-root-caip-2",
    "customer-selected-terms",
    "consideration",
    "resource-grant",
  ]);
  assert.deepEqual(result.object.acceptedChainRelation, {
    role: UNION_ROOT_ROLE,
    settlementParent: null,
    executionLifetime: "persistent",
  });
  assert.ok(recorded.at(-1).category.endsWith("solicitation-missing-capability"));
});

test("refuses a different demand rather than impersonating its provider", async () => {
  const result = await run(solicitation({ type: "UnionSettlementTimeChainCapabilityDemand" }), "solicit-service", at, env, recorder);
  assert.equal(result.type, "Reject");
  assert.equal(result.object.reason, "solicitation-request-is-not-enterprise-account-provisioning-demand");
});

test("refuses a development-chain demand rather than silently using its local fixture", async () => {
  const result = await run(solicitation({
    type: "EnterpriseAccountProvisioningDemand",
    chain: { caip2: "eip155:31337", role: UNION_ROOT_ROLE, settlementParent: null, executionLifetime: "persistent" },
  }), "solicit-service", at, env, recorder);
  assert.equal(result.type, "Reject");
  assert.equal(result.object.reason, "development-chain-is-not-a-production-provisioning-capability");
  assert.equal(result.object.chainMutation, false);
});

test("refuses every non-root chain relation at the Union enterprise-account boundary", async () => {
  const parented = await run(solicitation({
    type: "EnterpriseAccountProvisioningDemand",
    chain: { caip2: "eip155:84532", role: UNION_ROOT_ROLE, settlementParent: "eip155:84532", executionLifetime: "persistent" },
  }), "solicit-service", at, env, recorder);
  assert.equal(parented.type, "Reject");
  assert.equal(parented.object.reason, "union-sovereign-settlement-root-must-carry-no-settlement-parent");

  const ephemeral = await run(solicitation({
    type: "EnterpriseAccountProvisioningDemand",
    chain: { caip2: "eip155:9001", role: UNION_ROOT_ROLE, settlementParent: null, executionLifetime: "task-bounded-ephemeral" },
  }), "solicit-service", at, env, recorder);
  assert.equal(ephemeral.type, "Reject");
  assert.equal(ephemeral.object.reason, "union-sovereign-settlement-root-must-be-persistent");

  const arena = await run(solicitation({
    type: "EnterpriseAccountProvisioningDemand",
    chain: { caip2: "eip155:8453", role: "external-arena", settlementParent: null, executionLifetime: "external" },
  }), "solicit-service", at, env, recorder);
  assert.equal(arena.type, "Reject");
  assert.equal(arena.object.reason, "enterprise-account-demand-must-name-the-union-sovereign-settlement-root");
});

test("a customer cannot fabricate the executable offer that the unavailable provider never issued", async () => {
  const offer = { id: "ni:///sha-256;BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB", actor: ACTOR, object: { type: "ExecutableServiceOffer" } };
  const invocation = { "@context": "https://www.w3.org/ns/activitystreams", id: "urn:test:invoke", type: "Accept", actor: "urn:ame:customer", target: ACTOR,
    object: { type: "ServiceContract", offer, capability: { holder: ACTOR, invocationTarget: ACTOR, parentOffer: offer.id, capTP: { method: "invoke-service" }, allowedActions: ["invoke-service"] } } };
  const result = await run(invocation, "invoke-service", at, env, recorder);
  assert.equal(result.type, "Reject");
  assert.equal(result.object.reason, "provider-has-not-issued-an-executable-production-offer");
  assert.equal(result.object.chainMutation, false);
  assert.equal(result.object.assetSettlementClaimed, false);
});

test("invalid time and unavailable provider witnessing return typed refusals", async () => {
  const invalidTime = await run(solicitation(), "solicit-service", "not-a-time", env, recorder);
  assert.equal(invalidTime.type, "Reject");
  assert.equal(invalidTime.object.reason, "recordedAt-must-be-an-ISO-timestamp");

  const unavailableRecorder = async () => { throw new Error("provider witness unavailable"); };
  const unavailable = await run(solicitation(), "solicit-service", at, env, unavailableRecorder);
  assert.equal(unavailable.type, "Reject");
  assert.equal(unavailable.object.reason, "provider-witness-boundary-unavailable");
  assert.equal(unavailable.object.witnessStatus, "unsettled-provider-witness-boundary-unavailable");
});

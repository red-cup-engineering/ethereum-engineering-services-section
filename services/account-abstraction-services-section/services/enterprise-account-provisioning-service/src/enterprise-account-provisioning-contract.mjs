#!/usr/bin/env node
// The public ActivityStreams face is deliberately only an offer/contract
// boundary.  It neither chooses a customer's wallet nor treats the local
// development deployment as a production capability.
import { readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { EMPTY_WITNESS_ROOT, identifyNormalizedSemanticContent } from "@red-cup-engineering/semantic-content-identify-service";
import { inferTy } from "@red-cup-engineering/relation-model-notation-typing";
import { recordSettlementRecord, relationalWitnessJournalDocument } from "@lenticule-science/witness-journal-rdf-projection-service/client";

export const CONTEXT = "https://www.w3.org/ns/activitystreams";
export const ACTOR = "urn:ame:enterprise-account-provisioning-service";
export const NODE_ID = "enterprise-account-provisioning-service";
const HERE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const EFFECTS = Object.freeze(["provider-local-witness-journal-evidence", "conditional-remote-kms-create2-deployment"]);
export const MISSING_PRODUCTION_CAPABILITIES = Object.freeze([
  Object.freeze({
    token: "urn:capability:union-sovereign-settlement-root",
    claim: "independently-observed-union-sovereign-settlement-root-caip-2-chain",
  }),
  Object.freeze({
    token: "urn:capability:canonical-enterprise-account-deployment",
    claim: "canonical-erc-4337-entrypoint-and-enterprise-account-factory",
  }),
]);
export const UNION_ROOT_ROLE = "union-sovereign-settlement-root";
export const UPSTREAM_DEMANDS = Object.freeze([
  Object.freeze({
    type: "UnionSovereignSettlementRootCapabilityDemand",
    articulation: Object.freeze({
      token: "urn:ame:union-sovereign-settlement-root",
      claim: "persistent-parentless-common-settlement-time-coordinate-for-the-whole-union",
    }),
    requiredOutcome: "one-independently-observed-non-development-caip-2-chain-or-typed-refusal",
    prohibitedSubstitutions: Object.freeze([
      "parent-settled-rollup",
      "task-bounded-ephemeral-child-execution-chain",
      "external-arena",
      "development-chain",
    ]),
    openDeterminations: Object.freeze([
      "consensus-law",
      "validator-admission-and-governance",
      "chain-id-and-genesis",
      "gas-policy",
      "terminal-proof-schema-and-child-teardown-law",
    ]),
  }),
  Object.freeze({
    type: "CanonicalEnterpriseAccountDeploymentCapabilityDemand",
    articulation: Object.freeze({
      token: "urn:capability:canonical-enterprise-account-deployment",
      claim: "canonical-erc-4337-entrypoint-and-enterprise-account-factory-on-the-union-sovereign-settlement-root",
    }),
  }),
]);

function identified(body) {
  const term = relationalWitnessJournalDocument(body);
  const id = identifyNormalizedSemanticContent({ objectKind: "ethereum.enterprise-account-provisioning-record", semanticType: inferTy([], term), term, witnessRoot: EMPTY_WITNESS_ROOT }).token;
  return Object.freeze({ id, ...body });
}
function argument(flag) { const at = process.argv.indexOf(flag); return at < 0 ? undefined : process.argv[at + 1]; }
function atNow() { return argument("--now") ?? new Date().toISOString(); }
function dataRoot(env = process.env) { return resolve(env.ENTERPRISE_ACCOUNT_PROVISIONING_DATA_ROOT ?? `${HERE}/data`); }
function witnessJournalAgent(env = process.env) {
  if (!env.WITNESS_JOURNAL_RDF_AGENT) throw new Error("WITNESS_JOURNAL_RDF_AGENT must name the provisioning provider's contracted witness-journal RDF A2A provider");
  return env.WITNESS_JOURNAL_RDF_AGENT;
}
async function append(record, category, recordedAt, env, recorder = recordSettlementRecord) {
  return recorder({ agentUrl: witnessJournalAgent(env), root: dataRoot(env), nodeId: NODE_ID, settlement: ACTOR, actor: ACTOR, category, recordedAt, record });
}
function response(type, source, object, recordedAt) {
  return identified({ "@context": CONTEXT, type, actor: ACTOR, target: source?.actor ?? null, inReplyTo: source?.id ?? null, object, published: recordedAt });
}
async function refusal(source, reason, recordedAt, env, recorder) {
  const record = response("Reject", source, { type: "EnterpriseAccountProvisioningRefusal", reason,
    directEoaExecution: false, customerWalletSelected: false, customerMutation: false, chainMutation: false, assetSettlementClaimed: false }, recordedAt);
  try {
    await append(record, "enterprise-account-provisioning.refusal", recordedAt, env, recorder);
    return record;
  } catch {
    return response("Reject", source, { type: "EnterpriseAccountProvisioningRefusal", reason,
      witnessStatus: "unsettled-provider-witness-boundary-unavailable",
      directEoaExecution: false, customerWalletSelected: false, customerMutation: false, chainMutation: false, assetSettlementClaimed: false }, recordedAt);
  }
}
function solicitationProblem(activity) {
  const request = activity?.object?.request;
  if (activity?.["@context"] !== CONTEXT || activity.type !== "Offer" || activity.target !== ACTOR || activity.object?.type !== "ServiceSolicitation") return "solicitation-must-be-addressed-activitystreams-offer";
  if (!request || typeof request !== "object" || Array.isArray(request)) return "solicitation-must-carry-a-typed-provisioning-request";
  if (request.type !== "EnterpriseAccountProvisioningDemand") return "solicitation-request-is-not-enterprise-account-provisioning-demand";
  if (request.chain?.caip2 === "eip155:31337" || request.chain === "eip155:31337") return "development-chain-is-not-a-production-provisioning-capability";
  if (request.chain?.role !== UNION_ROOT_ROLE) return "enterprise-account-demand-must-name-the-union-sovereign-settlement-root";
  if (request.chain.settlementParent !== null) return "union-sovereign-settlement-root-must-carry-no-settlement-parent";
  if (request.chain.executionLifetime !== "persistent") return "union-sovereign-settlement-root-must-be-persistent";
  if (request.account || request.wallet || request.eoa || request.deployer) return "provider-never-selects-or-accepts-a-customer-wallet-or-direct-eoa";
  return null;
}
function capabilityQuestion(source, recordedAt) {
  return response("Question", source, { type: "MissingProductionEnterpriseAccountCapability",
    missing: MISSING_PRODUCTION_CAPABILITIES,
    upstreamDemands: UPSTREAM_DEMANDS,
    requiredCustomerInputs: [
      "stable-settlement-urn",
      "territory",
      "union-sovereign-settlement-root-caip-2",
      "customer-selected-terms",
      "consideration",
      "resource-grant",
    ],
    unavailableEffects: ["remote-kms-create2-deployment", "chain-broadcast"],
    acceptedChainRelation: { role: UNION_ROOT_ROLE, settlementParent: null, executionLifetime: "persistent" },
    rejectedChainRelations: ["task-bounded-ephemeral-child-execution-chain", "external-arena", "parent-settled-rollup-presented-as-union-root"],
    directEoaExecution: false, customerWalletSelected: false, chainMutation: false, assetSettlementClaimed: false }, recordedAt);
}
function invocationProblem(activity) {
  const contract = activity?.object;
  if (activity?.["@context"] !== CONTEXT || activity.type !== "Accept" || activity.target !== ACTOR || contract?.type !== "ServiceContract") return "invocation-must-be-addressed-activitystreams-accept";
  return "provider-has-not-issued-an-executable-production-offer";
}
async function missingCapability(source, stage, recordedAt, env, recorder) {
  const question = capabilityQuestion(source, recordedAt);
  try {
    await append(question, `enterprise-account-provisioning.${stage}-missing-capability`, recordedAt, env, recorder);
    return question;
  } catch {
    return response("Reject", source, { type: "EnterpriseAccountProvisioningRefusal",
      reason: "provider-witness-boundary-unavailable", witnessStatus: "unsettled-provider-witness-boundary-unavailable",
      directEoaExecution: false, customerWalletSelected: false, customerMutation: false, chainMutation: false, assetSettlementClaimed: false }, recordedAt);
  }
}
export async function run(activity, operation = "invoke-service", recordedAt = new Date().toISOString(), env = process.env, recorder = recordSettlementRecord) {
  if (!Number.isFinite(Date.parse(recordedAt))) return refusal(activity, "recordedAt-must-be-an-ISO-timestamp", new Date().toISOString(), env, recorder);
  if (operation === "solicit-service") {
    const problem = solicitationProblem(activity);
    if (problem) return refusal(activity, problem, recordedAt, env, recorder);
    return missingCapability(activity, "solicitation", recordedAt, env, recorder);
  }
  if (operation === "invoke-service") {
    const problem = invocationProblem(activity);
    if (problem) return refusal(activity, problem, recordedAt, env, recorder);
    return missingCapability(activity, "invocation", recordedAt, env, recorder);
  }
  return refusal(activity, "unknown-provider-operation", recordedAt, env, recorder);
}

if (process.argv.includes("--provider-cli") || (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))) {
  try {
    const activity = JSON.parse(readFileSync(0, "utf8"));
    const output = await run(activity, argument("--operation") ?? "invoke-service", atNow());
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    if (output.type === "Reject") process.exitCode = 2;
  } catch (error) { process.stderr.write(`${basename(process.argv[1])}: ${error.message}\n`); process.exitCode = 1; }
}

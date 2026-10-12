import { readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256Digest, sha256Hex } from "@red-cup-engineering/cryptographic-computer-data-engineering-services-section/integrity";
import { semanticId } from "@red-cup-engineering/computer-content-address-engineering-services-section/semiotic-content-address";

export const ETHEREUM_ACTIVITY_PROVIDER = "urn:ame:ethereum-services-section:evm-activity-pulse-provider";
const COLONY_ACTOR = "urn:ame:bare-cedar-fog-colony";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_STATE = join(ROOT, "data", "state", "development-chain-state", "eip155-31337.json");
const DEFAULT_DEPLOYMENT = join(ROOT, "content", "deployments", "eip155-31337.json");
function hex(value) { return typeof value === "string" ? Number.parseInt(value, 16) : Number(value ?? 0); }
function evidence(name) { return `urn:ame:ethereum-services-section:evidence:${name}`; }

export async function collectEthereumColonyActivity({ window, recordedAt, statePath = DEFAULT_STATE, deploymentPath = DEFAULT_DEPLOYMENT } = {}) {
  const stateBytes = readFileSync(statePath); const state = JSON.parse(stateBytes); const deploymentBytes = readFileSync(deploymentPath); const deployment = JSON.parse(deploymentBytes);
  const from = Date.parse(window.fromExclusive); const to = Date.parse(window.toInclusive);
  const blocks = state.blocks.map((block) => ({ block, number: hex(block.header.number), occurredAt: new Date(hex(block.header.timestamp) * 1000).toISOString() }))
    .filter(({ occurredAt }) => Date.parse(occurredAt) > from && Date.parse(occurredAt) <= to)
    .sort((left, right) => left.number - right.number);
  const timestamps = new Map(blocks.map((item) => [item.number, item.occurredAt]));
  const transactions = state.transactions.filter((transaction) => transaction && timestamps.has(Number(transaction.block_number)));
  const succeeded = transactions.filter((transaction) => transaction.receipt?.status === "0x1").length;
  const failed = transactions.filter((transaction) => transaction.receipt?.status === "0x0").length;
  const logs = transactions.reduce((sum, transaction) => sum + (transaction.receipt?.logs?.length ?? 0), 0);
  const senders = new Set(transactions.map((transaction) => transaction.info?.from).filter(Boolean));
  const destinations = new Set(transactions.map((transaction) => transaction.info?.to).filter(Boolean));
  const contractCreations = transactions.filter((transaction) => transaction.info?.contract_address).length;
  const executionTraces = transactions.reduce((sum, transaction) => sum + (Array.isArray(transaction.info?.traces) ? transaction.info.traces.length : 0), 0);
  const gas = blocks.reduce((sum, item) => sum + hex(item.block.header.gasUsed), 0);
  const stateWitness = `${evidence("development-chain")}:${sha256Digest(stateBytes)}`;
  const events = [];
  if (blocks.length || transactions.length) events.push({
    id: semanticId({ fromExclusive: window.fromExclusive, toInclusive: window.toInclusive, blocks: blocks.length, transactions: transactions.length, succeeded, failed }),
    occurredAt: blocks.at(-1)?.occurredAt ?? window.toInclusive, domain: "evm", kind: "development-chain-interval",
    summary: `${blocks.length} EVM blocks (${blocks.at(0)?.number ?? "unknown"}–${blocks.at(-1)?.number ?? "unknown"} in the development-chain trace) carried ${transactions.length} transactions from ${senders.size} senders to ${destinations.size} destinations: ${succeeded} succeeded and ${failed} failed, creating ${contractCreations} contracts and emitting ${logs} logs.`,
    localOrder: { traceId: "urn:ame:ethereum-services-section:development-chain:eip155-31337", fromOrdinal: blocks.at(0)?.number ?? 0, toOrdinal: blocks.at(-1)?.number ?? 0, unit: "blocks" },
    // Labelled "Union resource flow — " to match the one existing cross-colony
    // resource-flow convention (leader-movement-team's collect-colony-activity.mjs:
    // work orders, per-token inference, Hive treasury). Gas is this corpus's one
    // directly-witnessed compute-flow meter; without this prefix it never joined
    // that section and stayed invisible next to the other resource-flow figures.
    outcome: failed > 0 ? "failed" : "succeeded", quantities: [
      { label: "Union resource flow — EVM blocks", amount: String(blocks.length), unit: "blocks", displayOrder: 200 },
      { label: "Union resource flow — EVM transactions", amount: String(transactions.length), unit: "transactions", displayOrder: 201 },
      { label: "Union resource flow — EVM successful transactions", amount: String(succeeded), unit: "transactions", displayOrder: 202 },
      { label: "Union resource flow — EVM failed transactions", amount: String(failed), unit: "transactions", displayOrder: 203 },
      { label: "Union resource flow — EVM logs", amount: String(logs), unit: "logs", displayOrder: 204 },
      { label: "Union resource flow — EVM gas used", amount: String(gas), unit: "gas", displayOrder: 205 },
      { label: "Union resource flow — EVM distinct transaction senders", amount: String(senders.size), unit: "accounts", displayOrder: 206 },
      { label: "Union resource flow — EVM distinct destinations", amount: String(destinations.size), unit: "accounts", displayOrder: 207 },
      { label: "Union resource flow — EVM contracts created", amount: String(contractCreations), unit: "contracts", displayOrder: 208 },
      { label: "Union resource flow — EVM execution traces", amount: String(executionTraces), unit: "traces", displayOrder: 209 }
    ], evidence: [stateWitness]
  });
  const observedAt = statSync(statePath).mtime.toISOString();
  const deploymentWitness = `${evidence("standards-deployment")}:${sha256Digest(deploymentBytes)}`;
  return { type: "ColonyActivityPulseEnvelope", providerActor: ETHEREUM_ACTIVITY_PROVIDER, settlementActor: "urn:ame:ethereum-services-section", colonyActor: COLONY_ACTOR, window, recordedAt,
    events, stocks: [
      { id: "development-chain-height", observedAt: observedAt > window.toInclusive ? window.toInclusive : observedAt, domain: "evm", label: "Development chain height", amount: String(state.best_block_number), unit: "blocks", status: "observed", displayOrder: 800, evidence: [stateWitness] },
      { id: "deployed-evm-standards", observedAt: observedAt > window.toInclusive ? window.toInclusive : observedAt, domain: "deployments", label: "Deployed EVM standards", amount: String(deployment.deployments?.length ?? 0), unit: "contracts", status: "observed", displayOrder: 801, evidence: [deploymentWitness] }
    ], unsupportedDomains: ["formations", "contracts", "work", "a2a", "activity-streams", "git-io", "economy", "operations"], refusals: [] };
}

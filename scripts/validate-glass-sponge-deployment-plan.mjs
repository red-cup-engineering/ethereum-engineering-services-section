#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const path = new URL("../content/deployment-plans/eip155-5615611-glass-sponge.json", import.meta.url);
const plan = JSON.parse(await readFile(path, "utf8"));
if (plan.type !== "UndeployedEvmDeploymentPlan" || plan.status !== "candidate-undeployed") throw new Error("plan must be explicitly undeployed");
if (plan.chainId !== "eip155:5615611") throw new Error("plan chain drift");
if (plan.existingSemioticExchangeV1 !== "0xc4234dc42c9d93bc7d61b0354aba2729ae52e322") throw new Error("SemioticExchange v1 join drift");
if (plan.broadcast !== false || plan.signing !== false || plan.chainMutation !== false) throw new Error("plan carries mutation authority");
if (!Array.isArray(plan.contracts) || plan.contracts.length !== 8) throw new Error("plan contract set incomplete");
for (const [index, contract] of plan.contracts.entries()) {
  if (contract.order !== index || typeof contract.contract !== "string" || !Array.isArray(contract.constructor)) throw new Error(`invalid step ${index}`);
  if (contract.address !== null || contract.transactionHash !== null || contract.blockNumber !== null) throw new Error(`${contract.contract} falsely appears deployed`);
}
process.stdout.write(`${JSON.stringify({ ok: true, status: plan.status, chainId: plan.chainId, contracts: plan.contracts.length })}\n`);

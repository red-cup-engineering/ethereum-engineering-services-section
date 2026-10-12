#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { semanticId } from "@red-cup-engineering/computer-content-address-engineering-services-section/semiotic-content-address";

const execution = process.argv[2];
const imageDigest = process.argv[3];
if (!/^a5615611-glass-sponge-deployer-[a-z0-9]+$/u.test(execution ?? "")) throw new Error("exact Cloud Run execution is required");
if (!/^sha256:[0-9a-f]{64}$/u.test(imageDigest ?? "")) throw new Error("exact image digest is required");
const observed = spawnSync("gcloud", ["logging", "read", `resource.type=\"cloud_run_job\" AND labels.\"run.googleapis.com/execution_name\"=\"${execution}\"`, "--project=five-six-one-group-dev", "--limit=20", "--order=asc", "--format=json"], { encoding: "utf8" });
if (observed.status !== 0) throw new Error("Cloud Run deployment receipt is unavailable");
const log = JSON.parse(observed.stdout).find((entry) => entry.jsonPayload?.type === "Eip1555615611GlassSpongeDeploymentReceipt")?.jsonPayload;
if (!log || log.chain !== "eip155:5615611" || log.contracts?.length !== 8) throw new Error("complete deployment receipt is absent");
const receipt = { ...log, execution, imageDigest };
const receiptId = semanticId(receipt);
const standards = {
  Mark: "org.emsenn.evm.semiotic-mark.v1", Utterance: "org.emsenn.evm.semiotic-utterance.v1",
  CrossSystemTimeWitnessRegistryV1: "org.emsenn.evm.cross-system-time-witness-registry.v1",
  ContentClaimRegistryV1: "org.emsenn.evm.content-claim-registry.v1",
  ActorOfficeBindingRegistryV1: "org.emsenn.evm.actor-office-binding-registry.v1",
  GlassPoreRegistryV1: "org.emsenn.evm.glass-pore-registry.v1",
  ConsiderationEvidenceRegistryV1: "org.emsenn.evm.consideration-evidence-registry.v1",
  OutcomeReceiptRegistryV1: "org.emsenn.evm.outcome-receipt-registry.v1",
};
const manifest = {
  profile: "org.emsenn.evm.verified-deployment-manifest.v1", version: 1, receipt: receiptId,
  chain: { caip2: log.chain, genesisHash: log.genesisHash },
  contracts: log.contracts.map((contract) => ({
    standard: standards[contract.contractName], contractName: contract.contractName,
    address: contract.address, deployer: contract.deployer, transactionHash: contract.transactionHash,
    blockNumber: contract.blockNumber, runtimeBytecodeHash: contract.runtimeBytecodeHash,
    verification: { addressEvidence: receiptId, runtimeBytecodeEvidence: receiptId },
    creationBytecodeHash: contract.creationBytecodeHash, constructorEventCount: contract.eventCount,
  })),
};
const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
function writeExact(path, value) {
  const body = `${JSON.stringify(value, null, 2)}\n`; mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) { if (readFileSync(path, "utf8") !== body) throw new Error(`different record occupies ${path}`); return; }
  writeFileSync(path, body, { flag: "wx", mode: 0o644 });
}
const receiptPath = resolve(root, "data/records/deployment-records/2026-07-30-eip155-5615611-glass-sponge.json");
const manifestPath = resolve(root, "content/deployments/eip155-5615611.json");
writeExact(receiptPath, receipt); writeExact(manifestPath, manifest);
process.stdout.write(`${JSON.stringify({ type: "GlassSpongeDeploymentMaterialized", receipt: receiptId, receiptPath, manifestPath })}\n`);

#!/usr/bin/env node
import { makeNiUri as rawNiUri } from "@red-cup-engineering/uri-services-section/ni-uri";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";

const execution = process.argv[2], settlement = resolve(process.argv[3] ?? "");
const workspace = resolve(process.argv[4] ?? "/home/emsenn/info");
if (!/^[a-z0-9-]+-[a-z0-9]+$/u.test(execution ?? "")) throw new Error("exact Cloud Run execution is required");
if (settlement !== workspace && !settlement.startsWith(`${workspace}${sep}`)) throw new Error("settlement must be inside workspace");
const manifest = JSON.parse(readFileSync(resolve(settlement, "package.json"), "utf8"));
const nodeId = manifest["x-agentic-metro-enterprise"]?.["node-id"];
if (!nodeId) throw new Error("settlement node id is absent");
const observed = spawnSync("gcloud", ["logging", "read", `resource.type=\"cloud_run_job\" AND labels.\"run.googleapis.com/execution_name\"=\"${execution}\" AND logName:\"stdout\"`, "--project=five-six-one-group-dev", "--limit=300", "--order=asc", "--format=value(textPayload)"], { encoding: "utf8" });
if (observed.status !== 0) throw new Error("provisioning receipt log is unavailable");
const value = JSON.parse(observed.stdout);
if (value.type !== "EnterpriseAccountProvisioned" || value.binding?.enterprise?.nodeId !== nodeId || value.binding?.chain?.caip2 !== "eip155:5615611" || value.receipt?.funding?.minimumWei !== "10000000000000000") throw new Error("provisioning receipt does not match the canonical canary binding");
const carrier = { ...value, cloudRunExecution: execution, economicChoice: { type: "PrivateChainCanaryFundingFloor", minimumWei: "10000000000000000", productionEconomics: false } };
const body = `${JSON.stringify(carrier, null, 2)}\n`;
const ni = rawNiUri(Buffer.from(body, "utf8"));
function writeExact(path, content) { mkdirSync(dirname(path), { recursive: true }); if (existsSync(path)) { if (readFileSync(path, "utf8") !== content) throw new Error(`different record occupies ${path}`); } else writeFileSync(path, content, { flag: "wx", mode: 0o644 }); }
const bindingPath = resolve(settlement, "content/evm/accounts/eip155-5615611.json");
const receiptPath = resolve(settlement, "data/records/2026/07/30/eip155-5615611-enterprise-account.json");
writeExact(bindingPath, `${JSON.stringify(value.binding, null, 2)}\n`);
writeExact(receiptPath, body);
process.stdout.write(`${JSON.stringify({ type: "CloudEnterpriseAccountReceiptMaterialized", nodeId, account: value.account, bindingPath, receiptPath, ni })}\n`);

#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const path = new URL(
  "../content/deployment-plans/eip155-5615611-x402-settlement-asset-v2.json",
  import.meta.url
);
const plan = JSON.parse(await readFile(path, "utf8"));

if (plan.type !== "UndeployedX402ExactSettlementAssetPlan"
    || plan.standard !== "org.emsenn.evm.x402-exact-settlement-asset.eip3009.v2"
    || plan.status !== "candidate-undeployed") {
  throw new Error("plan identity must remain the undeployed v2 candidate");
}
if (plan.chainId !== "eip155:5615611" || plan.protocol?.network !== plan.chainId
    || plan.protocol?.scheme !== "exact" || plan.protocol?.schemeVersion !== 2) {
  throw new Error("x402 exact-v2 chain binding drift");
}
if (plan.protocol?.authorization !== "EIP-3009 TransferWithAuthorization"
    || !plan.protocol?.payerSignatureValidation?.includes("ERC-1271")) {
  throw new Error("required EIP-3009/ERC-1271 path absent");
}
if (plan.contract?.name !== "X402ExactSettlementAssetV2"
    || plan.contract?.source !== "src/X402ExactSettlementAssetV2.sol") {
  throw new Error("successor contract binding drift");
}
const constructorFields = ["name", "symbol", "version", "decimals", "initialHolder", "initialSupply"];
for (const field of constructorFields) {
  if (!(field in plan.contract.constructor) || plan.contract.constructor[field] !== null) {
    throw new Error(`constructor ${field} must remain explicitly unresolved`);
  }
}
for (const field of ["address", "transactionHash", "blockNumber"]) {
  if (plan.contract[field] !== null) throw new Error(`contract ${field} falsely appears deployed`);
}
for (const field of ["enterpriseAccount", "entryPoint", "enterpriseAccountFactory", "policySigner"]) {
  if (plan.sovereignPayer?.[field] !== null) throw new Error(`${field} must remain unresolved`);
}
if (plan.deploymentAuthority?.rawPrivateKeyAccepted !== false
    || plan.deploymentAuthority?.commandLinePrivateKeyAccepted !== false
    || plan.deploymentAuthority?.deploymentExecutablePresent !== false) {
  throw new Error("plan admits a raw-key deployment path");
}
if (plan.funding !== false || plan.broadcast !== false || plan.signing !== false
    || plan.chainMutation !== false) {
  throw new Error("plan carries funding, signing, or chain-mutation authority");
}
if (!Array.isArray(plan.requiredPredeploymentDecisions)
    || plan.requiredPredeploymentDecisions.length < 6) {
  throw new Error("predeployment decision gates are incomplete");
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  status: plan.status,
  chainId: plan.chainId,
  contract: plan.contract.name,
  constructorTermsResolved: 0,
  deploymentAuthority: "HSM-only"
})}\n`);

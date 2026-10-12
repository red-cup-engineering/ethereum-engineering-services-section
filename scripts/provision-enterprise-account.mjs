#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { openSettlementSigner } from "../src/settlement-key-custody.mjs";
import { argument as option } from "@red-cup-engineering/javascript-node-services-section/argv";

import { createEnterpriseAccountBinding } from "../src/enterprise-account-binding.mjs";
import { provisionEnterpriseAccount } from "../src/provision-enterprise-account.mjs";

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_WORKSPACE = resolve(HERE, "../../../../../../../../../../../../../..");
const SETTLEMENT_CAIP2 = process.env.SETTLEMENT_CAIP2 ?? "eip155:5615611";
if (SETTLEMENT_CAIP2 !== "eip155:5615611") throw new Error(`enterprise-account provisioning is cut over to ${SETTLEMENT_CAIP2}`);
const DEFAULT_DEPLOYMENT = resolve(HERE, "../../../../data/records/deployment-records/eip155-5615611-semiotic-exchange.json");

function required(name) { const value = option(name) ?? process.env[name.replace(/^--/u, "").replaceAll("-", "_").toUpperCase()]; if (!value) throw new Error(`${name} is required`); return value; }

const rpcUrl = required("--rpc-url");
const urn = required("--urn");
const policySigner = required("--policy-signer");
const policyCustody = required("--policy-custody");
if (!["settlement-private", "remote-cloud-kms-hsm"].includes(policyCustody)) throw new Error("--policy-custody must identify the actual existing policy key custody");
const policyKeyVersion = policyCustody === "remote-cloud-kms-hsm" ? required("--policy-key-version") : undefined;
const deployerAddress = required("--deployer-address");
const deployerKeystore = required("--deployer-keystore");
const deployerPasswordFile = required("--deployer-password-file");
const minimumFundingWei = BigInt(option("--minimum-account-funding-wei") ?? process.env.MINIMUM_ACCOUNT_FUNDING_WEI ?? "0");
const workspace = resolve(option("--workspace") ?? process.env.WORKSPACE ?? DEFAULT_WORKSPACE);
const receiptOnly = process.argv.includes("--receipt-only") || process.env.RECEIPT_ONLY === "true";
const suppliedSettlement = receiptOnly ? undefined : required("--settlement");
const settlement = suppliedSettlement === undefined ? null : resolve(isAbsolute(suppliedSettlement) ? suppliedSettlement : join(workspace, suppliedSettlement));
if (settlement !== null && settlement !== workspace && !settlement.startsWith(`${workspace}${sep}`)) throw new Error("settlement must be inside the supplied workspace");
const manifestPath = settlement === null ? null : join(settlement, "package.json");
if (manifestPath !== null && !existsSync(manifestPath)) throw new Error("settlement package.json is absent");
const manifest = manifestPath === null ? null : JSON.parse(readFileSync(manifestPath, "utf8"));
const nodeId = receiptOnly ? required("--node-id") : manifest["x-agentic-metro-enterprise"]?.["node-id"];
if (!nodeId) throw new Error("settlement does not declare x-agentic-metro-enterprise.node-id");
const bindingPath = settlement === null ? null : join(settlement, "content", "evm", "accounts", "eip155-5615611.json");

const deployment = JSON.parse(readFileSync(option("--deployment") ?? process.env.DEPLOYMENT_PATH ?? DEFAULT_DEPLOYMENT, "utf8"));
const wallet = await openSettlementSigner({ path: deployerKeystore, passwordFile: deployerPasswordFile });
if (wallet.address.toLowerCase() !== deployerAddress.toLowerCase()) throw new Error("deployer keystore does not match --deployer-address");
const deployerSigner = Object.freeze({
  address: wallet.address.toLowerCase(), custody: "local-settlement-keystore",
  signDigest: async (digest) => wallet.signingKey.sign(digest).serialized,
});
const receipt = await provisionEnterpriseAccount({
  rpcUrl,
  deployment,
  urn,
  policySigner,
  deployerSigner,
  minimumFundingWei,
});
const binding = createEnterpriseAccountBinding({
  nodeId,
  urn,
  chainId: receipt.chainId,
  account: receipt.account,
  factory: receipt.factory,
  policySigner: receipt.policySigner,
  policyCustody,
  policyKeyVersion,
  userSalt: receipt.userSalt,
  transaction: receipt.deployment.transaction,
  block: receipt.deployment.block,
  accounting: {
    authority: { enterpriseUrn: receipt.authority.enterpriseUrn, nodeId },
    funding: {
      source: receipt.funding.source,
      treasury: receipt.funding.treasury,
      custody: receipt.funding.custody,
      keyVersion: receipt.funding.keyVersion,
      minimumWei: receipt.funding.minimumWei,
      balanceWei: receipt.funding.balanceWei,
      transactions: [...receipt.funding.transactions],
    },
    chain: {
      deployment: { ...receipt.chainAccounting.deployment },
      idempotentReconciliation: receipt.chainAccounting.idempotentReconciliation,
    },
  },
});
if (bindingPath !== null) mkdirSync(dirname(bindingPath), { recursive: true });
if (bindingPath !== null && existsSync(bindingPath)) {
  const existing = JSON.parse(readFileSync(bindingPath, "utf8"));
  if (JSON.stringify(existing) !== JSON.stringify(binding)) throw new Error(`a different ${SETTLEMENT_CAIP2} binding already occupies ${bindingPath}`);
} else if (bindingPath !== null) {
  writeFileSync(bindingPath, `${JSON.stringify(binding, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o644 });
}
process.stdout.write(`${JSON.stringify({
  type: "EnterpriseAccountProvisioned",
  protocol: "Ethereum-Secret-Storage/CREATE2/ERC-4337",
  settlement,
  actor: urn,
  account: receipt.account,
  binding,
  receipt,
  localPrivateKeyMaterial: true,
  materialized: bindingPath !== null,
  durableCarrier: receiptOnly ? "caller-supplied-existing-receipt-consumer" : "settlement-worktree-binding",
}, null, 2)}\n`);

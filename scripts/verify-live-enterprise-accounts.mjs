#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { censusEnterpriseWallets } from "./census-enterprise-wallets.mjs";

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_WORKSPACE = resolve(HERE, "../../../../../../../../../..");
const DEFAULT_DEPLOYMENT = resolve(HERE, "content/deployments/eip155-31337.json");
const DEPLOYED = "EnterpriseAccountDeployed(bytes32,address,address,bytes32)";
function option(name, fallback) { const at = process.argv.indexOf(name); return at === -1 ? fallback : process.argv[at + 1]; }
function cast(...args) { const run = spawnSync("cast", args, { encoding: "utf8" }); if (run.status !== 0) throw new Error((run.stderr || run.stdout).trim()); return run.stdout.trim(); }
function selector(signature) { return cast("sig", signature).slice(2).toLowerCase(); }
function returnAddress(value) { return `0x${value.slice(-40)}`.toLowerCase(); }
function wordAddress(value) { return `${"0".repeat(24)}${value.slice(2)}`; }
const SELECTOR = Object.freeze({
  enterpriseId: selector("enterpriseId()"),
  policySigner: selector("policySigner()"),
  entryPoint: selector("entryPoint()"),
  accountAddress: selector("accountAddress(bytes32,address,bytes32)"),
  supportsInterface: selector("supportsInterface(bytes4)"),
  eip712Domain: selector("eip712Domain()"),
  erc1155Received: selector("onERC1155Received(address,address,uint256,uint256,bytes)"),
  erc1155BatchReceived: selector("onERC1155BatchReceived(address,address,uint256[],uint256[],bytes)")
});
function accountBindings(workspace, census) {
  return census.settlements.flatMap((settlement) => {
    if (settlement.status !== "bound") return [];
    const directory = join(workspace, settlement.root, "content", "evm", "accounts");
    return readdirSync(directory).filter((name) => name.endsWith(".json")).sort().map((name) => ({ settlement, path: join(directory, name), binding: JSON.parse(readFileSync(join(directory, name), "utf8")) }));
  });
}

export async function verifyLiveEnterpriseAccounts({ workspace = DEFAULT_WORKSPACE, rpcUrl, deploymentPath = DEFAULT_DEPLOYMENT, nodeId }) {
  if (!rpcUrl) throw new Error("rpcUrl is required");
  async function rpc(method, params = []) {
    let last;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      try {
        const response = await fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: attempt + 1, method, params }) });
        const body = await response.json(); if (body.error) throw new Error(`${method}: ${body.error.message}`); return body.result;
      } catch (error) { last = error; await new Promise((resume) => setTimeout(resume, 25 * (attempt + 1))); }
    }
    throw last;
  }
  async function call(to, data) { return rpc("eth_call", [{ to, data }, "latest"]); }
  const census = censusEnterpriseWallets(workspace);
  const selectedSettlements = nodeId === undefined
    ? census.settlements
    : census.settlements.filter((item) => item.nodeId === nodeId);
  if (nodeId !== undefined && selectedSettlements.length === 0) throw new Error(`enterprise node is absent from the settlement census: ${nodeId}`);
  const bindings = accountBindings(workspace, { ...census, settlements: selectedSettlements });
  const failures = selectedSettlements.filter((item) => item.status !== "bound").map((item) => ({ nodeId: item.nodeId, path: item.root, checks: item.failures }));
  const chainId = Number(BigInt(await rpc("eth_chainId")));
  const standards = JSON.parse(readFileSync(deploymentPath, "utf8"));
  if (standards.chainId !== `eip155:${chainId}`) throw new Error("standards deployment belongs to a different chain");
  const expectedEntryPoint = standards.deployments.find(({ standard }) => standard === "org.ethereum.erc-4337.entry-point.v0.8")?.address?.toLowerCase();
  const expectedFactory = standards.deployments.find(({ standard }) => standard === "org.emsenn.evm.sovereign-enterprise-account.v3")?.address?.toLowerCase();
  if (!expectedEntryPoint || !expectedFactory) throw new Error("canonical EntryPoint or EnterpriseAccountFactory is absent from the standards deployment");
  const deployedTopic = cast("keccak", DEPLOYED).toLowerCase();
  const erc1155 = `0x${(Number.parseInt(SELECTOR.erc1155Received, 16) ^ Number.parseInt(SELECTOR.erc1155BatchReceived, 16)).toString(16).padStart(8, "0")}`;
  const interfaces = ["0x01ffc9a7", "0x1626ba7e", `0x${SELECTOR.eip712Domain}`, "0x150b7a02", erc1155];
  async function verifyBinding({ settlement, path, binding }) {
    const checks = [];
    const account = binding.account.address.toLowerCase(), factory = binding.factory.address.toLowerCase();
    try {
      if (binding.chain.chainId !== chainId) checks.push("rpc-chain");
      const predictedData = `0x${SELECTOR.accountAddress}${binding.enterprise.enterpriseId.slice(2)}${wordAddress(binding.policy.signer)}${binding.factory.userSalt.slice(2)}`;
      const interfaceCalls = interfaces.map((interfaceId) => call(account, `0x${SELECTOR.supportsInterface}${interfaceId.slice(2)}${"0".repeat(56)}`));
      const [accountCode, factoryCode, enterpriseResult, policyResult, accountEntryPointResult, factoryEntryPointResult, predictedResult, receipt, ...supportedInterfaces] = await Promise.all([
        rpc("eth_getCode", [account, "latest"]), rpc("eth_getCode", [factory, "latest"]),
        call(account, `0x${SELECTOR.enterpriseId}`), call(account, `0x${SELECTOR.policySigner}`),
        call(account, `0x${SELECTOR.entryPoint}`), call(factory, `0x${SELECTOR.entryPoint}`),
        call(factory, predictedData), rpc("eth_getTransactionReceipt", [binding.deployment.transaction]), ...interfaceCalls
      ]);
      if (accountCode === "0x") checks.push("account-code");
      if (factoryCode === "0x") checks.push("factory-code");
      const observedEnterprise = enterpriseResult.toLowerCase();
      const observedPolicy = returnAddress(policyResult);
      const accountEntryPoint = returnAddress(accountEntryPointResult);
      const factoryEntryPoint = returnAddress(factoryEntryPointResult);
      if (observedEnterprise !== binding.enterprise.enterpriseId.toLowerCase()) checks.push("enterprise-id");
      if (observedPolicy !== binding.policy.signer.toLowerCase()) checks.push("policy-signer");
      if (accountEntryPoint !== factoryEntryPoint || await rpc("eth_getCode", [accountEntryPoint, "latest"]) === "0x") checks.push("entry-point");
      if (accountEntryPoint !== expectedEntryPoint) checks.push("noncanonical-entry-point");
      if (factory !== expectedFactory) checks.push("noncanonical-factory");
      const predicted = returnAddress(predictedResult);
      if (predicted !== account) checks.push("create2-prediction");
      supportedInterfaces.forEach((supported, index) => { if (BigInt(supported) !== 1n) checks.push(`interface:${interfaces[index]}`); });
      const witnessed = receipt && BigInt(receipt.status) === 1n && Number(BigInt(receipt.blockNumber)) === binding.deployment.block && receipt.logs.some((log) => log.address.toLowerCase() === factory && log.topics?.[0]?.toLowerCase() === deployedTopic && log.topics?.[1]?.toLowerCase() === binding.enterprise.enterpriseId.toLowerCase() && returnAddress(log.topics?.[2]) === account && returnAddress(log.topics?.[3]) === binding.policy.signer.toLowerCase() && log.data?.toLowerCase() === binding.factory.userSalt.toLowerCase());
      if (!witnessed) checks.push("deployment-receipt");
    } catch (error) { checks.push(`rpc:${error.message}`); }
    return checks.length ? { nodeId: settlement.nodeId, path: relative(workspace, path), checks } : null;
  }
  let cursor = 0;
  const observed = (await Promise.all(Array.from({ length: Math.min(2, bindings.length) }, async () => {
    const results = [];
    while (cursor < bindings.length) { const index = cursor; cursor += 1; results.push(await verifyBinding(bindings[index])); }
    return results;
  }))).flat();
  failures.push(...observed.filter(Boolean));
  const verified = bindings.length - observed.filter(Boolean).length;
  return { profile: "org.emsenn.evm.sovereign-enterprise-account.v3", chain: `eip155:${chainId}`, counts: { settlements: selectedSettlements.length, bindings: bindings.length, verified, failures: failures.length }, failures };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await verifyLiveEnterpriseAccounts({ workspace: resolve(option("--workspace", DEFAULT_WORKSPACE)), rpcUrl: option("--rpc-url"), deploymentPath: resolve(option("--deployment", DEFAULT_DEPLOYMENT)), nodeId: option("--node-id") });
  process.stdout.write(`${JSON.stringify(process.argv.includes("--summary") ? { profile: report.profile, chain: report.chain, counts: report.counts } : report, null, 2)}\n`);
  if (process.argv.includes("--enforce") && report.failures.length) process.exitCode = 1;
}

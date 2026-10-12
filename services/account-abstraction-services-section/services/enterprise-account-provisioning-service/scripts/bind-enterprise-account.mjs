#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Interface, JsonRpcProvider, keccak256, toUtf8Bytes } from "ethers";
import { createEnterpriseAccountBinding } from "../src/account-binding.mjs";

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_WORKSPACE = resolve(HERE, "../../../../../../../../../../../../../..");
const PROFILE = "org.emsenn.evm.sovereign-enterprise-account.v3";

function option(name) { const at = process.argv.indexOf(name); return at === -1 ? undefined : process.argv[at + 1]; }
function required(name) { const value = option(name); if (!value) throw new Error(`${name} is required`); return value; }
function hashHex(value) { return keccak256(toUtf8Bytes(value)).toLowerCase(); }
function selector(signature) { return new Interface([`function ${signature}`]).getFunction(signature).selector.slice(2).toLowerCase(); }
function address(value, label) {
  if (!/^0x[0-9a-fA-F]{40}$/u.test(value ?? "")) throw new Error(`${label} must be one EVM address`);
  return value.toLowerCase();
}
function bytes32(value, label) {
  if (!/^0x[0-9a-fA-F]{64}$/u.test(value ?? "")) throw new Error(`${label} must be bytes32`);
  return value.toLowerCase();
}
function wordAddress(value) { return `${"0".repeat(24)}${value.slice(2)}`; }

const rpcUrl = required("--rpc-url");
const provider = new JsonRpcProvider(rpcUrl, undefined, { batchMaxCount: 1 });
async function rpc(method, params = []) { return provider.send(method, params); }
async function ethCall(to, data) { return provider.call({ to, data }); }

const workspace = resolve(option("--workspace") ?? DEFAULT_WORKSPACE);
const suppliedSettlement = required("--settlement");
const settlement = resolve(isAbsolute(suppliedSettlement) ? suppliedSettlement : join(workspace, suppliedSettlement));
if (settlement !== workspace && !settlement.startsWith(`${workspace}${sep}`)) throw new Error("settlement must be inside the supplied workspace");
const manifestPath = join(settlement, "package.json");
if (!existsSync(manifestPath)) throw new Error("settlement package.json is absent");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const nodeId = manifest["x-agentic-metro-enterprise"]?.["node-id"];
if (!nodeId) throw new Error("settlement does not declare x-agentic-metro-enterprise.node-id");

const urn = required("--urn");
if (!urn.startsWith("urn:")) throw new Error("--urn must be a stable URN");
const enterpriseId = hashHex(urn);
const accountAddress = address(required("--account"), "--account");
const factoryAddress = address(required("--factory"), "--factory");
const policySigner = address(required("--policy-signer"), "--policy-signer");
const policyCustody = option("--policy-custody") ?? "settlement-private";
if (!["settlement-private", "remote-cloud-kms-hsm"].includes(policyCustody)) throw new Error("--policy-custody is unsupported");
const policyKeyVersion = option("--policy-key-version");
if (policyCustody === "remote-cloud-kms-hsm" && !policyKeyVersion) throw new Error("remote Cloud KMS policy custody requires --policy-key-version");
if (policyCustody === "settlement-private" && policyKeyVersion) throw new Error("local settlement custody cannot name a Cloud KMS key version");
const userSalt = bytes32(required("--salt"), "--salt");
const transactionHash = bytes32(required("--transaction"), "--transaction");

const chainId = Number(BigInt(await rpc("eth_chainId")));
if (!Number.isSafeInteger(chainId) || chainId < 1) throw new Error("target chain id exceeds the binding carrier");
for (const [label, target] of [["account", accountAddress], ["factory", factoryAddress]]) {
  if (await rpc("eth_getCode", [target, "latest"]) === "0x") throw new Error(`${label} has no code on eip155:${chainId}`);
}

const observedEnterpriseId = await ethCall(accountAddress, `0x${selector("enterpriseId()")}`);
if (observedEnterpriseId.toLowerCase() !== enterpriseId) throw new Error("account enterpriseId does not bind the supplied URN");
const observedPolicySigner = `0x${(await ethCall(accountAddress, `0x${selector("policySigner()")}`)).slice(-40)}`.toLowerCase();
if (observedPolicySigner !== policySigner) throw new Error("account policy signer does not match the settlement claim");

const erc1155Interface = `0x${(
  Number.parseInt(selector("onERC1155Received(address,address,uint256,uint256,bytes)"), 16)
  ^ Number.parseInt(selector("onERC1155BatchReceived(address,address,uint256[],uint256[],bytes)"), 16)
).toString(16).padStart(8, "0")}`;
for (const interfaceId of ["0x01ffc9a7", "0x1626ba7e", `0x${selector("eip712Domain()")}`, "0x150b7a02", erc1155Interface]) {
  const supported = await ethCall(accountAddress, `0x${selector("supportsInterface(bytes4)")}${interfaceId.slice(2)}${"0".repeat(56)}`);
  if (BigInt(supported) !== 1n) throw new Error(`account does not publish interface ${interfaceId}`);
}

const predicted = await ethCall(factoryAddress, `0x${selector("accountAddress(bytes32,address,bytes32)")}${enterpriseId.slice(2)}${wordAddress(policySigner)}${userSalt.slice(2)}`);
if (`0x${predicted.slice(-40)}`.toLowerCase() !== accountAddress) throw new Error("factory CREATE2 prediction does not match the account");

const receipt = await rpc("eth_getTransactionReceipt", [transactionHash]);
if (!receipt || BigInt(receipt.status) !== 1n) throw new Error("account deployment transaction is absent or failed");
const deploymentEvent = hashHex("EnterpriseAccountDeployed(bytes32,address,address,bytes32)");
const witnessed = receipt.logs.some((log) =>
  log.address.toLowerCase() === factoryAddress
  && log.topics?.[0]?.toLowerCase() === deploymentEvent
  && log.topics?.[1]?.toLowerCase() === enterpriseId
  && `0x${log.topics?.[2]?.slice(-40)}`.toLowerCase() === accountAddress
  && `0x${log.topics?.[3]?.slice(-40)}`.toLowerCase() === policySigner
  && log.data?.toLowerCase() === userSalt
);
if (!witnessed) throw new Error("factory deployment receipt does not witness this enterprise account");

const binding = createEnterpriseAccountBinding({
  nodeId,
  urn,
  chainId,
  account: accountAddress,
  factory: factoryAddress,
  policySigner,
  policyCustody,
  policyKeyVersion,
  userSalt,
  transaction: transactionHash,
  block: Number(BigInt(receipt.blockNumber)),
});

const bindingPath = join(settlement, "content", "evm", "accounts", `eip155-${chainId}.json`);
if (existsSync(bindingPath)) throw new Error(`binding already exists: ${bindingPath}`);
mkdirSync(dirname(bindingPath), { recursive: true });
writeFileSync(bindingPath, `${JSON.stringify(binding, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
process.stdout.write(`${JSON.stringify({ type: "EnterpriseAccountBound", settlement: relative(workspace, settlement), binding: relative(workspace, bindingPath), account: binding.account }, null, 2)}\n`);

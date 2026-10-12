#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getCreate2Address, keccak256 } from "viem";

// This Blockchain Services actuator induces the EVM face required by the
// Semiotic Exchange Chain specification and emits its observed chain receipt.
const ETHEREUM_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY_POINT = {
  standard: "org.ethereum.erc-4337.entry-point.v0.8",
  target: "node_modules/@account-abstraction/contracts/core/EntryPoint.sol:EntryPoint"
};
const CANONICAL_ENTRY_POINT = "0x4337084d9e255ff0702461cf8895ce9e3b5ff108";
const DETERMINISTIC_DEPLOYER = "0x4e59b44847b379578588920ca78fbf26c0b4956c";
const DETERMINISTIC_DEPLOYER_SIGNER = "0x3fab184622dc19b6109349b94811493bf2a45362";
const DETERMINISTIC_DEPLOYER_FEE = "0x2386f26fc10000";
const DETERMINISTIC_DEPLOYER_TRANSACTION = "0xf8a58085174876e800830186a08080b853604580600e600039806000f350fe7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf31ba02222222222222222222222222222222222222222222222222222222222222222a02222222222222222222222222222222222222222222222222222222222222222";
const ENTRY_POINT_SALT = "0x0a59dbff790c23c976a548690c27297883cc66b4c67024f9117b0238995e35e9";
const TARGETS = [
  { standard: "org.emsenn.semiotic-exchange-chain.v1", role: "modeled-union-dimension-exchange", target: "services/semiotic-exchange-chain-services-section/lib/legacy/SemioticExchange.sol:SemioticExchange" },
  { standard: "org.emsenn.evm.sovereign-enterprise-account.v3", role: "sovereign-settlement-account-factory", target: "src/EnterpriseAccount.sol:EnterpriseAccountFactory", needsEntryPoint: true },
  { standard: "org.emsenn.chu.four.strict-square.v1", role: "four-admission-verifier", target: "src/CommittedChuSquareVerifier.sol:CommittedChuSquareVerifier" },
  { standard: "org.emsenn.four.lax-mix-consensus-admission.v2", role: "four-consensus-admission", target: "src/FourMixConsensusProfile.sol:FourMixConsensusProfile" },
  { standard: "org.emsenn.evm.typed-commitment-projection.v1", role: "typed-provenance-commitment-projection", target: "src/TypedCommitmentProjection.sol:TypedCommitmentProjection" },
  {
    standard: "org.ethereum.erc-5219.onchain-data-resource.v1",
    role: "onchain-content-resource-residence",
    target: "services/smart-contract-services-section/services/onchain-data-resource-service/src/OnchainDataResource.sol:OnchainDataResource",
    needsResourceTerms: true
  }
];

function option(name) {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
}

function parseForgeJson(output) {
  const start = output.indexOf("{");
  if (start === -1) throw new Error(`forge create returned no JSON: ${output.trim()}`);
  return JSON.parse(output.slice(start));
}

let rpcId = 0;
async function rpc(rpcUrl, method, params = []) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params })
  });
  const body = await response.json();
  if (body.error) throw new Error(`${method} refused: ${body.error.message}`);
  return body.result;
}

async function waitForReceipt(rpcUrl, transactionHash) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const receipt = await rpc(rpcUrl, "eth_getTransactionReceipt", [transactionHash]);
    if (receipt) {
      if (BigInt(receipt.status) !== 1n) throw new Error(`transaction failed: ${transactionHash}`);
      return receipt;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`transaction receipt timed out: ${transactionHash}`);
}

const rpcUrl = option("--rpc-url");
if (!rpcUrl) throw new Error("--rpc-url is required");
const expectedChainId = option("--expected-chain-id");
if (!/^eip155:[1-9][0-9]*$/u.test(expectedChainId ?? "")) {
  throw new Error("--expected-chain-id must be one non-zero CAIP-2 EVM chain identity, for example eip155:<chain-id>");
}
const resourceWritePrice = option("--resource-write-price");
const resourceFeeRecipient = option("--resource-fee-recipient");
if ((resourceWritePrice === undefined) !== (resourceFeeRecipient === undefined)) {
  throw new Error("--resource-write-price and --resource-fee-recipient must be supplied together");
}
if (resourceWritePrice !== undefined && !/^0$|^[1-9][0-9]*$/u.test(resourceWritePrice)) {
  throw new Error("--resource-write-price must be a non-negative integer amount of wei");
}
if (resourceFeeRecipient !== undefined && !/^0x[0-9a-fA-F]{40}$/u.test(resourceFeeRecipient)) {
  throw new Error("--resource-fee-recipient must be one EVM address");
}
const unlockedFrom = option("--unlocked-from");
const account = option("--account");
const privateKey = process.env.UNION_EVM_DEPLOYER_PRIVATE_KEY;
const selected = [Boolean(unlockedFrom), Boolean(account), Boolean(privateKey)].filter(Boolean).length;
if (selected !== 1) throw new Error("select exactly one of --unlocked-from, --account, or UNION_EVM_DEPLOYER_PRIVATE_KEY");

let authorization;
if (unlockedFrom) authorization = ["--unlocked", "--from", unlockedFrom];
else if (account) authorization = ["--account", account];
else authorization = ["--private-key", privateKey];

async function deploy({ standard, role, target }, constructorArgs = []) {
  const result = spawnSync("forge", [
    "create", target,
    "--broadcast",
    "--json",
    "--rpc-url", rpcUrl,
    ...authorization,
    ...(constructorArgs.length ? ["--constructor-args", ...constructorArgs] : [])
  ], { cwd: ETHEREUM_ROOT, encoding: "utf8", env: process.env });
  if (result.status !== 0) {
    throw new Error(`deployment of ${standard} failed: ${(result.stderr || result.stdout).trim()}`);
  }
  const receipt = parseForgeJson(result.stdout);
  if (!/^0x[0-9a-fA-F]{64}$/u.test(receipt.transactionHash ?? "")) {
    throw new Error(`deployment of ${standard} returned no transaction hash`);
  }
  const mined = await waitForReceipt(rpcUrl, receipt.transactionHash);
  const deployedAddress = receipt.deployedTo ?? mined.contractAddress;
  if (!/^0x[0-9a-fA-F]{40}$/u.test(deployedAddress ?? "")) {
    throw new Error(`deployment of ${standard} returned no contract address`);
  }
  if (await rpc(rpcUrl, "eth_getCode", [deployedAddress, "latest"]) === "0x") {
    throw new Error(`deployment of ${standard} was mined without contract code`);
  }
  return {
    standard,
    role,
    contract: target,
    deployer: receipt.deployer,
    address: deployedAddress,
    transactionHash: receipt.transactionHash
  };
}

async function deployCanonicalEntryPoint() {
  const artifact = JSON.parse(readFileSync(resolve(ETHEREUM_ROOT, "node_modules/@account-abstraction/contracts/artifacts/EntryPoint.json"), "utf8"));
  const predicted = getCreate2Address({
    from: DETERMINISTIC_DEPLOYER,
    salt: ENTRY_POINT_SALT,
    bytecodeHash: keccak256(artifact.bytecode)
  }).toLowerCase();
  if (predicted !== CANONICAL_ENTRY_POINT) throw new Error(`installed EntryPoint artifact derives noncanonical address ${predicted}`);

  if (await rpc(rpcUrl, "eth_getCode", [DETERMINISTIC_DEPLOYER, "latest"]) === "0x") {
    const funding = spawnSync("cast", [
      "send", DETERMINISTIC_DEPLOYER_SIGNER,
      "--value", DETERMINISTIC_DEPLOYER_FEE,
      "--rpc-url", rpcUrl,
      ...authorization,
      "--json"
    ], { cwd: ETHEREUM_ROOT, encoding: "utf8", env: process.env });
    if (funding.status !== 0) throw new Error(`deterministic deployer funding failed: ${(funding.stderr || funding.stdout).trim()}`);
    const fundingReceipt = JSON.parse(funding.stdout);
    if (BigInt(fundingReceipt.status) !== 1n) throw new Error("deterministic deployer funding reverted");
    await waitForReceipt(rpcUrl, await rpc(rpcUrl, "eth_sendRawTransaction", [DETERMINISTIC_DEPLOYER_TRANSACTION]));
  }

  let transactionHash = null;
  if (await rpc(rpcUrl, "eth_getCode", [CANONICAL_ENTRY_POINT, "latest"]) === "0x") {
    const deployment = spawnSync("cast", [
      "send", DETERMINISTIC_DEPLOYER,
      "--data", `${ENTRY_POINT_SALT}${artifact.bytecode.slice(2)}`,
      "--gas-limit", "6000000",
      "--rpc-url", rpcUrl,
      ...authorization,
      "--json"
    ], { cwd: ETHEREUM_ROOT, encoding: "utf8", env: process.env, maxBuffer: 32 * 1024 * 1024 });
    if (deployment.status !== 0) throw new Error(`canonical EntryPoint deployment failed: ${(deployment.stderr || deployment.stdout).trim()}`);
    const receipt = JSON.parse(deployment.stdout);
    if (BigInt(receipt.status) !== 1n) throw new Error("canonical EntryPoint deployment reverted");
    transactionHash = receipt.transactionHash;
  }
  if (await rpc(rpcUrl, "eth_getCode", [CANONICAL_ENTRY_POINT, "latest"]) === "0x") throw new Error("canonical EntryPoint has no code after deployment");
  return {
    standard: ENTRY_POINT.standard,
    contract: ENTRY_POINT.target,
    deployer: DETERMINISTIC_DEPLOYER,
    address: CANONICAL_ENTRY_POINT,
    transactionHash
  };
}

const deployments = [];
const chainResponse = await (await fetch(rpcUrl, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "eth_chainId", params: [] })
})).json();
if (chainResponse.error || !chainResponse.result) throw new Error(`unable to resolve target chain: ${chainResponse.error?.message ?? "missing result"}`);
const chainId = `eip155:${BigInt(chainResponse.result)}`;
if (chainId !== expectedChainId) throw new Error(`target chain identity mismatch: expected ${expectedChainId}, observed ${chainId}`);

const entryPoint = await deployCanonicalEntryPoint();
deployments.push({ ...entryPoint, role: "account-abstraction-entry-point" });
for (const target of TARGETS) {
  if (target.needsResourceTerms && resourceWritePrice === undefined) {
    throw new Error("ERC-5219 resource deployment requires --resource-write-price and --resource-fee-recipient; its economics must be explicit");
  }
  const constructorArgs = target.needsEntryPoint
    ? [entryPoint.address]
    : target.needsResourceTerms
      ? [resourceWritePrice, resourceFeeRecipient]
      : [];
  deployments.push(await deploy(target, constructorArgs));
}

process.stdout.write(`${JSON.stringify({
  type: "SemioticEvmFaceInduction",
  chainId,
  resourceTerms: { writePriceWei: resourceWritePrice, feeRecipient: resourceFeeRecipient },
  deployments
}, null, 2)}\n`);

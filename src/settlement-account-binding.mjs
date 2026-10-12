import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { Interface, id as keccakText } from "ethers";

const PROFILE = "org.emsenn.evm.sovereign-enterprise-account.v3";
const DEPLOYED_EVENT = "EnterpriseAccountDeployed(bytes32,address,address,bytes32)";
const FACTORY = new Interface([
  "event EnterpriseAccountDeployed(bytes32 indexed enterpriseId, address indexed account, address indexed policySigner, bytes32 userSalt)",
  "function accountAddress(bytes32 enterpriseId, address policySigner, bytes32 userSalt) view returns (address)",
]);

export function settlementIdentity(settlementRoot) {
  const root = resolve(settlementRoot);
  const nodeId = basename(root);
  if (!nodeId || nodeId === "/" || nodeId === ".") throw new Error(`settlement root ${settlementRoot} does not name an owning directory`);
  return Object.freeze({ nodeId, urn: `urn:ame:${nodeId}` });
}
function deploymentRegistry(caip2, suppliedPath) {
  const path = suppliedPath ?? process.env.EVM_DEPLOYMENT_REGISTRY ?? process.env.EVM_DEPLOYMENT_MANIFEST;
  if (!path || !existsSync(path)) throw new Error(`EVM_DEPLOYMENT_REGISTRY must name the on-chain standards registry for ${caip2}`);
  const registry = JSON.parse(readFileSync(path, "utf8"));
  if ((registry.chainId ?? registry.chain?.caip2) !== caip2) throw new Error(`deployment registry at ${path} belongs to a different chain than ${caip2}`);
  return registry;
}

function factoryAddress(registry, caip2) {
  const deployments = registry.deployments ?? registry.contracts ?? [];
  const entry = Array.isArray(deployments)
    ? deployments.find((value) => value.standard === PROFILE)
    : deployments[PROFILE];
  if (!entry?.address) throw new Error(`${caip2} deployment registry does not name the ${PROFILE} factory`);
  return String(entry.address).toLowerCase();
}

function binding({ nodeId, urn, liveChainId, caip2, factory, enterpriseId, address, policySigner, userSalt, transaction, block }) {
  return Object.freeze({
    nodeId,
    actor: urn,
    settlement: `${caip2}:${address}`,
    caip2,
    address,
    binding: Object.freeze({
      profile: PROFILE,
      enterprise: Object.freeze({ nodeId, urn, enterpriseId }),
      chain: Object.freeze({ chainId: liveChainId, caip2 }),
      account: Object.freeze({ address, caip10: `${caip2}:${address}` }),
      factory: Object.freeze({ address: factory, userSalt }),
      policy: Object.freeze({ signer: policySigner, custody: "settlement-private" }),
      deployment: Object.freeze({ transaction, block }),
    }),
  });
}

async function jsonRpc(url, method, params, request) {
  const response = await request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  if (!response.ok) throw new Error(`EVM_RPC_URL ${method} refused with HTTP ${response.status}`);
  const payload = await response.json();
  if (payload?.error) throw new Error(`EVM_RPC_URL ${method} refused: ${payload.error.message ?? JSON.stringify(payload.error)}`);
  if (!Object.hasOwn(payload ?? {}, "result")) throw new Error(`EVM_RPC_URL ${method} returned no result`);
  return payload.result;
}

export async function resolveSettlementAccount(settlementRoot, {
  caip2,
  rpcUrl = process.env.EVM_RPC_URL,
  request = fetch,
  deploymentRegistry: registryPath,
} = {}) {
  const identity = settlementIdentity(settlementRoot);
  if (!rpcUrl) throw new Error("EVM_RPC_URL must name the settlement chain's live JSON-RPC endpoint");
  const rpc = (method, params) => jsonRpc(rpcUrl, method, params, request);
  const liveChainId = Number(BigInt(await rpc("eth_chainId", [])));
  const liveCaip2 = `eip155:${liveChainId}`;
  if (!Number.isSafeInteger(liveChainId) || liveChainId < 1) throw new Error("EVM_RPC_URL reported an invalid chain id");
  if (caip2 !== undefined && caip2 !== liveCaip2) throw new Error(`requested chain ${caip2} does not match live chain ${liveCaip2}`);
  const registry = deploymentRegistry(liveCaip2, registryPath);
  const factory = factoryAddress(registry, liveCaip2);
  const enterpriseId = keccakText(identity.urn).toLowerCase();
  const event = FACTORY.getEvent("EnterpriseAccountDeployed");
  const logs = await rpc("eth_getLogs", [{ address: factory, fromBlock: "0x0", toBlock: "latest", topics: [event.topicHash, enterpriseId] }]);
  if (!Array.isArray(logs) || logs.length === 0) throw new Error(`no ${PROFILE} account is deployed for ${identity.nodeId}`);
  const deployed = logs.at(-1);
  const parsed = FACTORY.parseLog(deployed);
  const address = String(parsed.args.account).toLowerCase();
  const policySigner = String(parsed.args.policySigner).toLowerCase();
  const userSalt = String(parsed.args.userSalt).toLowerCase();
  if (await rpc("eth_getCode", [address, "latest"]) === "0x") throw new Error(`enterprise account ${address} has no live code`);
  const call = FACTORY.encodeFunctionData("accountAddress", [enterpriseId, policySigner, userSalt]);
  const [predictedValue] = FACTORY.decodeFunctionResult("accountAddress", await rpc("eth_call", [{ to: factory, data: call }, "latest"]));
  if (String(predictedValue).toLowerCase() !== address) throw new Error("factory prediction does not match deployed account");
  return binding({ ...identity, liveChainId, caip2: liveCaip2, factory, enterpriseId, address, policySigner, userSalt, transaction: deployed.transactionHash, block: Number(BigInt(deployed.blockNumber)) });
}

function cast(args) {
  const result = spawnSync("cast", args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`cast ${args[0]} refused: ${(result.stderr || result.stdout || "").trim()}`);
  return result.stdout.trim();
}

/**
 * Defer one live settlement-account resolution until a caller actually enters
 * a settlement path. Pure provider configuration and capacity helpers can be
 * imported without chain credentials; the first settlement use retains the
 * same synchronous validation as loadSettlementAccount.
 */
export function lazySettlementAccount(settlementRoot, options = {}) {
  let account;
  return () => account ??= loadSettlementAccount(settlementRoot, {
    ...options,
    caip2: options.caip2 ?? process.env.SETTLEMENT_CAIP2,
  });
}

export function loadSettlementAccount(settlementRoot, { caip2, deploymentRegistry: registryPath } = {}) {
  const identity = settlementIdentity(settlementRoot);
  const rpcUrl = process.env.EVM_RPC_URL;
  if (!rpcUrl) throw new Error("EVM_RPC_URL must name the settlement chain's live JSON-RPC endpoint");
  const liveChainId = Number(cast(["chain-id", "--rpc-url", rpcUrl]));
  const liveCaip2 = `eip155:${liveChainId}`;
  if (!Number.isSafeInteger(liveChainId) || liveChainId < 1) throw new Error("EVM_RPC_URL reported an invalid chain id");
  if (caip2 !== undefined && caip2 !== liveCaip2) throw new Error(`requested chain ${caip2} does not match live chain ${liveCaip2}`);
  const registry = deploymentRegistry(liveCaip2, registryPath);
  const factory = factoryAddress(registry, liveCaip2);
  const enterpriseId = cast(["keccak", identity.urn]).toLowerCase();
  const raw = cast(["logs", "--rpc-url", rpcUrl, "--address", factory, "--from-block", "earliest", "--to-block", "latest", "--json", DEPLOYED_EVENT, enterpriseId]);
  const logs = raw ? JSON.parse(raw) : [];
  if (logs.length === 0) throw new Error(`no ${PROFILE} account is deployed for ${identity.nodeId}`);
  const deployed = logs.at(-1);
  const address = `0x${deployed.topics[2].slice(-40)}`.toLowerCase();
  const policySigner = `0x${deployed.topics[3].slice(-40)}`.toLowerCase();
  const userSalt = deployed.data.toLowerCase();
  if (cast(["code", "--rpc-url", rpcUrl, address]) === "0x") throw new Error(`enterprise account ${address} has no live code`);
  const predicted = cast(["call", "--rpc-url", rpcUrl, factory, "accountAddress(bytes32,address,bytes32)(address)", enterpriseId, policySigner, userSalt]).toLowerCase();
  if (predicted !== address) throw new Error("factory prediction does not match deployed account");
  return binding({ ...identity, liveChainId, caip2: liveCaip2, factory, enterpriseId, address, policySigner, userSalt, transaction: deployed.transactionHash, block: Number(deployed.blockNumber) });
}

export const SETTLEMENT_ACCOUNT_PROFILE = PROFILE;

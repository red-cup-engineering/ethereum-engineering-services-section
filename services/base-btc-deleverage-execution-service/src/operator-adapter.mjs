import { Contract, JsonRpcProvider, Wallet, getAddress } from "ethers";
import { dirname, basename, join } from "node:path";
import { createRequire } from "node:module";
import { spawn as spawnProcess } from "node:child_process";
import { createServer } from "node:net";

const ERC20 = ["function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)"];
const REWARD = ["function balanceOf(address) view returns (uint256)"];
const MARKET = ["function borrowBalanceCurrent(address) returns (uint256)"];
const HELPER = ["function source() view returns (address)", "function recipient() view returns (address)", "function factory() view returns (address)", "function pool() view returns (address)", "function tbtc() view returns (address)", "function cbbtc() view returns (address)", "function stable() view returns (bool)", "function used() view returns (bool)", "function lpAmount() view returns (uint256)", "function looseTbtc() view returns (uint256)", "function looseCbbtc() view returns (uint256)", "function minBurn0() view returns (uint256)", "function minBurn1() view returns (uint256)", "function minRepay() view returns (uint256)", "function maxRepay() view returns (uint256)", "function deadline() view returns (uint256)", "function factoryCodeHash() view returns (bytes32)", "function poolCodeHash() view returns (bytes32)", "function token0CodeHash() view returns (bytes32)", "function token1CodeHash() view returns (bytes32)"];
const GAS_ORACLE = "0x420000000000000000000000000000000000000F";
const GAS = ["function getL1Fee(bytes) view returns (uint256)"];
const required = (value, name) => { if (typeof value !== "string" || !value) throw new Error(`operator adapter requires environment variable ${name}`); return value; };
const name = (value, field) => { if (typeof value !== "string" || !/^[A-Z][A-Z0-9_]*$/u.test(value)) throw new Error(`${field} must be an environment variable name`); return value; };
const signerFromSecret = (secret) => /^0x[0-9a-fA-F]{64}$/u.test(secret) ? new Wallet(secret) : Wallet.fromPhrase(secret);
const require = createRequire(import.meta.url);
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function ephemeralPort() { const server=createServer(); await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);}); const address=server.address(); await new Promise((resolve,reject)=>server.close((error)=>error?reject(error):resolve())); if (!address || typeof address === "string") throw new Error("unable to reserve Anvil port"); return address.port; }
async function awaitAnchor(provider, card, timeoutMs) { const deadline=Date.now()+timeoutMs; let lastError; while(Date.now()<deadline){try{const network=await provider.getNetwork();const block=await provider.getBlock(Number(card.anchor.blockNumber));if(BigInt(network.chainId)!==BigInt(card.chainId))throw new Error("Anvil chain differs from card");if(block?.hash?.toLowerCase()!==card.anchor.blockHash.toLowerCase())throw new Error("Anvil anchor block differs from card");const snapshot=await provider.send("evm_snapshot",[]);if(await provider.send("evm_revert",[snapshot])!==true)throw new Error("Anvil snapshot/revert unavailable");return;}catch(error){lastError=error;await delay(50);}}throw new Error(`anchored Anvil did not become ready: ${lastError?.message ?? "timeout"}`); }

/** Launch an isolated, anchored Anvil fork and return only after its chain and anchor attest. */
export async function launchAnchoredAnvil({ card, forkUrl, timeoutMs = 10_000, spawn = spawnProcess, providerFactory = (url) => new JsonRpcProvider(url), port = ephemeralPort() } = {}) {
  if (!card?.anchor?.blockNumber || !card?.anchor?.blockHash || !card?.chainId) throw new Error("anchored Anvil requires card chain and anchor"); if (typeof forkUrl !== "string" || !forkUrl) throw new Error("anchored Anvil requires a public fork URL");
  const localPort=await port; const binary=require.resolve("@foundry-rs/anvil/bin.mjs"); const child=spawn(process.execPath,[binary,"--silent","--host","127.0.0.1","--port",String(localPort),"--fork-url",forkUrl,"--fork-block-number",String(card.anchor.blockNumber)],{stdio:"ignore"}); const provider=providerFactory(`http://127.0.0.1:${localPort}`);
  try { await awaitAnchor(provider,card,timeoutMs); } catch (error) { child.kill("SIGTERM"); provider.destroy?.(); throw error; }
  return { provider, async cleanup(){ provider.destroy?.(); if (!child.killed) child.kill("SIGTERM"); }, localUrl:`http://127.0.0.1:${localPort}` };
}

/** Read dotenv syntax without changing process.env or writing the file. */
export async function readDotEnv(path, readFile) {
  const text = await readFile(path, "utf8"); const entries = {};
  for (const line of text.split(/\r?\n/u)) { const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/u); if (!match || match[1].startsWith("#")) continue; const raw = match[2]; entries[match[1]] = (/^(['"]).*\1$/u.test(raw) ? raw.slice(1, -1) : raw).replace(/\s+#.*$/u, ""); }
  return entries;
}

export function resolveNamedEnvironment(names, environment = process.env, dotenv = {}) {
  return Object.fromEntries(Object.entries(names).map(([key, variable]) => { const envName = name(variable, `envNames.${key}`); return [key, required(environment[envName] ?? dotenv[envName], envName)]; }));
}

export function createAnvilForkBoundary(provider) {
  return { kind: "anvil-fork", isolated: true, snapshot: () => provider.send("evm_snapshot", []), revert: (snapshot) => provider.send("evm_revert", [snapshot]) };
}

export function authorizationConsumedPath(authorizationPath, authorizationId) {
  if (typeof authorizationId !== "string" || !/^[A-Za-z0-9._-]+$/u.test(authorizationId)) throw new Error("authorizationId cannot form a consumed filename");
  return join(dirname(authorizationPath), `${basename(authorizationPath)}.${authorizationId}.consumed`);
}

/** Atomically move the exact authorization carrier out of its usable path. */
export function createFileAuthorizationConsumer({ authorizationPath, authorization, stat, rename }) {
  const consumedPath = authorizationConsumedPath(authorizationPath, authorization?.authorizationId);
  return async ({ card, authorization: invoked }) => {
    if (invoked !== authorization || !card?.actionId || authorization.actionId !== card.actionId) throw new Error("authorization consumer received an unbound action");
    try { await stat(consumedPath); throw new Error("authorization consumed carrier already exists"); } catch (error) { if (error?.code !== "ENOENT") throw error; }
    await rename(authorizationPath, consumedPath);
    return true;
  };
}

/** Confirm the exact atomically consumed carrier before resuming after deployment. */
export function createFileConsumedAuthorizationConfirmer({ consumedPath, authorization, readFile }) {
  return async ({ card, authorization: invoked }) => {
    if (invoked !== authorization || authorization.actionId !== card?.actionId) throw new Error("consumed authorization confirmer received an unbound action");
    const retained = JSON.parse(await readFile(consumedPath, "utf8"));
    for (const key of ["authorizationId", "actionId", "cardHash", "initCodeHash", "deploymentAddress"]) if (retained?.[key] !== authorization[key]) throw new Error(`consumed authorization differs: ${key}`);
    return true;
  };
}

export function createOperatorAdapter({ envNames, environment = process.env, dotenv = {}, provider, consumeAuthorization, confirmConsumedAuthorization } = {}) {
  const values = resolveNamedEnvironment(envNames, environment, dotenv);
  const rpc = provider ?? new JsonRpcProvider(values.rpcUrl, 8453, { batchMaxCount: 1 });
  const source = signerFromSecret(values.sourceSigner).connect(rpc); const target = signerFromSecret(values.targetSigner).connect(rpc);
  const signers = { source, target };
  const contract = (address, abi) => new Contract(getAddress(address), abi, rpc);
  const positions = async ({ card }) => {
    const c = card.contracts, sourceAddress = card.source, targetAddress = card.target;
    const [rewardShares, vaultShares, lp, tbtc, sourceCbBtc, targetCbBtc, targetCbBtcAllowance, debt, helperLp, helperTbtc] = await Promise.all([
      contract(c.rewardPool, REWARD).balanceOf(sourceAddress), contract(c.vault, REWARD).balanceOf(sourceAddress), contract(c.lp, ERC20).balanceOf(sourceAddress), contract(c.tbtc, ERC20).balanceOf(sourceAddress), contract(c.cbbtc, ERC20).balanceOf(sourceAddress), contract(c.cbbtc, ERC20).balanceOf(targetAddress), contract(c.cbbtc, ERC20).allowance(targetAddress, c.moonwellMarket), contract(c.moonwellMarket, MARKET).borrowBalanceCurrent.staticCall(targetAddress), contract(c.lp, ERC20).balanceOf(c.helper), contract(c.tbtc, ERC20).balanceOf(c.helper)
    ]);
    return { rewardShares, vaultShares, lp, tbtc, sourceCbBtc, targetCbBtc, targetCbBtcAllowance, debt, helperLp, helperTbtc };
  };
  const borrowBalanceCurrent = async ({ card, target: account = card.target }) => contract(card.contracts.moonwellMarket, MARKET).borrowBalanceCurrent.staticCall(account);
  const runtimeForInitCode = async ({ card, initCode }) => {
    if (typeof initCode !== "string" || !/^0x[0-9a-fA-F]*$/u.test(initCode)) throw new Error("initCode must be exact hex");
    const blockTag = `0x${BigInt(card.anchor.blockNumber).toString(16)}`;
    const runtime = await rpc.send("eth_call", [{ from: getAddress(card.source), data: initCode }, blockTag]);
    if (typeof runtime !== "string" || !/^0x[0-9a-fA-F]*$/u.test(runtime)) throw new Error("init-code runtime call returned non-hex bytes");
    return runtime;
  };
  const helperBindings = async ({ card }) => {
    const h = contract(card.contracts.helper, HELPER); const keys = ["source", "recipient", "factory", "pool", "tbtc", "cbbtc", "stable", "used", "lpAmount", "looseTbtc", "looseCbbtc", "minBurn0", "minBurn1", "minRepay", "maxRepay", "deadline", "factoryCodeHash", "poolCodeHash", "token0CodeHash", "token1CodeHash"];
    return Object.fromEntries(await Promise.all(keys.map(async (key) => [key, await h[key]()] )));
  };
  const estimateL1Fee = async ({ transaction }) => {
    const signer = getAddress(transaction.from) === getAddress(await source.getAddress()) ? source : getAddress(transaction.from) === getAddress(await target.getAddress()) ? target : undefined;
    if (!signer) throw new Error("operator adapter cannot select signer for L1 fee estimate");
    const { from, ...unsigned } = transaction; const network = await rpc.getNetwork();
    const serialized = await signer.signTransaction({ ...unsigned, chainId: unsigned.chainId ?? network.chainId, nonce: unsigned.nonce ?? await rpc.getTransactionCount(await signer.getAddress()) });
    return contract(GAS_ORACLE, GAS).getL1Fee(serialized);
  };
  const boundaries = { provider: rpc, signers, readState: { positions, helperBindings, borrowBalanceCurrent, runtimeForInitCode }, estimateL1Fee, consumeAuthorization: consumeAuthorization ?? (async () => false), confirmConsumedAuthorization: confirmConsumedAuthorization ?? (async () => false) };
  return { ...boundaries, fork: { ...createAnvilForkBoundary(rpc), ...boundaries }, envNames: Object.fromEntries(Object.entries(envNames).map(([key, value]) => [key, name(value, `envNames.${key}`)])) };
}

// Restored core execution boundary.
import { AbiCoder, Interface, concat, getAddress, getCreateAddress, isAddress, keccak256, toUtf8Bytes } from "ethers";
import { loadStablePoolRecoveryExecutorArtifact } from "./stable-pool-recovery-executor-artifact.mjs";

const erc20 = new Interface(["function approve(address,uint256) returns (bool)"]);
const rewardPool = new Interface(["function withdraw(uint256)"]);
const vault = new Interface(["function withdrawAll()"]);
const helper = new Interface(["function execute()"]);
const moonwell = new Interface(["function repayBorrow(uint256) returns (uint256)"]);
const refuse = (message) => { throw new Error(`deleverage action refused: ${message}`); };
const num = (value, field) => { try { const result = BigInt(value); if (result < 0n) throw new Error(); return result; } catch { refuse(`${field} must be a non-negative integer`); } };
const addr = (value, field) => { if (typeof value !== "string" || !isAddress(value)) refuse(`${field} must be an address`); return getAddress(value); };
const same = (a, b) => addr(a, "address") === addr(b, "address");
const equal = (actual, expected, field) => { if (num(actual, field) !== num(expected, field)) refuse(`${field} differs from action card`); };
const bytes32 = (value, field) => { if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/u.test(value)) refuse(`${field} must be exact bytes32`); return value.toLowerCase(); };
const stable = (value) => value && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}` : JSON.stringify(value);

/** A signed authorization commits to every card field, including the helper's init code identity. */
export function deleverageCardHash(card) { return keccak256(toUtf8Bytes(stable(card))); }
export function decodeEip1167Implementation(runtimeCode) { const match = /^0x363d3d373d3d3d363d73([0-9a-fA-F]{40})5af43d82803e903d91602b57fd5bf3$/u.exec(runtimeCode ?? ""); return match ? getAddress(`0x${match[1]}`) : null; }

export function validateDeleverageCard(card, now = Math.floor(Date.now() / 1000)) {
  if (!card || typeof card !== "object") refuse("card is required");
  for (const key of ["actionId", "chainId", "source", "target", "anchor", "contracts", "amounts", "quote", "limits", "postconditions", "deployment"]) if (card[key] == null) refuse(`card.${key} is required`);
  if (!card.actionId) refuse("actionId is required"); addr(card.source, "source"); addr(card.target, "target");
  for (const key of ["rewardPool", "vault", "helper", "pool", "factory", "lp", "token0", "token1", "tbtc", "cbbtc", "moonwellMarket"]) addr(card.contracts[key], `contracts.${key}`);
  if (!same(card.contracts.token0, card.contracts.tbtc) || !same(card.contracts.token1, card.contracts.cbbtc)) refuse("token topology differs from tBTC/cbBTC route");
  for (const key of ["rewardPool", "vault", "moonwellMarket", "factory", "pool", "lp", "tbtc", "cbbtc", "token0", "token1"]) bytes32(card.contractCodeHashes?.[key], `contractCodeHashes.${key}`);
  for (const [key, proxy] of Object.entries(card.proxyAttestations ?? {})) { if (!card.contracts[key]) refuse(`proxy attestation has unknown endpoint: ${key}`); addr(proxy?.implementation, `proxyAttestations.${key}.implementation`); bytes32(proxy?.implementationCodeHash, `proxyAttestations.${key}.implementationCodeHash`); }
  if (!/^0x[0-9a-fA-F]{64}$/u.test(card.anchor.blockHash ?? "") || num(card.anchor.blockNumber, "anchor.blockNumber") === 0n) refuse("anchor must include block/hash");
  if (num(card.expiresAt, "expiresAt") < BigInt(now) || num(card.deadline, "deadline") > num(card.expiresAt, "expiresAt")) refuse("card is expired");
  if (num(card.quote.slippageBps, "quote.slippageBps") !== 50n) refuse("quote slippage must be 50 bps");
  for (const k of ["lpAmount", "minRepay", "maxRepay"]) if (num(card.amounts[k], `amounts.${k}`) === 0n) refuse(`amounts.${k} must be positive`);
  for (const k of ["looseTbtc", "looseCbBtc"]) num(card.amounts[k], `amounts.${k}`);
  if (num(card.amounts.minRepay, "minRepay") > num(card.amounts.maxRepay, "maxRepay")) refuse("repay range is inverted");
  for (const k of ["min0", "min1"]) if (num(card.quote[k], `quote.${k}`) === 0n) refuse(`quote.${k} must be positive`);
  for (const k of ["maxGasPerStep", "maxCumulativeGas", "maxFeePerGas", "maxPriorityFeePerGas", "maxTotalFeeWei"]) if (num(card.limits[k], `limits.${k}`) === 0n) refuse(`limits.${k} must be positive`);
  if (num(card.limits.maxPriorityFeePerGas, "maxPriorityFeePerGas") > num(card.limits.maxFeePerGas, "maxFeePerGas")) refuse("priority fee exceeds max fee");
  if (num(card.limits.gasBufferBps, "limits.gasBufferBps") < 10_000n || num(card.limits.gasBufferBps, "limits.gasBufferBps") > 20_000n) refuse("invalid gas buffer");
  if (!same(card.deployment.deployer, card.source) || !same(card.deployment.expectedAddress, card.contracts.helper)) refuse("deployment is not bound to source/helper");
  bytes32(card.deployment.initCodeHash, "deployment.initCodeHash"); bytes32(card.deployment.runtimeCodeHash, "deployment.runtimeCodeHash");
  const p = card.postconditions; for (const k of ["rewardShares", "vaultShares", "lp", "tbtc", "sourceCbBtc", "targetCbBtcAllowance", "helperLp", "helperTbtc"]) equal(p[k], 0, `postconditions.${k}`);
  if (p.targetLooseCbBtcUnchanged !== true) refuse("target loose cbBTC must be restored"); const debtBefore = num(p.debtBefore, "postconditions.debtBefore"), maxDebtBefore = num(p.maxDebtBefore, "postconditions.maxDebtBefore"), maxDebtAccrualSats = num(p.maxDebtAccrualSats, "postconditions.maxDebtAccrualSats"); if (maxDebtBefore < debtBefore || maxDebtAccrualSats > 1_000n) refuse("invalid debt accrual window");
  return card;
}

export function helperConstructorValues(card) { validateDeleverageCard(card); const c = card.contracts, a = card.amounts, h = card.contractCodeHashes; return [card.source, card.target, c.factory, c.pool, c.tbtc, c.cbbtc, Boolean(card.stable), num(a.lpAmount, "lpAmount"), num(a.looseTbtc, "looseTbtc"), num(a.looseCbBtc, "looseCbBtc"), num(card.quote.min0, "min0"), num(card.quote.min1, "min1"), num(a.minRepay, "minRepay"), num(a.maxRepay, "maxRepay"), num(card.deadline, "deadline"), h.factory, h.pool, h.token0, h.token1]; }
export async function prepareHelperDeploymentAttestation(card, provider, reader) {
  const artifact = await loadStablePoolRecoveryExecutorArtifact(); const constructor = artifact.abi.find((entry) => entry.type === "constructor");
  if (!constructor || constructor.inputs.length !== helperConstructorValues(card).length) refuse("shipped helper constructor tuple differs from card");
  const creationBytecode = artifact.bytecode.object.startsWith("0x") ? artifact.bytecode.object : `0x${artifact.bytecode.object}`;
  const initCode = concat([creationBytecode, AbiCoder.defaultAbiCoder().encode(constructor.inputs.map((input) => input.type), helperConstructorValues(card))]);
  const expectedAddress = getCreateAddress({ from: addr(card.deployment.deployer, "deployer"), nonce: Number(num(card.deployment.nonce, "deployment nonce")) });
  if (!same(expectedAddress, card.deployment.expectedAddress) || keccak256(initCode) !== bytes32(card.deployment.initCodeHash, "deployment.initCodeHash")) refuse("deployment init code differs from action card");
  if (provider && num(await provider.getTransactionCount(card.source, "pending"), "deployment nonce") !== num(card.deployment.nonce, "deployment nonce")) refuse("pending deployment nonce differs from action card");
  if (reader) { const runtime = await reader.runtimeForInitCode?.({ card, initCode }); if (!runtime || runtime === "0x" || keccak256(runtime) !== bytes32(card.deployment.runtimeCodeHash, "runtimeCodeHash")) refuse("constructor-result runtime differs from action card"); }
  return { initCode, initCodeHash: keccak256(initCode), expectedAddress, runtimeCodeHash: bytes32(card.deployment.runtimeCodeHash, "runtimeCodeHash") };
}

export function validateHumanAuthorization(card, authorization, now = Math.floor(Date.now() / 1000)) {
  validateDeleverageCard(card, now);
  if (!authorization?.oneUse || !authorization.authorizationId || authorization.actionId !== card.actionId || !same(authorization.source, card.source) || !same(authorization.target, card.target) || num(authorization.chainId, "authorization.chainId") !== num(card.chainId, "chainId")) refuse("authorization is not bound to this action");
  if (num(authorization.maxSlippageBps, "authorization.maxSlippageBps") !== 50n || num(authorization.expiresAt, "authorization.expiresAt") < BigInt(now) || num(authorization.expiresAt, "authorization.expiresAt") > num(card.expiresAt, "expiresAt") || !authorization.allowedEffects?.includes("sign") || !authorization.allowedEffects?.includes("broadcast")) refuse("authorization does not permit this execution");
  if (authorization.cardHash !== deleverageCardHash(card) || !same(authorization.deploymentAddress, card.deployment.expectedAddress) || authorization.initCodeHash?.toLowerCase() !== card.deployment.initCodeHash.toLowerCase()) refuse("authorization does not bind full card/deployment tuple");
  for (const key of Object.keys(card.contracts)) if (!same(authorization.contracts?.[key], card.contracts[key])) refuse(`authorization contract differs: ${key}`);
  return authorization;
}

export function prepareDeleverage(card) { validateDeleverageCard(card); const c = card.contracts, a = card.amounts; return [
  ...(num(a.rewardPoolWithdraw, "withdraw") === 0n ? [] : [["reward-pool-withdraw", c.rewardPool, rewardPool.encodeFunctionData("withdraw", [num(a.rewardPoolWithdraw, "withdraw")]), "source"]]), ["vault-withdraw-all", c.vault, vault.encodeFunctionData("withdrawAll"), "source"],
  ["lp-approve-helper", c.lp, erc20.encodeFunctionData("approve", [c.helper, num(a.lpAmount, "lp")]), "source"], ["tbtc-approve-helper", c.tbtc, erc20.encodeFunctionData("approve", [c.helper, num(a.looseTbtc, "looseTbtc")]), "source"], ["cbbtc-approve-helper", c.cbbtc, erc20.encodeFunctionData("approve", [c.helper, num(a.looseCbBtc, "looseCbBtc")]), "source"], ["helper-recover-and-swap-to-target", c.helper, helper.encodeFunctionData("execute"), "source"]
].map(([name, to, data, signer]) => ({ name, to, data, signer, value: 0n })); }
async function state(reader, card) { const s = await reader?.positions?.({ card }); for (const k of ["rewardShares", "vaultShares", "lp", "tbtc", "sourceCbBtc", "targetCbBtc", "targetCbBtcAllowance", "debt", "helperLp", "helperTbtc"]) num(s?.[k], `state.${k}`); return s; }
async function attestEndpoints(card, provider, names) { for (const name of names) { const endpoint = card.contracts[name]; const code = await provider.getCode(endpoint); if (!code || code === "0x" || keccak256(code) !== card.contractCodeHashes[name]) refuse(`endpoint code hash mismatch: ${name}`); const implementation = decodeEip1167Implementation(code); if (implementation) { const proxy = card.proxyAttestations?.[name]; if (!proxy || !same(proxy.implementation, implementation)) refuse(`proxy implementation differs from card: ${name}`); const implementationCode = await provider.getCode(implementation); if (!implementationCode || implementationCode === "0x" || keccak256(implementationCode) !== bytes32(proxy.implementationCodeHash, `proxyAttestations.${name}.implementationCodeHash`)) refuse(`proxy implementation code hash mismatch: ${name}`); } } }
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
export async function readLiveHelperCode(provider, helper, { attempts = 40, intervalMs = 250 } = {}) {
  let lastError;
  if (typeof provider?.send === "function") for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { const code = await provider.send("eth_getCode", [helper, "latest"]); if (typeof code === "string" && /^0x[0-9a-fA-F]*$/u.test(code) && code !== "0x") return code; } catch (error) { lastError = error; }
    if (attempt + 1 < attempts) await delay(intervalMs);
  }
  try { return await provider.getCode(helper); } catch (error) { throw lastError ?? error; }
}
async function attestHelper(card, provider, reader) {
  const code = await readLiveHelperCode(provider, card.contracts.helper); if (!code || code === "0x" || keccak256(code) !== card.deployment.runtimeCodeHash) refuse("deployed helper runtime bytes differ from attestation");
  const b = await reader?.helperBindings?.({ card }); if (!b) refuse("helper getter attestation is required");
  const expected = { source: card.source, recipient: card.target, factory: card.contracts.factory, pool: card.contracts.pool, tbtc: card.contracts.tbtc, cbbtc: card.contracts.cbbtc, stable: Boolean(card.stable), used: false, lpAmount: card.amounts.lpAmount, looseTbtc: card.amounts.looseTbtc, looseCbbtc: card.amounts.looseCbBtc, minBurn0: card.quote.min0, minBurn1: card.quote.min1, minRepay: card.amounts.minRepay, maxRepay: card.amounts.maxRepay, deadline: card.deadline, factoryCodeHash: card.contractCodeHashes.factory, poolCodeHash: card.contractCodeHashes.pool, token0CodeHash: card.contractCodeHashes.token0, token1CodeHash: card.contractCodeHashes.token1 };
  for (const [key, value] of Object.entries(expected)) { if (typeof value === "boolean" ? b[key] !== value : typeof value === "string" && isAddress(value) ? !same(b[key], value) : typeof value === "string" && /^0x[0-9a-fA-F]{64}$/u.test(value) ? bytes32(b[key], `helper.${key}`) !== value.toLowerCase() : num(b[key], `helper.${key}`) !== num(value, key)) refuse(`helper binding mismatch: ${key}`); }
  await attestEndpoints(card, provider, ["factory", "pool", "tbtc", "cbbtc"]);
}
function assertResidue(card, s, targetBefore, initialDebt, actual) { for (const k of ["rewardShares", "vaultShares", "lp", "tbtc", "sourceCbBtc", "targetCbBtcAllowance", "helperLp", "helperTbtc"]) equal(s[k], card.postconditions[k], `postcondition ${k}`); equal(s.targetCbBtc, targetBefore, "target loose cbBTC"); const lower = initialDebt - actual, upper = lower + num(card.postconditions.maxDebtAccrualSats, "maxDebtAccrualSats"), debt = num(s.debt, "debt after"); if (debt < lower || debt > upper) refuse("post-repay debt exceeds accrual window"); }
async function run(card, authorization, b, simulation = false, resume = false) {
  validateHumanAuthorization(card, authorization); const { provider, signers, readState, consumeAuthorization, confirmConsumedAuthorization, estimateL1Fee } = b ?? {};
  if (!provider?.getNetwork || !provider?.getBlock || !provider?.estimateGas || !provider?.getBalance || !provider?.getTransactionCount || !provider?.getCode || typeof estimateL1Fee !== "function") refuse("injected Base provider and L1 fee estimator are required");
  if (num((await provider.getNetwork()).chainId, "network") !== num(card.chainId, "chain")) refuse("provider chain differs"); const block = await provider.getBlock(Number(card.anchor.blockNumber)); if (block?.hash?.toLowerCase() !== card.anchor.blockHash.toLowerCase()) refuse("provider block differs");
  for (const k of ["source", "target"]) if (!signers?.[k] || !same(await signers[k].getAddress(), card[k])) refuse(`signer differs: ${k}`);
  await attestEndpoints(card, provider, ["rewardPool", "vault", "moonwellMarket", "factory", "pool", "lp", "tbtc", "cbbtc"]);
  const initial = await state(readState, card), initialDebt = num(initial.debt, "initial debt"); if (initialDebt < num(card.postconditions.debtBefore, "debtBefore") || initialDebt > num(card.postconditions.maxDebtBefore, "maxDebtBefore")) refuse("initial debt is outside card window"); const vaultAlreadyWithdrawn = resume && num(initial.vaultShares, "initial vault shares") === 0n && num(initial.lp, "initial lp") === num(card.amounts.lpAmount, "lpAmount"); if (resume && !vaultAlreadyWithdrawn) refuse("resume requires zero vault shares and exact card LP amount"); const targetBefore = initial.targetCbBtc, receipts = []; let reserved = 0n, used = 0n, fees = 0n;
  const prepareSend = async (step) => { const signer = signers[step.signer], from = await signer.getAddress(), maxFee = num(card.limits.maxFeePerGas, "maxFee"), maxPriorityFee = num(card.limits.maxPriorityFeePerGas, "maxPriorityFee"), transaction = { ...step, from, maxFeePerGas: maxFee, maxPriorityFeePerGas: maxPriorityFee }; delete transaction.name; delete transaction.signer; const estimate = num(await provider.estimateGas(transaction), "estimate"), limit = (estimate * num(card.limits.gasBufferBps, "buffer") + 9999n) / 10000n, l1 = num(await estimateL1Fee({ transaction: { ...transaction, gasLimit: limit }, card }), "Base L1 fee"), cost = limit * maxFee + l1;
    if (limit > num(card.limits.maxGasPerStep, "step gas") || reserved + limit > num(card.limits.maxCumulativeGas, "total gas") || fees + cost > num(card.limits.maxTotalFeeWei, "fees")) refuse(`gas ceiling exceeded before ${step.name}`); if (num(await provider.getBalance(from), "native balance") < cost) refuse(`native balance cannot afford ${step.name}`); return { step, signer, transaction, limit, maxFee }; };
  const submitPrepared = async ({ step, signer, transaction, limit, maxFee }) => { const response = await signer.sendTransaction({ ...transaction, gasLimit: limit }); const receipt = await response.wait(b.confirmations ?? 1); if (!receipt || Number(receipt.status) !== 1) refuse(`transaction failed at ${step.name}`); const gas = num(receipt.gasUsed, "gas used"), l1Actual = num(await estimateL1Fee({ transaction, receipt, card }), "Base L1 fee"), fee = gas * num(receipt.effectiveGasPrice ?? maxFee, "effective fee") + l1Actual;
    if (gas > num(card.limits.maxGasPerStep, "step gas") || used + gas > num(card.limits.maxCumulativeGas, "total gas") || fees + fee > num(card.limits.maxTotalFeeWei, "fees")) refuse(`gas ceiling exceeded at ${step.name}`); reserved += limit; used += gas; fees += fee; receipts.push({ name: step.name, hash: response.hash, gasUsed: gas, feeWei: fee }); return receipt; };
  const send = async (step) => submitPrepared(await prepareSend(step));
  const existingHelperCode = await provider.getCode(card.deployment.expectedAddress), resuming = existingHelperCode !== "0x";
  if (resuming && keccak256(existingHelperCode) !== card.deployment.runtimeCodeHash) refuse("existing helper runtime differs from action card");
  const deployment = await prepareHelperDeploymentAttestation(card, resuming ? null : provider, readState);
  if (resuming) {
    if (simulation) refuse("simulation cannot resume a post-anchor live deployment");
    if (num(await provider.getTransactionCount(card.source, "pending"), "pending deployment nonce") <= num(card.deployment.nonce, "deployment nonce")) refuse("source nonce does not prove helper deployment");
    if (await confirmConsumedAuthorization?.({ card, authorization }) !== true) refuse("consumed authorization does not admit resume");
    await attestHelper(card, provider, readState);
  } else {
    const preparedDeployment = await prepareSend({ name: "deploy-helper", data: deployment.initCode, signer: "source", value: 0n, nonce: num(card.deployment.nonce, "deployment nonce") });
    if (!simulation && await consumeAuthorization?.({ card, authorization }) !== true) refuse("authorization was already used or not consumed");
    if (num(await provider.getTransactionCount(card.source, "pending"), "pending deployment nonce") !== num(card.deployment.nonce, "deployment nonce") || await provider.getCode(deployment.expectedAddress) !== "0x") refuse("deployment pre-broadcast binding changed");
    const deploymentReceipt = await submitPrepared(preparedDeployment); if (!deploymentReceipt.contractAddress || !same(deploymentReceipt.contractAddress, deployment.expectedAddress)) refuse("helper deployment receipt differs from CREATE address"); await attestHelper(card, provider, readState);
  }
  for (const step of prepareDeleverage(card).filter((step) => !(vaultAlreadyWithdrawn && step.name === "vault-withdraw-all"))) { const endpoints = step.name === "reward-pool-withdraw" ? ["rewardPool"] : step.name === "vault-withdraw-all" ? ["vault"] : step.name.includes("approve") ? [step.name.startsWith("lp") ? "lp" : step.name.startsWith("tbtc") ? "tbtc" : "cbbtc"] : ["factory", "pool", "tbtc", "cbbtc"]; await attestEndpoints(card, provider, endpoints); await send(step); if (step.name === "helper-recover-and-swap-to-target") { const after = await state(readState, card), actual = num(after.targetCbBtc, "target cbBTC") - num(targetBefore, "target baseline"); if (actual < num(card.amounts.minRepay, "minRepay") || actual > num(card.amounts.maxRepay, "maxRepay")) refuse("actual cbBTC is outside repay range"); const currentDebt = num(await readState?.borrowBalanceCurrent?.({ card, target: card.target }), "current Moonwell debt"); if (actual > currentDebt) refuse("actual cbBTC exceeds current Moonwell debt"); await attestEndpoints(card, provider, ["cbbtc", "moonwellMarket"]); await send({ name: "target-approve-moonwell", to: card.contracts.cbbtc, data: erc20.encodeFunctionData("approve", [card.contracts.moonwellMarket, actual]), signer: "target", value: 0n }); await attestEndpoints(card, provider, ["moonwellMarket"]); await send({ name: "repay-moonwell-borrow", to: card.contracts.moonwellMarket, data: moonwell.encodeFunctionData("repayBorrow", [actual]), signer: "target", value: 0n }); assertResidue(card, await state(readState, card), targetBefore, initialDebt, actual); return { receipts, cumulativeGas: used, feeWei: fees, actualRepay: actual }; } }
  refuse("helper execution was not reached");
}
export async function executeDeleverage(card, authorization, boundaries) { return run(card, authorization, boundaries); }
export async function resumeDeleverage(card, authorization, boundaries) { return run(card, authorization, boundaries, false, true); }
export async function simulateDeleverage(card, authorization, { fork } = {}) { if (fork?.kind !== "anvil-fork" || fork.isolated !== true || !fork.snapshot || !fork.revert) refuse("isolated Anvil fork boundary is required"); const snapshot = await fork.snapshot(); try { return await run(card, authorization, fork, true); } finally { await fork.revert(snapshot); } }

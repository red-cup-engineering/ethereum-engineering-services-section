import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Interface } from "ethers";

import { EMPTY_WITNESS_ROOT, identifyJsonSemanticContent } from "@red-cup-engineering/computer-data-engineering-services-section/semiotic-expression-notation/semantic-content-identity";
import { recordSettlementRecord } from "@red-cup-engineering/witness-journal-document-service";
import { resolveDeclaredPackageBinary } from "./declared-package-binary.mjs";

const execFileAsync = promisify(execFile);
const NODE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HARNESS_CONFIG = resolve(NODE_ROOT, "harness/fixed-fork-beefy-vault-exit/foundry.toml");
const PROFILE = "org.emsenn.evm.fixed-fork-beefy-vault-exit-observation.v1";
const RECORD_CATEGORY = "ethereum-services.fixed-fork-beefy-vault-exit-observation";
const ACTOR = "urn:ame:ethereum-services-section";
const SETTLEMENT = "eip155:31337:0x9a1ace657ad8688fb1236291c0e30d934931290f";
const RPC_URL = "https://mainnet.base.org/";
const HASH = /^0x[0-9a-fA-F]{64}$/u;
const ROUTE_GAS_SAFETY_BPS = 12_000n;
const BPS_DENOMINATOR = 10_000n;
const INTRINSIC_AND_CALLDATA_GAS_CEIL = 64_728n;
const RPC_ATTEMPTS = 3;
const EVENT = new Interface(["event FixedForkRecoveryObserved(string candidateId,uint256 blockNumber,address vault,address lpToken,uint256 sharesBurned,uint256 lpBurned,address token0,uint256 amount0,address token1,uint256 amount1,uint256 gasUsed,uint256 gasUnitsCeil,uint256 baseFeePerGas,uint256 l1DataFeeWeiCeil,uint256 operatorFeeWeiCeil,uint256 transactionCount,uint256 unsignedTxSizeCeil)"]);
const EVENT_TOPIC = EVENT.getEvent("FixedForkRecoveryObserved").topicHash.toLowerCase();
const SIGMUND_EXIT_EVENT = new Interface(["event FixedForkSigmundTbtcCbBtcExitObserved(uint256 blockNumber,address source,address rewardPool,address vault,address lpToken,uint256 stakedVaultSharesExited,uint256 directVaultSharesBurned,uint256 lpBurned,address tbtc,uint256 tbtcReceived,address cbbtc,uint256 cbbtcReceived,uint256 gasUsed)"]);
const SIGMUND_SWAP_EVENT = new Interface(["event FixedForkSigmundTbtcCbBtcSwapObserved(uint256 blockNumber,address pool,uint256 tbtcInput,uint256 cbbtcQuoted,uint256 cbbtcReceived,uint256 tbtcResidual,uint256 sourceCbBtcAfter,uint256 gasUsed)"]);
const SIGMUND_REPAYMENT_EVENT = new Interface(["event FixedForkSigmundCbBtcRepaymentObserved(uint256 blockNumber,address source,address target,address market,uint256 repaymentSats,uint256 debtBeforeSats,uint256 debtAfterSats,uint256 sourceCbBtcResidualSats,uint256 targetCbBtcAllowanceSats)"]);
const SIGMUND_HEALTH_EVENT = new Interface(["event FixedForkSigmundHealthObserved(uint256 blockNumber,address target,uint256 targetHealthFactorWad,uint256 currentHealthFactorWad,uint256 lbtcHaircut10HealthFactorWad,uint256 lbtcDown5CbBtcUp2HealthFactorWad,bool allScenariosMeetTarget)"]);
const SIGMUND_EXIT_TOPIC = SIGMUND_EXIT_EVENT.getEvent("FixedForkSigmundTbtcCbBtcExitObserved").topicHash.toLowerCase();
const SIGMUND_SWAP_TOPIC = SIGMUND_SWAP_EVENT.getEvent("FixedForkSigmundTbtcCbBtcSwapObserved").topicHash.toLowerCase();
const SIGMUND_REPAYMENT_TOPIC = SIGMUND_REPAYMENT_EVENT.getEvent("FixedForkSigmundCbBtcRepaymentObserved").topicHash.toLowerCase();
const SIGMUND_HEALTH_TOPIC = SIGMUND_HEALTH_EVENT.getEvent("FixedForkSigmundHealthObserved").topicHash.toLowerCase();
const DEFINITIONS = Object.freeze({
  "yanagi-beefy-weeth-weth": Object.freeze({ test: "testYanagiBeefyWeethWethFixedForkExit()",
    vault: "0x47579c50c7aedea788d18927aed4c827fe34996a", lpToken: "0x91f0f34916ca4e2cce120116774b0e4fa0cdcaa8" }),
  "yanagi-beefy-sfrxeth-wsteth": Object.freeze({ test: "testYanagiBeefySfrxethWstethFixedForkExit()",
    vault: "0xdee327bf6b0182a1727caec9c6344a0d27d6da99", lpToken: "0x456c166e63634d75a4b49edec86cb51424d4c926" }),
  "sigmund-beefy-tbtc-cbbtc": Object.freeze({ test: "testSigmundFullTbtcCbBtcRepayment()",
    source: "0x32886f6f361c1d570255c2762967a2e41d0e9b1a", rewardPool: "0xcd241a97ac92c3415fefbe6f3d61a27b2c30ace7",
    vault: "0x64af54612646cce0657374226e38b82b8001e674", lpToken: "0x488d6ea6064eee9352fdcdb7bc50d98a7ff3ad4e",
    tbtc: "0x236aa50979d5f3de3bd1eeb40e81137f22ab794b", cbbtc: "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf",
    target: "0x224c08a8526751887a83e2711b167f890c6d078d", market: "0xf877acafa28c19b96727966690b2f44d35ad5976",
    targetHealthFactorWad: 1_200_000_000_000_000_000n }),
});

function digest(value) {
  return identifyJsonSemanticContent({ objectKind: "ethereum.fixed-fork-beefy-vault-exit-observation", value, witnessRoot: EMPTY_WITNESS_ROOT }).token;
}
function assertNoNumericOrTransactionMaterial(value, path = "input") {
  if (typeof value === "number" || typeof value === "bigint") {
    throw new TypeError(`${path} must encode integers as decimal text`);
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoNumericOrTransactionMaterial(entry, `${path}[${index}]`));
    return;
  }
  if (value == null || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    if (/^(calldata|data|mnemonic|privateKey|rawTransaction|rlp|secret|seed|signedTransaction|transactionRequest)$/iu.test(key)) {
      throw new TypeError(`${path}.${key} is secret or transaction material and is refused`);
    }
    assertNoNumericOrTransactionMaterial(entry, `${path}.${key}`);
  }
}
function serializable(value) {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(serializable);
  if (value != null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, serializable(entry)]));
  }
  return value;
}
function text(name, value, pattern) {
  if (typeof value !== "string" || !pattern.test(value)) throw new TypeError(`${name} is malformed`);
  return value;
}
function decimal(name, value) { text(name, value, /^(0|[1-9][0-9]*)$/u); return BigInt(value); }
function assertAuthority(authority) {
  if (authority?.fixedForkEvidenceOnly !== true || authority?.liveMutation !== false
    || authority?.signerMaterialPresent !== false || authority?.transactionAssembly !== false
    || authority?.signing !== false || authority?.broadcast !== false || authority?.chainMutation !== false
    || authority?.outputCalldata !== false) {
    throw new TypeError("authority must admit only fixed-fork evidence and no transaction authority");
  }
}

function normalize(input) {
  assertNoNumericOrTransactionMaterial(input);
  if (input?.profile !== PROFILE) throw new TypeError(`profile must equal ${PROFILE}`);
  assertAuthority(input.authority);
  if (input.chain !== "eip155:8453" || input.rpcUrl !== RPC_URL) throw new TypeError("exact official Base RPC is required");
  const block = decimal("block", input.block);
  if (block === 0n) throw new TypeError("block must be positive");
  const blockHash = text("blockHash", input.blockHash, HASH).toLowerCase();
  const timestamp = decimal("timestamp", input.timestamp);
  if (!Array.isArray(input.candidates) || input.candidates.length < 1 || input.candidates.length > 3) {
    throw new TypeError("candidates must contain one to three provider-reviewed exits");
  }
  const candidates = input.candidates.map((candidate) => text("candidate", candidate,
    /^(yanagi-beefy-weeth-weth|yanagi-beefy-sfrxeth-wsteth|sigmund-beefy-tbtc-cbbtc)$/u)).sort();
  if (new Set(candidates).size !== candidates.length) throw new TypeError("candidates must be unique");
  return { profile: PROFILE, authority: { ...input.authority }, chain: input.chain, rpcUrl: input.rpcUrl,
    block, blockHash, timestamp, candidates };
}

function safeProviderOutput(value) {
  const home = typeof process.env.HOME === "string" ? process.env.HOME : "";
  const output = String(value ?? "")
    .replace(/\u001b\[[0-9;]*m/gu, "")
    .replaceAll(NODE_ROOT, "<package>");
  return (home === "" ? output : output.replaceAll(home, "<home>"))
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "")
    .split(/\r?\n/u).filter(Boolean).slice(0, 4).join(" | ").slice(0, 768);
}

export class FixedForkHarnessProviderError extends Error {
  constructor(stage, { stdout = "", stderr = "", exitCode = null, signal = null } = {}) {
    super(`fixed-fork harness provider failed during ${stage}`);
    this.name = "FixedForkHarnessProviderError";
    this.code = "ERR_FIXED_FORK_HARNESS_PROVIDER";
    this.evidence = Object.freeze({ stage,
      exitCode: Number.isInteger(exitCode) ? exitCode : null,
      signal: typeof signal === "string" ? signal : null,
      stdout: safeProviderOutput(stdout), stderr: safeProviderOutput(stderr) });
  }
}

export function parseFixedForkHarnessProviderOutput({ stdout, stderr = "" }) {
  try {
    const result = JSON.parse(stdout);
    if (result == null || typeof result !== "object" || Array.isArray(result)) {
      throw new TypeError("provider result must be an object");
    }
    return result;
  } catch {
    throw new FixedForkHarnessProviderError("result-decoding", { stdout, stderr });
  }
}

async function runForgeHarness(block) {
  const forge = resolveDeclaredPackageBinary({ ownerRoot: NODE_ROOT, packageName: "@foundry-rs/forge", binaryName: "forge" });
  const environment = { HOME: process.env.HOME,
    AGRODAO_BASE_RECOVERY_FORK: "true", AGRODAO_BASE_RECOVERY_BLOCK: block.toString() };
  let execution;
  try {
    execution = await execFileAsync(process.execPath, [forge.path, "test", "--root", NODE_ROOT,
      "--config-path", HARNESS_CONFIG, "--match-contract", "BeefyLegacyRecoveryForkTest", "-vvvv", "--json"],
    { cwd: NODE_ROOT, env: environment, encoding: "utf8", maxBuffer: 12_000_000, timeout: 120_000 });
  } catch (error) {
    throw new FixedForkHarnessProviderError("execution", { stdout: error?.stdout, stderr: error?.stderr,
      exitCode: error?.code, signal: error?.signal });
  }
  return parseFixedForkHarnessProviderOutput(execution);
}

async function jsonRpcFeeRead(url, method, params, fetchImpl = fetch, wait = (milliseconds) =>
  new Promise((resolveWait) => setTimeout(resolveWait, milliseconds))) {
  if (!["eth_getBlockByNumber", "eth_maxPriorityFeePerGas"].includes(method)) {
    throw new TypeError(`${method} is outside the fixed-fork fee observation law`);
  }
  for (let attempt = 1; attempt <= RPC_ATTEMPTS; attempt += 1) {
    const response = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json",
      "user-agent": "@red-cup-engineering/ethereum-engineering-services-section fixed-fork-fee-read" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(20_000) });
    if (response.ok) {
      const body = await response.json();
      if (body?.error) throw new Error(`JSON-RPC ${body.error.code}: ${body.error.message}`);
      return body?.result;
    }
    if (attempt === RPC_ATTEMPTS || (response.status !== 429 && response.status < 500)) {
      throw new Error(`JSON-RPC HTTP ${response.status}`);
    }
    await wait(250 * attempt);
  }
  throw new Error("JSON-RPC retry boundary exhausted");
}

function harnessContract(result) {
  const entry = Object.entries(result ?? {}).find(([name]) => name.endsWith(":BeefyLegacyRecoveryForkTest"));
  if (entry == null || entry[1]?.test_results == null) throw new TypeError("Foundry result lacks the exact recovery harness");
  return entry[1].test_results;
}

function parseCandidate(testResults, candidateId, block, blockBaseFeePerGas, priorityFeePerGasObserved) {
  const definition = DEFINITIONS[candidateId];
  const test = testResults[definition.test];
  if (test?.status !== "Success" || !Array.isArray(test.logs)) throw new TypeError(`${candidateId} fixed-fork test did not succeed`);
  if (candidateId === "sigmund-beefy-tbtc-cbbtc") return parseSigmundCandidate(test.logs, definition, block);
  const logs = test.logs.filter((log) => log?.topics?.[0]?.toLowerCase() === EVENT_TOPIC);
  if (logs.length !== 1) throw new TypeError(`${candidateId} must emit exactly one typed recovery observation`);
  const parsed = EVENT.parseLog(logs[0]);
  const args = parsed.args;
  const expectedGasUnitsCeil = (args.gasUsed * ROUTE_GAS_SAFETY_BPS + BPS_DENOMINATOR - 1n)
    / BPS_DENOMINATOR + INTRINSIC_AND_CALLDATA_GAS_CEIL;
  if (args.candidateId !== candidateId || args.blockNumber !== block
    || args.vault.toLowerCase() !== definition.vault || args.lpToken.toLowerCase() !== definition.lpToken
    || args.sharesBurned <= 0n || args.lpBurned <= 0n || args.amount0 <= 0n || args.amount1 <= 0n
    || args.gasUsed <= 0n || args.gasUnitsCeil !== expectedGasUnitsCeil
    || args.baseFeePerGas !== blockBaseFeePerGas || args.l1DataFeeWeiCeil <= 0n
    || args.transactionCount !== 3n || args.unsignedTxSizeCeil !== 256n
    || args.token0.toLowerCase() === args.token1.toLowerCase()) {
    throw new TypeError(`${candidateId} typed recovery observation contradicts its provider-reviewed definition`);
  }
  const priorityFeePerGasCeil = priorityFeePerGasObserved * 2n;
  const maxFeePerGasCeil = args.baseFeePerGas * 2n + priorityFeePerGasCeil;
  const l2ExecutionFeeWeiCeil = args.gasUnitsCeil * maxFeePerGasCeil;
  const totalFeeWeiCeil = l2ExecutionFeeWeiCeil + args.l1DataFeeWeiCeil + args.operatorFeeWeiCeil;
  return { candidateId, vault: definition.vault, lpToken: definition.lpToken,
    sharesBurned: args.sharesBurned.toString(), lpBurned: args.lpBurned.toString(),
    outputs: [{ token: args.token0.toLowerCase(), amount: args.amount0.toString() },
      { token: args.token1.toLowerCase(), amount: args.amount1.toString() }].sort((a, b) => a.token.localeCompare(b.token)),
    routeGasUsed: args.gasUsed.toString(), gasUnitsCeil: args.gasUnitsCeil.toString(),
    fee: { transactionCount: args.transactionCount.toString(), unsignedTxSizeCeil: args.unsignedTxSizeCeil.toString(),
      baseFeePerGas: args.baseFeePerGas.toString(), priorityFeePerGasObserved: priorityFeePerGasObserved.toString(),
      priorityFeePerGasCeil: priorityFeePerGasCeil.toString(), maxFeePerGasCeil: maxFeePerGasCeil.toString(),
      l2ExecutionFeeWeiCeil: l2ExecutionFeeWeiCeil.toString(),
      l1DataFeeWeiCeil: args.l1DataFeeWeiCeil.toString(), operatorFeeWeiCeil: args.operatorFeeWeiCeil.toString(),
      totalFeeWeiCeil: totalFeeWeiCeil.toString() },
    conservationVerified: true, outputVerified: true, feeCeilingComplete: true };
}

function parseOneTypedLog(logs, topic, event, candidateId, label) {
  const matches = logs.filter((log) => log?.topics?.[0]?.toLowerCase() === topic);
  if (matches.length !== 1) throw new TypeError(`${candidateId} must emit exactly one typed ${label} observation`);
  return event.parseLog(matches[0]).args;
}

function isAddress(value, expected) { return value.toLowerCase() === expected; }

function parseSigmundCandidate(logs, definition, block) {
  const exit = parseOneTypedLog(logs, SIGMUND_EXIT_TOPIC, SIGMUND_EXIT_EVENT, "sigmund-beefy-tbtc-cbbtc", "exit");
  const swap = parseOneTypedLog(logs, SIGMUND_SWAP_TOPIC, SIGMUND_SWAP_EVENT, "sigmund-beefy-tbtc-cbbtc", "swap");
  const repayment = parseOneTypedLog(logs, SIGMUND_REPAYMENT_TOPIC, SIGMUND_REPAYMENT_EVENT, "sigmund-beefy-tbtc-cbbtc", "repayment");
  const health = parseOneTypedLog(logs, SIGMUND_HEALTH_TOPIC, SIGMUND_HEALTH_EVENT, "sigmund-beefy-tbtc-cbbtc", "health");
  if (exit.blockNumber !== block || swap.blockNumber !== block || repayment.blockNumber !== block || health.blockNumber !== block
    || !isAddress(exit.source, definition.source) || !isAddress(repayment.source, definition.source)
    || !isAddress(exit.rewardPool, definition.rewardPool) || !isAddress(exit.vault, definition.vault) || !isAddress(exit.lpToken, definition.lpToken)
    || !isAddress(exit.tbtc, definition.tbtc) || !isAddress(exit.cbbtc, definition.cbbtc)
    || !isAddress(swap.pool, definition.lpToken) || !isAddress(repayment.target, definition.target)
    || !isAddress(health.target, definition.target) || !isAddress(repayment.market, definition.market)
    || exit.stakedVaultSharesExited <= 0n || exit.directVaultSharesBurned <= 0n || exit.lpBurned <= 0n
    || exit.tbtcReceived <= 0n || exit.cbbtcReceived <= 0n || exit.gasUsed <= 0n
    || swap.tbtcInput <= exit.tbtcReceived || swap.cbbtcQuoted <= 0n || swap.cbbtcQuoted !== swap.cbbtcReceived
    || swap.tbtcResidual !== 0n || swap.sourceCbBtcAfter !== repayment.repaymentSats || swap.gasUsed <= 0n
    || repayment.debtBeforeSats - repayment.debtAfterSats !== repayment.repaymentSats
    || repayment.sourceCbBtcResidualSats !== 0n || repayment.targetCbBtcAllowanceSats !== 0n
    || health.targetHealthFactorWad !== definition.targetHealthFactorWad || health.allScenariosMeetTarget !== true
    || health.currentHealthFactorWad < health.targetHealthFactorWad
    || health.lbtcHaircut10HealthFactorWad < health.targetHealthFactorWad
    || health.lbtcDown5CbBtcUp2HealthFactorWad < health.targetHealthFactorWad) {
    throw new TypeError("sigmund-beefy-tbtc-cbbtc typed observations contradict the provider-reviewed definition");
  }
  return { candidateId: "sigmund-beefy-tbtc-cbbtc", sourcePosition: { source: definition.source, rewardPool: definition.rewardPool,
    vault: definition.vault, lpToken: definition.lpToken, stakedVaultSharesExited: exit.stakedVaultSharesExited.toString(),
    directVaultSharesBurned: exit.directVaultSharesBurned.toString(), lpBurned: exit.lpBurned.toString() },
  outputs: [{ token: definition.tbtc, amount: exit.tbtcReceived.toString() }, { token: definition.cbbtc, amount: exit.cbbtcReceived.toString() }],
  routeGasUsed: (exit.gasUsed + swap.gasUsed).toString(), fullConversionStatus: "completed",
  fullConversion: { receiptVerified: true, pool: definition.lpToken, tbtcInput: swap.tbtcInput.toString(),
    cbbtcQuotedSats: swap.cbbtcQuoted.toString(), cbbtcReceivedSats: swap.cbbtcReceived.toString(),
    tbtcResidual: "0", sourceCbBtcAfterSats: swap.sourceCbBtcAfter.toString(), gasUsed: swap.gasUsed.toString() },
  repayment: { receiptVerified: true, target: definition.target, market: definition.market,
    repaymentSats: repayment.repaymentSats.toString(), debtBeforeSats: repayment.debtBeforeSats.toString(), debtAfterSats: repayment.debtAfterSats.toString(),
    debtDeltaSats: repayment.repaymentSats.toString(), sourceCbBtcResidualSats: repayment.sourceCbBtcResidualSats.toString(),
    targetCbBtcAllowanceSats: repayment.targetCbBtcAllowanceSats.toString() },
  health: { targetHealthFactorWad: health.targetHealthFactorWad.toString(),
    currentHealthFactorWad: health.currentHealthFactorWad.toString(), scenarios: [
      { id: "lbtc-collateral-haircut-10-percent", healthFactorWad: health.lbtcHaircut10HealthFactorWad.toString() },
      { id: "lbtc-down-5-cbbtc-up-2-percent", healthFactorWad: health.lbtcDown5CbBtcUp2HealthFactorWad.toString() }],
    allScenariosMeetTarget: health.allScenariosMeetTarget }, conservationVerified: true,
  outputVerified: true, fullConversionVerified: true, repaymentVerified: true, healthVerified: true };
}

export async function observeFixedForkBeefyVaultExits(rawInput, options = {}) {
  const input = normalize(rawInput);
  const request = serializable(input);
  const rpc = options.rpc ?? ((url, method, params) =>
    jsonRpcFeeRead(url, method, params, options.fetchImpl, options.wait));
  const [rawBlock, rawPriorityFee] = await Promise.all([
    rpc(input.rpcUrl, "eth_getBlockByNumber", [`0x${input.block.toString(16)}`, false]),
    rpc(input.rpcUrl, "eth_maxPriorityFeePerGas", []),
  ]);
  if (rawBlock == null || BigInt(rawBlock.number ?? "-1") !== input.block
    || String(rawBlock.hash).toLowerCase() !== input.blockHash || BigInt(rawBlock.timestamp ?? "-1") !== input.timestamp) {
    throw new TypeError("official RPC block identity differs from the requested fixed fork");
  }
  const blockBaseFeePerGas = BigInt(rawBlock.baseFeePerGas ?? "-1");
  if (blockBaseFeePerGas <= 0n) throw new TypeError("official RPC block base fee is unavailable");
  const priorityFeePerGasObserved = BigInt(rawPriorityFee ?? "-1");
  if (priorityFeePerGasObserved <= 0n) throw new TypeError("official RPC priority fee recommendation is unavailable");
  const feeObservedAt = (options.now ?? (() => new Date().toISOString()))();
  if (!Number.isFinite(Date.parse(feeObservedAt))) throw new TypeError("fee observation time must be an ISO timestamp");
  const harness = await (options.runHarness ?? runForgeHarness)(input.block);
  const tests = harnessContract(harness);
  const candidates = input.candidates.map((candidateId) => parseCandidate(tests, candidateId, input.block,
    blockBaseFeePerGas, priorityFeePerGasObserved));
  const result = { profile: PROFILE,
    requestDigest: digest(request), outcome: "completed-fixed-fork-beefy-vault-exit-observation",
    chain: input.chain, block: input.block.toString(), blockHash: input.blockHash,
    timestamp: input.timestamp.toString(), feeObservedAt, feeSource: input.rpcUrl,
    candidateCount: String(candidates.length), candidates,
    gate: { fixedForkEvidenceOnly: true, publicAccountImpersonatedWithoutKey: true,
      outputVerified: true, routeGasObserved: true, gasEstimated: true, l1DataFeeEstimated: true,
      operatorFeeEstimated: true, feeCeilingComplete: true,
      priceEvidenceComplete: false, liveMutation: false, transactionAssembly: false, outputCalldata: false,
      signing: false, broadcast: false, chainMutation: false, executionAdmitted: false } };
  return { id: digest(result), ...result };
}

export async function recordFixedForkBeefyVaultExitObservation(input, result, options = {}) {
  const request = serializable(normalize(input));
  const { id, ...body } = result ?? {};
  if (result?.profile !== PROFILE
    || result?.requestDigest !== digest(request) || id !== digest(body) || result?.gate?.executionAdmitted !== false) {
    throw new TypeError("a valid request-bound fixed-fork Beefy exit observation is required");
  }
  const recordedAt = options.recordedAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(recordedAt))) throw new TypeError("recordedAt must be an ISO timestamp");
  const record = { type: "FixedForkBeefyVaultExitObservationRecord", owner: ACTOR,
    observation: result, evidenceInput: request, recordedAt, decisionBoundary: result.gate };
  const projection = await (options.record ?? ((request) => recordSettlementRecord({
    agentUrl: options.agentUrl ?? process.env.WITNESS_JOURNAL_RDF_AGENT, settlement: SETTLEMENT, actor: ACTOR, ...request,
  })))({ category: RECORD_CATEGORY, recordedAt, record });
  return { result, record, projection };
}

export const FIXED_FORK_BEEFY_VAULT_EXIT_PROFILE = PROFILE;
export const FIXED_FORK_BEEFY_VAULT_EXIT_RECORD_CATEGORY = RECORD_CATEGORY;

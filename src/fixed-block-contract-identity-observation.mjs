import { keccak256 } from "ethers";
import { EMPTY_WITNESS_ROOT, identifyJsonSemanticContent } from "@red-cup-engineering/computer-data-engineering-services-section/semiotic-expression-notation/semantic-content-identity";
import { recordSettlementRecord } from "@red-cup-engineering/witness-journal-document-service";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { jsonRpc } from "./public-evm-ledger.mjs";

const PROFILE = "org.emsenn.evm.fixed-block-contract-identity-observation.v1";
const RECORD_CATEGORY = "ethereum-services.fixed-block-contract-identity-observation";
const ACTOR = "urn:ame:ethereum-services-section";
const SETTLEMENT = "eip155:31337:0x9a1ace657ad8688fb1236291c0e30d934931290f";
const NODE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const HASH = /^0x[0-9a-fA-F]{64}$/u;
const CODE = /^0x(?:[0-9a-fA-F]{2})+$/u;
const ZERO_WORD = `0x${"0".repeat(64)}`;
const IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const BEACON_SLOT = "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50";
const ALLOWED_METHODS = Object.freeze(["eth_chainId", "eth_getBlockByNumber", "eth_getCode", "eth_getStorageAt"]);
const PROXY_TYPES = new Set(["direct", "eip1167", "eip1967", "eip1967_beacon"]);
const SOURCES = new Map([
  ["eip155:8453", "https://mainnet.base.org/"],
  ["eip155:42161", "https://arb1.arbitrum.io/rpc"],
]);

function object(name, value) {
  if (value == null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
  return value;
}
function text(name, value, pattern = /^.+$/u) {
  if (typeof value !== "string" || !pattern.test(value)) throw new TypeError(`${name} must be bounded text`);
  return value;
}
function flag(name, value) { if (typeof value !== "boolean") throw new TypeError(`${name} must be boolean`); return value; }
function decimal(name, value) {
  text(name, value, /^(0|[1-9][0-9]*)$/u);
  return BigInt(value);
}
function address(name, value) { return text(name, value, ADDRESS).toLowerCase(); }
function hexQuantity(value) { return `0x${value.toString(16)}`; }
function serializable(value) {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(serializable);
  if (value != null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serializable(item)]));
  return value;
}
function digest(value) {
  return identifyJsonSemanticContent({ objectKind: "ethereum.fixed-block-contract-identity-observation", value, witnessRoot: EMPTY_WITNESS_ROOT }).token;
}
function codeIdentity(code) { return { semanticDigest: digest({ type: "EvmRuntimeBytecode", code: code.toLowerCase() }), keccak256: keccak256(code) }; }
function wordAddress(word) {
  if (!HASH.test(word ?? "") || word.toLowerCase() === ZERO_WORD) return null;
  const prefix = word.slice(2, 26);
  if (!/^0{24}$/u.test(prefix)) return null;
  return `0x${word.slice(-40)}`.toLowerCase();
}
function eip1167Implementation(code) {
  const match = /^0x363d3d373d3d3d363d73([0-9a-fA-F]{40})5af43d82803e903d91602b57fd5bf3$/u.exec(code ?? "");
  return match ? `0x${match[1]}`.toLowerCase() : null;
}
function validateSource(caip2, rawUrl) {
  const expected = SOURCES.get(caip2);
  const url = new URL(rawUrl);
  if (expected == null || url.protocol !== "https:" || url.username || url.password || url.search || url.hash
    || url.href !== expected) throw new TypeError(`${caip2} must use its exact credential-free official archive RPC`);
  return url.href;
}
function assertAuthority(authority) {
  const value = object("authority", authority);
  if (flag("authority.publicReadOnly", value.publicReadOnly) !== true
    || flag("authority.signerMaterialPresent", value.signerMaterialPresent) !== false
    || flag("authority.calldata", value.calldata) !== false
    || flag("authority.transactionAssembly", value.transactionAssembly) !== false
    || flag("authority.signing", value.signing) !== false
    || flag("authority.broadcast", value.broadcast) !== false
    || flag("authority.chainMutation", value.chainMutation) !== false
    || JSON.stringify(value.allowedRpcMethods) !== JSON.stringify(ALLOWED_METHODS)) {
    throw new TypeError("authority must admit exactly the four public fixed-block RPC methods and no transaction authority");
  }
}

export async function jsonRpcPublicRead(url, method, params, fetchImpl = fetch) {
  if (!ALLOWED_METHODS.includes(method)) throw new TypeError(`RPC method ${method} is outside the fixed-block observation law`);
  return jsonRpc(url, method, params, fetchImpl);
}

async function exactCode(rpc, source, contract, blockTag) {
  const code = await rpc(source, "eth_getCode", [contract, blockTag]);
  if (!CODE.test(code ?? "")) throw new TypeError(`runtime code is unavailable for ${contract}`);
  return { address: contract, code: codeIdentity(code) };
}

async function observeRoot(rpc, source, root, expectedProxyType, expectedImplementationAddress, blockTag) {
  let runtime;
  let implementationWord;
  let beaconWord;
  try {
    [runtime, implementationWord, beaconWord] = await Promise.all([
      exactCode(rpc, source, root, blockTag),
      rpc(source, "eth_getStorageAt", [root, IMPLEMENTATION_SLOT, blockTag]),
      rpc(source, "eth_getStorageAt", [root, BEACON_SLOT, blockTag]),
    ]);
  } catch (error) {
    return { address: root, expectedProxyType, complete: false, reason: error.message, runtime: null,
      implementation: null, beacon: null };
  }
  if (!HASH.test(implementationWord ?? "") || !HASH.test(beaconWord ?? "")) {
    return { address: root, expectedProxyType, complete: false, reason: "proxy storage word is malformed",
      runtime, implementation: null, beacon: null };
  }
  const slotImplementation = wordAddress(implementationWord);
  const beaconAddress = wordAddress(beaconWord);
  const cloneImplementation = eip1167Implementation(await rpc(source, "eth_getCode", [root, blockTag]));
  try {
    if (expectedProxyType === "eip1167") {
      if (cloneImplementation == null || slotImplementation != null || beaconAddress != null) throw new TypeError("EIP-1167 shape disagrees with proxy slots");
      if (expectedImplementationAddress && cloneImplementation !== expectedImplementationAddress) throw new TypeError("EIP-1167 implementation differs from the reviewed current implementation");
      return { address: root, expectedProxyType, complete: true, reason: "complete", runtime,
        implementation: await exactCode(rpc, source, cloneImplementation, blockTag), beacon: null };
    }
    if (expectedProxyType === "eip1967") {
      if (cloneImplementation != null || slotImplementation == null || beaconAddress != null) throw new TypeError("EIP-1967 implementation-slot shape is incomplete or ambiguous");
      if (expectedImplementationAddress && slotImplementation !== expectedImplementationAddress) throw new TypeError("EIP-1967 implementation differs from the reviewed current implementation");
      return { address: root, expectedProxyType, complete: true, reason: "complete", runtime,
        implementation: await exactCode(rpc, source, slotImplementation, blockTag), beacon: null };
    }
    if (expectedProxyType === "eip1967_beacon") {
      if (cloneImplementation != null || slotImplementation != null || beaconAddress == null) throw new TypeError("EIP-1967 beacon-slot shape is incomplete or ambiguous");
      const beacon = await exactCode(rpc, source, beaconAddress, blockTag);
      const beaconImplementationWord = await rpc(source, "eth_getStorageAt", [beaconAddress, "0x0", blockTag]);
      const beaconImplementation = wordAddress(beaconImplementationWord);
      if (beaconImplementation == null) throw new TypeError("beacon slot zero does not expose a standard implementation address");
      if (expectedImplementationAddress && beaconImplementation !== expectedImplementationAddress) {
        throw new TypeError("storage-only beacon resolution differs from the reviewed current implementation");
      }
      return { address: root, expectedProxyType, complete: true, reason: "complete", runtime,
        implementation: await exactCode(rpc, source, beaconImplementation, blockTag), beacon };
    }
    if (cloneImplementation != null || slotImplementation != null || beaconAddress != null) {
      throw new TypeError("direct contract expectation disagrees with a recognized proxy shape");
    }
    return { address: root, expectedProxyType, complete: true, reason: "complete", runtime,
      implementation: null, beacon: null };
  } catch (error) {
    return { address: root, expectedProxyType, complete: false, reason: error.message, runtime,
      implementation: null, beacon: beaconAddress == null ? null : { address: beaconAddress } };
  }
}

function identityRoot(root) {
  return { address: root.address, proxyType: root.expectedProxyType, runtime: root.runtime?.code ?? null,
    implementation: root.implementation == null ? null : { address: root.implementation.address, code: root.implementation.code },
    beacon: root.beacon == null ? null : { address: root.beacon.address, code: root.beacon.code ?? null } };
}

async function observeAtBlock(rpc, candidate, block) {
  const blockTag = hexQuantity(block);
  const rawBlock = await rpc(candidate.rpcUrl, "eth_getBlockByNumber", [blockTag, false]);
  if (rawBlock == null || BigInt(rawBlock.number ?? "-1") !== block || !HASH.test(rawBlock.hash ?? "")
    || typeof rawBlock.timestamp !== "string") throw new TypeError(`${candidate.chain} block ${block} metadata is malformed`);
  const timestamp = BigInt(rawBlock.timestamp);
  const roots = [];
  for (const root of candidate.roots) {
    roots.push(await observeRoot(rpc, candidate.rpcUrl, root.address, root.expectedProxyType,
      root.expectedImplementationAddress, blockTag));
  }
  const complete = roots.every((root) => root.complete);
  const identity = complete ? digest({ type: "FixedBlockEvmContractSetIdentity", chain: candidate.chain,
    roots: roots.map(identityRoot) }) : null;
  return { block: block.toString(), blockHash: rawBlock.hash.toLowerCase(), timestamp: timestamp.toString(),
    sourceUrl: candidate.rpcUrl, complete, identity, roots };
}

function normalizeCandidate(raw, index) {
  const name = `candidates[${index}]`;
  const value = object(name, raw);
  const chain = text(`${name}.chain`, value.chain, /^eip155:(8453|42161)$/u);
  const rpcUrl = validateSource(chain, value.rpcUrl);
  const baselineBlock = decimal(`${name}.baselineBlock`, value.baselineBlock);
  const currentBlock = decimal(`${name}.currentBlock`, value.currentBlock);
  if (baselineBlock === 0n || currentBlock <= baselineBlock) throw new TypeError(`${name} block order is invalid`);
  if (!Array.isArray(value.roots) || value.roots.length < 1 || value.roots.length > 4) throw new TypeError(`${name}.roots must be bounded`);
  const roots = value.roots.map((rawRoot, rootIndex) => {
    const root = object(`${name}.roots[${rootIndex}]`, rawRoot);
    const expectedProxyType = text(`${name}.roots[${rootIndex}].expectedProxyType`, root.expectedProxyType);
    if (!PROXY_TYPES.has(expectedProxyType)) throw new TypeError(`${name}.roots[${rootIndex}] proxy type is unsupported`);
    const expectedImplementationAddress = root.expectedImplementationAddress == null ? null
      : address(`${name}.roots[${rootIndex}].expectedImplementationAddress`, root.expectedImplementationAddress);
    if (expectedProxyType !== "direct" && expectedImplementationAddress == null) {
      throw new TypeError(`${name}.roots[${rootIndex}] proxy requires the reviewed current implementation address`);
    }
    return { address: address(`${name}.roots[${rootIndex}].address`, root.address), expectedProxyType,
      expectedImplementationAddress };
  }).sort((left, right) => left.address.localeCompare(right.address));
  if (new Set(roots.map((root) => root.address)).size !== roots.length) throw new TypeError(`${name}.roots contain duplicates`);
  return { candidateId: text(`${name}.candidateId`, value.candidateId, /^[a-z0-9][a-z0-9-]{1,127}$/u),
    chain, rpcUrl, baselineBlock, currentBlock, roots };
}

export async function observeFixedBlockContractIdentities(rawInput, options = {}) {
  const input = object("input", rawInput);
  if (input.profile !== PROFILE) throw new TypeError(`profile must equal ${PROFILE}`);
  assertAuthority(input.authority);
  if (!Array.isArray(input.candidates) || input.candidates.length < 1 || input.candidates.length > 64) {
    throw new TypeError("candidates must contain one through sixty-four entries");
  }
  const candidates = input.candidates.map(normalizeCandidate);
  if (new Set(candidates.map(({ candidateId }) => candidateId)).size !== candidates.length) throw new TypeError("candidate identifiers must be unique");
  const rawRpc = options.rpc ?? ((url, method, params) => jsonRpcPublicRead(url, method, params, options.fetchImpl));
  const rpcCache = new Map();
  const rpc = (url, method, params) => {
    const key = JSON.stringify([url, method, params]);
    if (!rpcCache.has(key)) rpcCache.set(key, rawRpc(url, method, params));
    return rpcCache.get(key);
  };
  const observations = [];
  for (const candidate of candidates.sort((left, right) => left.candidateId.localeCompare(right.candidateId))) {
    const chainId = BigInt(await rpc(candidate.rpcUrl, "eth_chainId", []));
    if (`eip155:${chainId}` !== candidate.chain) throw new TypeError(`${candidate.candidateId} RPC chain identity mismatch`);
    const baseline = await observeAtBlock(rpc, candidate, candidate.baselineBlock);
    const current = await observeAtBlock(rpc, candidate, candidate.currentBlock);
    const comparisonComplete = baseline.complete && current.complete;
    observations.push({ candidateId: candidate.candidateId, chain: candidate.chain, baseline, current,
      comparisonComplete, unchanged: comparisonComplete && baseline.identity === current.identity,
      reason: !comparisonComplete ? "one or both fixed-block identities are incomplete"
        : baseline.identity === current.identity ? "complete identities are equal" : "complete identities differ" });
  }
  const result = { profile: PROFILE,
    requestDigest: digest(input),
    outcome: "completed-fixed-block-contract-identity-observation",
    candidateCount: String(observations.length), comparisonCompleteCount: String(observations.filter((x) => x.comparisonComplete).length),
    unchangedCount: String(observations.filter((x) => x.unchanged).length), candidates: observations,
    gate: { publicEvidenceOnly: true, calldata: false, transactionAssembly: false, signing: false,
      broadcast: false, chainMutation: false, executionAdmitted: false } };
  return { id: digest(result), ...result };
}

export async function recordFixedBlockContractIdentityObservation(input, result, options = {}) {
  const { id, ...body } = result ?? {};
  if (result?.profile !== PROFILE
    || result?.requestDigest !== digest(input) || id !== digest(body)) {
    throw new TypeError("a valid request-bound fixed-block identity observation is required");
  }
  const recordedAt = options.recordedAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(recordedAt))) throw new TypeError("recordedAt must be an ISO timestamp");
  const record = { type: "FixedBlockContractIdentityObservationRecord", owner: ACTOR,
    observation: result, evidenceInput: serializable(input), recordedAt, decisionBoundary: result.gate };
  const projection = await (options.record ?? ((request) => recordSettlementRecord({
    agentUrl: options.agentUrl ?? process.env.WITNESS_JOURNAL_RDF_AGENT, settlement: SETTLEMENT, actor: ACTOR, ...request,
  })))({ category: RECORD_CATEGORY, recordedAt, record });
  return { result, record, projection };
}

export const FIXED_BLOCK_CONTRACT_IDENTITY_PROFILE = PROFILE;
export const FIXED_BLOCK_CONTRACT_IDENTITY_RECORD_CATEGORY = RECORD_CATEGORY;
export const FIXED_BLOCK_CONTRACT_IDENTITY_ALLOWED_METHODS = ALLOWED_METHODS;

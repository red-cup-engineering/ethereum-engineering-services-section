import { EMPTY_WITNESS_ROOT, identifyJsonSemanticContent } from "@red-cup-engineering/computer-data-engineering-services-section/semiotic-expression-notation/semantic-content-identity";
const semanticDigest = (objectKind, value) => identifyJsonSemanticContent({ objectKind, value, witnessRoot: EMPTY_WITNESS_ROOT }).token;

export const ENGINE_SPEC = Object.freeze({
  type: "BlockchainTrashpandaPolicyEngine",
  version: 2,
  operation: "evaluateBasePreSignPolicy",
  determinism: "sen-semantic-v1",
  evidenceAssurance: "customer-declared-unverified",
  verdictPrecedence: Object.freeze(["FAIL", "ESCALATE", "PASS"]),
});

/** One working `BasePreSignConformanceRequest`, admitted by its own policy; the discovery example and test fixture. */
export const X402_SAMPLE_REQUEST = Object.freeze({
  type: "BasePreSignConformanceRequest",
  version: 1,
  transaction: Object.freeze({ type: "UnsignedBaseTransaction", chainId: 8453, sender: "0x1111111111111111111111111111111111111111", to: "0x2222222222222222222222222222222222222222", valueWei: "0", data: "0x", gasLimit: "21000", nonce: "0" }),
  policy: Object.freeze({ type: "BasePreSignPolicy", version: 1, clauses: Object.freeze([Object.freeze({ id: "a-chain", type: "ChainIdEquals", chainId: 8453 })]) }),
  anchor: Object.freeze({ type: "ImmutableBaseBlockAnchor", chainId: 8453, blockNumber: "1", blockHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }),
  evidence: Object.freeze([]),
  receiptProfile: "full-v1",
});

const REQUEST_KEYS = ["type", "version", "transaction", "policy", "anchor", "evidence", "receiptProfile"];
const TRANSACTION_KEYS = ["type", "chainId", "sender", "to", "valueWei", "data", "gasLimit", "nonce"];
const POLICY_KEYS = ["type", "version", "clauses"];
const ANCHOR_KEYS = ["type", "chainId", "blockNumber", "blockHash"];
const EVIDENCE_KEYS = ["id", "type", "blockHash", "source", "value"];
const FORBIDDEN_KEYS = new Set([
  "mnemonic", "seedphrase", "recoveryphrase", "privatekey", "secret", "credential", "credentials",
  "signature", "signedtransaction", "rawtransaction", "custody", "custodygrant", "sign", "signinggrant",
  "broadcast", "broadcastgrant", "sendtransaction", "walletconnecturi",
]);
const ADDRESS = /^0x[0-9a-f]{40}$/u;
const HASH = /^0x[0-9a-f]{64}$/u;
const DATA = /^0x(?:[0-9a-f]{2})*$/u;
const SELECTOR = /^0x(?:[0-9a-f]{8})?$/u;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
const IDENTIFIER = /^[a-z][a-z0-9-]{0,63}$/u;
const BASE_CHAINS = new Set([8453, 84532]);
const MAX_UINT256 = (1n << 256n) - 1n;
export const LIMITS = Object.freeze({ clauses: 64, evidence: 64, listEntries: 64, calldataBytes: 65536, sourceCharacters: 512, scalarCharacters: 1024, scanNodes: 4096, scanDepth: 32 });

export class PolicyConformanceRefusal extends TypeError {
  constructor(code, message, path = "$") {
    super(message);
    this.name = "PolicyConformanceRefusal";
    this.code = code;
    this.path = path;
  }
}

export { semanticDigest };

function refuse(code, message, path) {
  throw new PolicyConformanceRefusal(code, message, path);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value, path) {
  if (!isRecord(value)) refuse("malformed-input", `${path} must be an object`, path);
}

function requireExactKeys(value, keys, path) {
  requireRecord(value, path);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.join("\0") !== expected.join("\0")) {
    refuse("noncanonical-shape", `${path} must contain exactly: ${expected.join(", ")}`, path);
  }
}

function scanForbidden(value, path = "$", state = { nodes: 0, seen: new WeakSet() }, depth = 0) {
  if (depth > LIMITS.scanDepth || ++state.nodes > LIMITS.scanNodes) refuse("resource-limit", "request exceeds structural scan limits", path);
  if (isRecord(value) || Array.isArray(value)) {
    if (state.seen.has(value)) refuse("nondeterministic-input", "request contains a cyclic reference", path);
    state.seen.add(value);
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => scanForbidden(entry, `${path}[${index}]`, state, depth + 1));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    const normalized = key.replace(/[^a-z]/giu, "").toLowerCase();
    if (FORBIDDEN_KEYS.has(normalized)) {
      refuse("forbidden-authority", `request contains forbidden field '${key}'`, `${path}.${key}`);
    }
    scanForbidden(entry, `${path}.${key}`, state, depth + 1);
  }
}

function requireString(value, pattern, path) {
  if (typeof value !== "string" || !pattern.test(value)) refuse("malformed-input", `${path} is not canonical`, path);
  return value;
}

function requireInteger(value, path) {
  if (!Number.isSafeInteger(value) || value < 0) refuse("malformed-input", `${path} must be a non-negative safe integer`, path);
  return value;
}

function requireDecimal(value, path) {
  requireString(value, DECIMAL, path);
  if (value.length > 78 || BigInt(value) > MAX_UINT256) refuse("resource-limit", `${path} exceeds uint256`, path);
  return value;
}

function requireDeterministicScalar(value, path) {
  if (!["string", "number", "boolean"].includes(typeof value)
      || (typeof value === "number" && (!Number.isSafeInteger(value) || Object.is(value, -0)))
      || (typeof value === "string" && value.length > LIMITS.scalarCharacters)) {
    refuse("nondeterministic-input", `${path} must be a bounded string, boolean, or canonical safe integer`, path);
  }
  return value;
}

function compareDecimal(left, right) {
  const a = BigInt(left), b = BigInt(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function normalizeTransaction(transaction) {
  requireExactKeys(transaction, TRANSACTION_KEYS, "$.transaction");
  if (transaction.type !== "UnsignedBaseTransaction") refuse("malformed-input", "unsupported transaction type", "$.transaction.type");
  requireInteger(transaction.chainId, "$.transaction.chainId");
  if (!BASE_CHAINS.has(transaction.chainId)) refuse("unsupported-chain", "only Base and Base Sepolia are supported", "$.transaction.chainId");
  requireString(transaction.sender, ADDRESS, "$.transaction.sender");
  requireString(transaction.to, ADDRESS, "$.transaction.to");
  requireDecimal(transaction.valueWei, "$.transaction.valueWei");
  requireString(transaction.data, DATA, "$.transaction.data");
  if ((transaction.data.length - 2) / 2 > LIMITS.calldataBytes) refuse("resource-limit", "calldata exceeds product limit", "$.transaction.data");
  requireDecimal(transaction.gasLimit, "$.transaction.gasLimit");
  requireDecimal(transaction.nonce, "$.transaction.nonce");
  return Object.freeze({ type: transaction.type, chainId: transaction.chainId, sender: transaction.sender, to: transaction.to,
    valueWei: transaction.valueWei, data: transaction.data, gasLimit: transaction.gasLimit, nonce: transaction.nonce });
}

function normalizeAnchor(anchor, chainId) {
  requireExactKeys(anchor, ANCHOR_KEYS, "$.anchor");
  if (anchor.type !== "ImmutableBaseBlockAnchor") refuse("mutable-anchor", "anchor must be immutable", "$.anchor.type");
  requireInteger(anchor.chainId, "$.anchor.chainId");
  if (anchor.chainId !== chainId || !BASE_CHAINS.has(anchor.chainId)) refuse("anchor-mismatch", "anchor chain must equal transaction chain", "$.anchor.chainId");
  requireDecimal(anchor.blockNumber, "$.anchor.blockNumber");
  requireString(anchor.blockHash, HASH, "$.anchor.blockHash");
  return Object.freeze({ type: anchor.type, chainId: anchor.chainId, blockNumber: anchor.blockNumber, blockHash: anchor.blockHash });
}

function normalizeEvidence(evidence, blockHash) {
  if (!Array.isArray(evidence)) refuse("malformed-input", "$.evidence must be an array", "$.evidence");
  if (evidence.length > LIMITS.evidence) refuse("resource-limit", "too many evidence observations", "$.evidence");
  const seen = new Set();
  const normalized = evidence.map((item, index) => {
    const path = `$.evidence[${index}]`;
    requireExactKeys(item, EVIDENCE_KEYS, path);
    requireString(item.id, IDENTIFIER, `${path}.id`);
    if (seen.has(item.id)) refuse("malformed-input", "evidence ids must be unique", `${path}.id`);
    seen.add(item.id);
    if (item.type !== "CustomerDeclaredBlockBoundObservation") refuse("malformed-input", "only explicitly unverified customer-declared evidence is supported", `${path}.type`);
    if (item.blockHash !== blockHash) refuse("mutable-evidence", "evidence must bind to the exact anchor block hash", `${path}.blockHash`);
    if (typeof item.source !== "string" || item.source.length === 0 || item.source.length > LIMITS.sourceCharacters
        || !/^[a-z][a-z0-9+.-]*:\S+$/iu.test(item.source)) refuse("malformed-input", "evidence source must be a bounded absolute URI", `${path}.source`);
    requireDeterministicScalar(item.value, `${path}.value`);
    return Object.freeze({ id: item.id, type: item.type, blockHash: item.blockHash, source: item.source, value: item.value });
  });
  const ids = normalized.map((item) => item.id);
  if (ids.join("\0") !== [...ids].sort().join("\0")) refuse("noncanonical-order", "evidence must be sorted by id", "$.evidence");
  return Object.freeze(normalized);
}

function normalizeAddresses(value, path) {
  if (!Array.isArray(value) || value.length === 0) refuse("malformed-policy", `${path} must be a non-empty array`, path);
  if (value.length > LIMITS.listEntries) refuse("resource-limit", `${path} exceeds the list limit`, path);
  value.forEach((address, index) => requireString(address, ADDRESS, `${path}[${index}]`));
  if (new Set(value).size !== value.length || value.join("\0") !== [...value].sort().join("\0")) {
    refuse("noncanonical-order", `${path} must be unique and sorted`, path);
  }
  return Object.freeze([...value]);
}

function normalizeSelectors(value, path) {
  if (!Array.isArray(value) || value.length === 0) refuse("malformed-policy", `${path} must be a non-empty array`, path);
  if (value.length > LIMITS.listEntries) refuse("resource-limit", `${path} exceeds the list limit`, path);
  value.forEach((selector, index) => requireString(selector, SELECTOR, `${path}[${index}]`));
  if (new Set(value).size !== value.length || value.join("\0") !== [...value].sort().join("\0")) {
    refuse("noncanonical-order", `${path} must be unique and sorted`, path);
  }
  return Object.freeze([...value]);
}

function normalizeClause(clause, index) {
  const path = `$.policy.clauses[${index}]`;
  requireRecord(clause, path);
  requireString(clause.id, IDENTIFIER, `${path}.id`);
  switch (clause.type) {
    case "ChainIdEquals":
      requireExactKeys(clause, ["id", "type", "chainId"], path);
      requireInteger(clause.chainId, `${path}.chainId`);
      if (!BASE_CHAINS.has(clause.chainId)) refuse("malformed-policy", "policy chain must be Base", `${path}.chainId`);
      return Object.freeze({ id: clause.id, type: clause.type, chainId: clause.chainId });
    case "DestinationIn":
    case "DestinationNotIn":
      requireExactKeys(clause, ["id", "type", "addresses"], path);
      return Object.freeze({ id: clause.id, type: clause.type, addresses: normalizeAddresses(clause.addresses, `${path}.addresses`) });
    case "NativeValueAtMost":
      requireExactKeys(clause, ["id", "type", "wei"], path);
      requireDecimal(clause.wei, `${path}.wei`);
      return Object.freeze({ id: clause.id, type: clause.type, wei: clause.wei });
    case "SelectorIn":
      requireExactKeys(clause, ["id", "type", "selectors"], path);
      return Object.freeze({ id: clause.id, type: clause.type, selectors: normalizeSelectors(clause.selectors, `${path}.selectors`) });
    case "GasLimitAtMost":
      requireExactKeys(clause, ["id", "type", "gas"], path);
      requireDecimal(clause.gas, `${path}.gas`);
      return Object.freeze({ id: clause.id, type: clause.type, gas: clause.gas });
    case "EvidenceEquals":
      requireExactKeys(clause, ["id", "type", "evidenceId", "expected"], path);
      requireString(clause.evidenceId, IDENTIFIER, `${path}.evidenceId`);
      requireDeterministicScalar(clause.expected, `${path}.expected`);
      return Object.freeze({ id: clause.id, type: clause.type, evidenceId: clause.evidenceId, expected: clause.expected });
    default:
      refuse("unsupported-clause", `unsupported clause type '${clause.type ?? ""}'`, `${path}.type`);
  }
}

function normalizePolicy(policy) {
  requireExactKeys(policy, POLICY_KEYS, "$.policy");
  if (policy.type !== "BasePreSignPolicy" || policy.version !== 1) refuse("malformed-policy", "unsupported policy type or version", "$.policy");
  if (!Array.isArray(policy.clauses) || policy.clauses.length === 0) refuse("malformed-policy", "policy requires at least one clause", "$.policy.clauses");
  if (policy.clauses.length > LIMITS.clauses) refuse("resource-limit", "policy exceeds the clause limit", "$.policy.clauses");
  const clauses = policy.clauses.map(normalizeClause);
  const ids = clauses.map((clause) => clause.id);
  if (new Set(ids).size !== ids.length || ids.join("\0") !== [...ids].sort().join("\0")) {
    refuse("noncanonical-order", "clauses must have unique ids and be sorted by id", "$.policy.clauses");
  }
  return Object.freeze({ type: policy.type, version: policy.version, clauses: Object.freeze(clauses) });
}

function selectorOf(data) {
  if (data === "0x") return "0x";
  return data.length >= 10 ? data.slice(0, 10) : null;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function disposition(clause, transaction, evidenceById) {
  let passed, actual, expected, references = [];
  switch (clause.type) {
    case "ChainIdEquals": actual = transaction.chainId; expected = clause.chainId; passed = actual === expected; break;
    case "DestinationIn": actual = transaction.to; expected = clause.addresses; passed = clause.addresses.includes(actual); break;
    case "DestinationNotIn": actual = transaction.to; expected = clause.addresses; passed = !clause.addresses.includes(actual); break;
    case "NativeValueAtMost": actual = transaction.valueWei; expected = clause.wei; passed = compareDecimal(actual, expected) <= 0; break;
    case "SelectorIn": actual = selectorOf(transaction.data); expected = clause.selectors; passed = clause.selectors.includes(actual); break;
    case "GasLimitAtMost": actual = transaction.gasLimit; expected = clause.gas; passed = compareDecimal(actual, expected) <= 0; break;
    case "EvidenceEquals": {
      const evidence = evidenceById.get(clause.evidenceId);
      expected = clause.expected;
      if (!evidence) return { clauseId: clause.id, clauseType: clause.type, disposition: "ESCALATE", actual: null, expected, evidenceReferences: [] };
      actual = evidence.value;
      references = [semanticDigest("blockchain-trashpanda.policy-evidence", evidence)];
      passed = Object.is(actual, expected);
      break;
    }
  }
  return { clauseId: clause.id, clauseType: clause.type, disposition: passed ? "PASS" : "FAIL", actual, expected, evidenceReferences: references };
}

export function normalizeRequest(request) {
  requireRecord(request, "$");
  scanForbidden(request);
  requireExactKeys(request, REQUEST_KEYS, "$");
  if (request.type !== "BasePreSignConformanceRequest" || request.version !== 1) refuse("malformed-input", "unsupported request type or version", "$");
  if (request.receiptProfile !== "full-v1") refuse("unsupported-profile", "only full-v1 receipts are supported", "$.receiptProfile");
  const transaction = normalizeTransaction(request.transaction);
  const anchor = normalizeAnchor(request.anchor, transaction.chainId);
  const evidence = normalizeEvidence(request.evidence, anchor.blockHash);
  const policy = normalizePolicy(request.policy);
  return Object.freeze({ type: request.type, version: request.version, transaction, policy, anchor, evidence, receiptProfile: request.receiptProfile });
}

export function evaluateBasePreSignPolicy(request) {
  const normalized = normalizeRequest(request);
  const evidenceById = new Map(normalized.evidence.map((item) => [item.id, item]));
  const clauseResults = normalized.policy.clauses.map((clause) => disposition(clause, normalized.transaction, evidenceById));
  const verdict = clauseResults.some((result) => result.disposition === "FAIL") ? "FAIL"
    : clauseResults.some((result) => result.disposition === "ESCALATE") ? "ESCALATE" : "PASS";
  const evidenceReferences = [...new Set(clauseResults.flatMap((result) => result.evidenceReferences))].sort();
  const engineId = semanticDigest("blockchain-trashpanda.pre-sign-policy-engine", { specification: ENGINE_SPEC });
  const body = {
    type: "BasePreSignPolicyConformanceReceipt",
    version: 1,
    requestDigest: semanticDigest("blockchain-trashpanda.pre-sign-policy-request", normalized),
    transactionDigest: semanticDigest("blockchain-trashpanda.transaction", normalized.transaction),
    policyDigest: semanticDigest("blockchain-trashpanda.pre-sign-policy", normalized.policy),
    chain: { caip2: `eip155:${normalized.transaction.chainId}`, chainId: normalized.transaction.chainId },
    block: { number: normalized.anchor.blockNumber, hash: normalized.anchor.blockHash },
    anchorAssurance: "customer-declared-unverified",
    engine: { id: engineId, version: ENGINE_SPEC.version },
    clauseResults,
    verdict,
    evidenceReferences,
    evidenceAssurance: "customer-declared-unverified",
    replay: {
      operation: ENGINE_SPEC.operation,
      engineId,
      module: "@red-cup-engineering/blockchain-trashpanda@0.1.0",
      export: "evaluateBasePreSignPolicy",
      runtime: "node>=22.18",
      normalizedRequest: normalized,
      expectedReceiptProfile: "full-v1",
    },
    forbiddenEffects: { credentials: false, custody: false, signing: false, broadcast: false, stateMutation: false },
  };
  return deepFreeze({ id: semanticDigest("blockchain-trashpanda.pre-sign-policy-decision", body), ...body });
}

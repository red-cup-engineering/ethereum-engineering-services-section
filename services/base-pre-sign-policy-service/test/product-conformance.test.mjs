import assert from "node:assert/strict";
import test from "node:test";
import { ENGINE_SPEC, evaluateBasePreSignPolicy, LIMITS, normalizeRequest, PolicyConformanceRefusal, semanticDigest } from "../src/policy-conformance.mjs";
import { PRODUCT_CORPUS } from "../src/product-corpus.mjs";

const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
const C = "0x3333333333333333333333333333333333333333";
const H = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function request(overrides = {}) {
  const value = {
    type: "BasePreSignConformanceRequest",
    version: 1,
    transaction: { type: "UnsignedBaseTransaction", chainId: 84532, sender: A, to: B, valueWei: "100", data: "0xa9059cbb", gasLimit: "80000", nonce: "7" },
    policy: {
      type: "BasePreSignPolicy",
      version: 1,
      clauses: [
        { id: "a-chain", type: "ChainIdEquals", chainId: 84532 },
        { id: "b-destination", type: "DestinationIn", addresses: [B, C] },
        { id: "c-deny", type: "DestinationNotIn", addresses: [C] },
        { id: "d-gas", type: "GasLimitAtMost", gas: "100000" },
        { id: "e-selector", type: "SelectorIn", selectors: ["0xa9059cbb"] },
        { id: "f-value", type: "NativeValueAtMost", wei: "100" },
        { id: "g-screen", type: "EvidenceEquals", evidenceId: "sanctions-screen", expected: true },
      ],
    },
    anchor: { type: "ImmutableBaseBlockAnchor", chainId: 84532, blockNumber: "123456", blockHash: H },
    evidence: [{ id: "sanctions-screen", type: "CustomerDeclaredBlockBoundObservation", blockHash: H, source: "urn:test:screen:v1", value: true }],
    receiptProfile: "full-v1",
  };
  return structuredClone(Object.assign(value, overrides));
}

function expectRefusal(value, code) {
  assert.throws(() => evaluateBasePreSignPolicy(value), (error) => error instanceof PolicyConformanceRefusal && error.code === code);
}

test("PASS receipt is content-valid, complete, and byte-identical over three replays", () => {
  const input = request();
  const receipts = Array.from({ length: 3 }, () => evaluateBasePreSignPolicy(structuredClone(input)));
  assert.equal(receipts[0].verdict, "PASS");
  assert.equal(receipts[0].clauseResults.length, 7);
  assert.ok(receipts[0].clauseResults.every((entry) => entry.disposition === "PASS"));
  assert.equal(new Set(receipts.map(JSON.stringify)).size, 1);
  assert.equal(receipts[0].anchorAssurance, "customer-declared-unverified");
  assert.equal(receipts[0].evidenceAssurance, "customer-declared-unverified");
  const { id, ...body } = receipts[0];
  assert.equal(id, semanticDigest("blockchain-trashpanda.pre-sign-policy-decision", body));
  assert.deepEqual(receipts[0].forbiddenEffects, { credentials: false, custody: false, signing: false, broadcast: false, stateMutation: false });
  assert.equal(receipts[0].replay.export, "evaluateBasePreSignPolicy");
  assert.deepEqual(evaluateBasePreSignPolicy(receipts[0].replay.normalizedRequest), receipts[0]);
});

test("FAIL dominates ESCALATE and reports every clause", () => {
  const input = request();
  input.transaction.valueWei = "101";
  input.evidence = [];
  const receipt = evaluateBasePreSignPolicy(input);
  assert.equal(receipt.verdict, "FAIL");
  assert.equal(receipt.clauseResults.find((entry) => entry.clauseId === "f-value").disposition, "FAIL");
  assert.equal(receipt.clauseResults.find((entry) => entry.clauseId === "g-screen").disposition, "ESCALATE");
});

test("missing evidence yields ESCALATE when no clause fails", () => {
  const input = request();
  input.evidence = [];
  assert.equal(evaluateBasePreSignPolicy(input).verdict, "ESCALATE");
});

test("boundary values and empty calldata use exact deterministic semantics", () => {
  const input = request();
  input.transaction.data = "0x";
  input.policy.clauses[4].selectors = ["0x"];
  assert.equal(evaluateBasePreSignPolicy(input).verdict, "PASS");
  input.transaction.data = "0x01";
  assert.equal(evaluateBasePreSignPolicy(input).verdict, "FAIL");
});

test("structurally refuses secrets, signatures, and authority even when nested", () => {
  for (const forbidden of ["mnemonic", "privateKey", "signature", "signedTransaction", "custodyGrant", "signingGrant", "broadcastGrant"]) {
    const input = request();
    input.policy.clauses[0].metadata = { [forbidden]: false };
    expectRefusal(input, "forbidden-authority");
  }
});

test("refuses unsupported chains and mutable or mismatched anchors", () => {
  const unsupported = request();
  unsupported.transaction.chainId = 1;
  unsupported.anchor.chainId = 1;
  expectRefusal(unsupported, "unsupported-chain");
  const mutable = request();
  mutable.anchor.type = "LatestBlockTag";
  expectRefusal(mutable, "mutable-anchor");
  const mismatch = request();
  mismatch.anchor.chainId = 8453;
  expectRefusal(mismatch, "anchor-mismatch");
});

test("refuses noncanonical quantities, addresses, hex, ordering, and duplicates", () => {
  const cases = [];
  const decimal = request(); decimal.transaction.valueWei = "0100"; cases.push([decimal, "malformed-input"]);
  const address = request(); address.transaction.to = address.transaction.to.toUpperCase(); cases.push([address, "malformed-input"]);
  const data = request(); data.transaction.data = "0xabc"; cases.push([data, "malformed-input"]);
  const clauseOrder = request(); clauseOrder.policy.clauses.reverse(); cases.push([clauseOrder, "noncanonical-order"]);
  const duplicate = request(); duplicate.policy.clauses[1].id = duplicate.policy.clauses[0].id; cases.push([duplicate, "noncanonical-order"]);
  const evidenceOrder = request(); evidenceOrder.evidence.unshift({ id: "z-observation", type: "CustomerDeclaredBlockBoundObservation", blockHash: H, source: "urn:test:z", value: 1 }); cases.push([evidenceOrder, "noncanonical-order"]);
  for (const [input, code] of cases) expectRefusal(input, code);
});

test("refuses unknown clauses, wrong profiles, nondeterministic evidence, and extra fields", () => {
  const clause = request(); clause.policy.clauses[0] = { id: "a-chain", type: "ExecuteJavascript", source: "return true" }; expectRefusal(clause, "unsupported-clause");
  const profile = request(); profile.receiptProfile = "compact"; expectRefusal(profile, "unsupported-profile");
  const evidence = request(); evidence.evidence[0].value = 1.5; expectRefusal(evidence, "nondeterministic-input");
  const extra = request(); extra.transaction.maxFeePerGas = "1"; expectRefusal(extra, "noncanonical-shape");
});

test("normalization does not mutate customer input", () => {
  const input = request(), before = structuredClone(input);
  normalizeRequest(input);
  assert.deepEqual(input, before);
});

test("refuses negative zero before semantic identity can collapse it to zero", () => {
  const evidence = request(); evidence.evidence[0].value = -0; expectRefusal(evidence, "nondeterministic-input");
  const policy = request(); policy.policy.clauses[6].expected = -0; expectRefusal(policy, "nondeterministic-input");
});

test("every admitted primitive replays identically across a JSON round trip", () => {
  for (const value of [false, true, 0, 1, Number.MAX_SAFE_INTEGER, "public-observation"]) {
    const input = request();
    input.evidence[0].value = value;
    input.policy.clauses[6].expected = value;
    const before = evaluateBasePreSignPolicy(input);
    const after = evaluateBasePreSignPolicy(JSON.parse(JSON.stringify(before.replay.normalizedRequest)));
    assert.deepEqual(after, before, String(value));
  }
});

test("canonicalization removes caller object-key insertion order", () => {
  function reversed(value) {
    if (Array.isArray(value)) return value.map(reversed);
    if (value === null || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reversed(child)]));
  }
  const canonical = evaluateBasePreSignPolicy(request());
  const reordered = evaluateBasePreSignPolicy(reversed(request()));
  assert.equal(JSON.stringify(reordered), JSON.stringify(canonical));
});

test("receipt is deeply immutable after its content id is established", () => {
  const receipt = evaluateBasePreSignPolicy(request());
  assert.throws(() => { receipt.block.hash = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"; }, TypeError);
  assert.throws(() => { receipt.clauseResults[0].disposition = "FAIL"; }, TypeError);
  assert.throws(() => { receipt.replay.normalizedRequest.policy.clauses.pop(); }, TypeError);
});

test("exported engine specification cannot be mutated between evaluations", () => {
  const before = evaluateBasePreSignPolicy(request());
  assert.throws(() => { ENGINE_SPEC.verdictPrecedence.push("MUTATED"); }, TypeError);
  assert.throws(() => { ENGINE_SPEC.version = 999; }, TypeError);
  assert.deepEqual(evaluateBasePreSignPolicy(request()), before);
});

test("enforces explicit computation and input-size ceilings", () => {
  const clauses = request();
  clauses.policy.clauses = Array.from({ length: LIMITS.clauses + 1 }, (_, index) => ({ id: `x-${String(index).padStart(2, "0")}`, type: "GasLimitAtMost", gas: "1" }));
  expectRefusal(clauses, "resource-limit");
  const evidence = request();
  evidence.evidence = Array.from({ length: LIMITS.evidence + 1 }, (_, index) => ({ id: `x-${String(index).padStart(2, "0")}`, type: "CustomerDeclaredBlockBoundObservation", blockHash: H, source: `urn:test:${index}`, value: true }));
  expectRefusal(evidence, "resource-limit");
  const calldata = request(); calldata.transaction.data = `0x${"00".repeat(LIMITS.calldataBytes + 1)}`; expectRefusal(calldata, "resource-limit");
  const integer = request(); integer.transaction.valueWei = String(1n << 256n); expectRefusal(integer, "resource-limit");
});

test("mandatory product corpus matches every expected receipt or refusal", () => {
  for (const entry of PRODUCT_CORPUS) {
    if (entry.expected.kind === "receipt") {
      assert.equal(evaluateBasePreSignPolicy(structuredClone(entry.request)).verdict, entry.expected.verdict, entry.id);
    } else {
      assert.throws(() => evaluateBasePreSignPolicy(structuredClone(entry.request)),
        (error) => error instanceof PolicyConformanceRefusal && error.code === entry.expected.code, entry.id);
    }
  }
});

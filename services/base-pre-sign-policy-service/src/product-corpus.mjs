const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
const C = "0x3333333333333333333333333333333333333333";
const H = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

export function baseProductRequest() {
  return {
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
}

function mutate(id, expected, change) {
  const request = baseProductRequest();
  change(request);
  return Object.freeze({ id, expected: Object.freeze(expected), request });
}

export const PRODUCT_CORPUS = Object.freeze([
  mutate("pass-all-clauses", { kind: "receipt", verdict: "PASS" }, () => {}),
  mutate("fail-value-ceiling", { kind: "receipt", verdict: "FAIL" }, (request) => { request.transaction.valueWei = "101"; }),
  mutate("escalate-missing-observation", { kind: "receipt", verdict: "ESCALATE" }, (request) => { request.evidence = []; }),
  mutate("pass-empty-calldata-selector", { kind: "receipt", verdict: "PASS" }, (request) => {
    request.transaction.data = "0x";
    request.policy.clauses[4].selectors = ["0x"];
  }),
  mutate("fail-chain-clause", { kind: "receipt", verdict: "FAIL" }, (request) => { request.transaction.chainId = 8453; request.anchor.chainId = 8453; }),
  mutate("fail-destination-allowlist", { kind: "receipt", verdict: "FAIL" }, (request) => { request.transaction.to = A; }),
  mutate("fail-destination-denylist", { kind: "receipt", verdict: "FAIL" }, (request) => { request.transaction.to = C; }),
  mutate("fail-gas-ceiling", { kind: "receipt", verdict: "FAIL" }, (request) => { request.transaction.gasLimit = "100001"; }),
  mutate("fail-selector-allowlist", { kind: "receipt", verdict: "FAIL" }, (request) => { request.transaction.data = "0x01020304"; }),
  mutate("fail-evidence-value", { kind: "receipt", verdict: "FAIL" }, (request) => { request.evidence[0].value = false; }),
  mutate("fail-short-calldata-not-empty", { kind: "receipt", verdict: "FAIL" }, (request) => { request.transaction.data = "0x01"; request.policy.clauses[4].selectors = ["0x"]; }),
  mutate("refuse-private-key", { kind: "refusal", code: "forbidden-authority" }, (request) => { request.privateKey = "not-a-real-key"; }),
  mutate("refuse-signature", { kind: "refusal", code: "forbidden-authority" }, (request) => { request.signature = "0x"; }),
  mutate("refuse-signing-grant", { kind: "refusal", code: "forbidden-authority" }, (request) => { request.signingGrant = false; }),
  mutate("refuse-unsupported-chain", { kind: "refusal", code: "unsupported-chain" }, (request) => { request.transaction.chainId = 1; request.anchor.chainId = 1; }),
  mutate("refuse-mutable-anchor", { kind: "refusal", code: "mutable-anchor" }, (request) => { request.anchor.type = "LatestBlockTag"; }),
  mutate("refuse-anchor-mismatch", { kind: "refusal", code: "anchor-mismatch" }, (request) => { request.anchor.chainId = 8453; }),
  mutate("refuse-noncanonical-decimal", { kind: "refusal", code: "malformed-input" }, (request) => { request.transaction.valueWei = "0100"; }),
  mutate("refuse-unsorted-clauses", { kind: "refusal", code: "noncanonical-order" }, (request) => { request.policy.clauses.reverse(); }),
  mutate("refuse-unknown-clause", { kind: "refusal", code: "unsupported-clause" }, (request) => { request.policy.clauses[0] = { id: "a-chain", type: "ExecuteJavascript" }; }),
  mutate("refuse-unbound-evidence", { kind: "refusal", code: "mutable-evidence" }, (request) => { request.evidence[0].blockHash = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"; }),
  mutate("refuse-negative-zero-evidence", { kind: "refusal", code: "nondeterministic-input" }, (request) => { request.evidence[0].value = -0; }),
]);

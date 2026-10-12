import assert from "node:assert/strict";
import test from "node:test";

import { FIXED_BLOCK_CONTRACT_IDENTITY_ALLOWED_METHODS, observeFixedBlockContractIdentities,
  recordFixedBlockContractIdentityObservation } from "../src/fixed-block-contract-identity-observation.mjs";

const ROOT = "0x1111111111111111111111111111111111111111";
const IMPL = "0x2222222222222222222222222222222222222222";
const BEACON = "0x3333333333333333333333333333333333333333";
const OTHER = "0x4444444444444444444444444444444444444444";
const ZERO = `0x${"0".repeat(64)}`;
const word = (address) => `0x${"0".repeat(24)}${address.slice(2)}`;
const clone = (implementation) => `0x363d3d373d3d3d363d73${implementation.slice(2)}5af43d82803e903d91602b57fd5bf3`;

function input(expectedProxyType = "eip1167", expectedImplementationAddress = IMPL) {
  return { profile: "org.emsenn.evm.fixed-block-contract-identity-observation.v1", authority: {
    publicReadOnly: true, allowedRpcMethods: [...FIXED_BLOCK_CONTRACT_IDENTITY_ALLOWED_METHODS],
    signerMaterialPresent: false, calldata: false, transactionAssembly: false, signing: false,
    broadcast: false, chainMutation: false }, candidates: [{ candidateId: "test-contract", chain: "eip155:8453",
      rpcUrl: "https://mainnet.base.org/", baselineBlock: "100", currentBlock: "200",
      roots: [{ address: ROOT, expectedProxyType, expectedImplementationAddress }] }] };
}

function rpcFor({ rootCode = clone(IMPL), implementationWord = ZERO, beaconWord = ZERO,
  beaconImplementationWord = word(IMPL), currentImplCode = "0x6001", baselineImplCode = "0x6001" } = {}) {
  return async (_url, method, params) => {
    if (method === "eth_chainId") return "0x2105";
    if (method === "eth_getBlockByNumber") return { number: params[0],
      hash: `0x${(params[0] === "0x64" ? "a" : "b").repeat(64)}`,
      timestamp: params[0] === "0x64" ? "0x3e8" : "0x7d0" };
    const block = params.at(-1);
    if (method === "eth_getCode") {
      if (params[0] === ROOT) return rootCode;
      if (params[0] === IMPL) return block === "0x64" ? baselineImplCode : currentImplCode;
      if (params[0] === BEACON) return "0x6002";
      if (params[0] === OTHER) return "0x6003";
      throw new Error("unknown code address");
    }
    if (method === "eth_getStorageAt") {
      if (params[0] === BEACON && params[1] === "0x0") return beaconImplementationWord;
      if (params[1].startsWith("0x360894")) return implementationWord;
      if (params[1].startsWith("0xa3f0ad")) return beaconWord;
    }
    throw new Error(`unexpected ${method}`);
  };
}

test("proves unchanged exact EIP-1167 identities at two blocks", async () => {
  const result = await observeFixedBlockContractIdentities(input(), { rpc: rpcFor() });
  assert.equal(result.comparisonCompleteCount, "1");
  assert.equal(result.unchangedCount, "1");
  assert.equal(result.candidates[0].baseline.roots[0].implementation.address, IMPL);
  assert.equal(result.gate.calldata, false);
});

test("detects implementation code drift without weakening completeness", async () => {
  const result = await observeFixedBlockContractIdentities(input(), { rpc: rpcFor({ currentImplCode: "0x6002" }) });
  assert.equal(result.candidates[0].comparisonComplete, true);
  assert.equal(result.candidates[0].unchanged, false);
});

test("resolves EIP-1967 implementation slots and standard beacons", async () => {
  const implementation = await observeFixedBlockContractIdentities(input("eip1967"), {
    rpc: rpcFor({ rootCode: "0x6000", implementationWord: word(IMPL) }) });
  assert.equal(implementation.unchangedCount, "1");
  const beacon = await observeFixedBlockContractIdentities(input("eip1967_beacon"), {
    rpc: rpcFor({ rootCode: "0x6000", beaconWord: word(BEACON) }) });
  assert.equal(beacon.unchangedCount, "1");
  assert.equal(beacon.candidates[0].baseline.roots[0].beacon.address, BEACON);
});

test("keeps custom or mismatched beacon resolution incomplete", async () => {
  const result = await observeFixedBlockContractIdentities(input("eip1967_beacon"), {
    rpc: rpcFor({ rootCode: "0x6000", beaconWord: word(BEACON), beaconImplementationWord: word(OTHER) }) });
  assert.equal(result.comparisonCompleteCount, "0");
  assert.match(result.candidates[0].baseline.roots[0].reason, /differs from the reviewed/u);
});

test("refuses widened authority, unofficial RPCs, and unsupported methods", async () => {
  const widened = input(); widened.authority.calldata = true;
  await assert.rejects(() => observeFixedBlockContractIdentities(widened, { rpc: rpcFor() }), /authority/u);
  const unofficial = input(); unofficial.candidates[0].rpcUrl = "https://rpc.example/base";
  await assert.rejects(() => observeFixedBlockContractIdentities(unofficial, { rpc: rpcFor() }), /official archive RPC/u);
});

test("records only content-valid observations through the provider boundary", async () => {
  const evidence = input(); const result = await observeFixedBlockContractIdentities(evidence, { rpc: rpcFor() });
  const writes = [];
  await recordFixedBlockContractIdentityObservation(evidence, result, { recordedAt: "2026-07-22T15:00:00.000Z",
    record: async (request) => { writes.push(request); return { digest: "ok" }; } });
  assert.equal(writes[0].category, "ethereum-services.fixed-block-contract-identity-observation");
  const changed = structuredClone(result); changed.unchangedCount = "0";
  await assert.rejects(() => recordFixedBlockContractIdentityObservation(evidence, changed, { record: async () => ({}) }),
    /valid request-bound fixed-block identity/u);
  const mismatched = structuredClone(evidence); mismatched.candidates[0].currentBlock = "201";
  await assert.rejects(() => recordFixedBlockContractIdentityObservation(mismatched, result, { record: async () => ({}) }),
    /valid request-bound fixed-block identity/u);
});

import assert from "node:assert/strict";
import test from "node:test";
import { Interface } from "ethers";

import {
  ENTERPRISE_ACCOUNT_CONTROLLER_BINDING_PROFILE,
  observeEnterpriseAccountControllerBinding,
} from "../scripts/enterprise-account-controller-binding-observation.mjs";

const ACCOUNT = "0x1111111111111111111111111111111111111111";
const POLICY = "0x2222222222222222222222222222222222222222";
const ENTRY_POINT = "0x3333333333333333333333333333333333333333";
const BLOCK_HASH = `0x${"a".repeat(64)}`;
const FINALIZED_HASH = `0x${"b".repeat(64)}`;
const CAPABILITY_NI = `ni:///sha-256;${"A".repeat(43)}`;
const account = new Interface([
  "function eip712Domain() view returns (bytes1 fields,string name,string version,uint256 chainId,address verifyingContract,bytes32 salt,uint256[] extensions)",
  "function policySigner() view returns (address)",
  "function entryPoint() view returns (address)",
  "function isValidSignature(bytes32 hash,bytes signature) view returns (bytes4)",
]);
const entryPoint = new Interface(["function getNonce(address sender,uint192 key) view returns (uint256)"]);

function binding() {
  return { profile: ENTERPRISE_ACCOUNT_CONTROLLER_BINDING_PROFILE, chain: "eip155:5615610",
    account: ACCOUNT, resource: `did:pkh:eip155:5615610:${ACCOUNT}`,
    controller: `did:key:z${"A".repeat(48)}`, actor: `did:key:z${"B".repeat(48)}`,
    delegationCid: `b${"a".repeat(58)}`, invocationCid: `b${"c".repeat(58)}`,
    capability: { with: `did:pkh:eip155:5615610:${ACCOUNT}`, can: "semiotic/move",
      nb: { locus: "ni:///sha-256;example" } },
    capabilityNi: CAPABILITY_NI,
    senSemanticDigest: `0x${"4".repeat(64)}`, a2aCorrelation: "task-7/message-2",
    userOpNonce: "9", notBefore: "900", expiration: "1100", challengeNonce: `0x${"5".repeat(64)}`,
    signature: `0x${"6".repeat(130)}`, block: "100", blockHash: BLOCK_HASH };
}

function rpc({ magic = "0x1626ba7e", nonce = 9n, finalizedNumber = 120n } = {}) {
  return async (method, params) => {
    if (method === "eth_chainId") return "0x55affa";
    if (method === "eth_getBlockByNumber" && params[0] === "finalized") {
      return { number: `0x${finalizedNumber.toString(16)}`, hash: FINALIZED_HASH, timestamp: "0x44c" };
    }
    if (method === "eth_getBlockByNumber") return { number: "0x64", hash: BLOCK_HASH, timestamp: "0x3e8" };
    if (method === "eth_getCode") return "0x6001600055";
    if (method !== "eth_call") throw new Error(`unexpected ${method}`);
    const { to, data } = params[0];
    if (to === ENTRY_POINT) return entryPoint.encodeFunctionResult("getNonce", [nonce]);
    if (data.startsWith(account.getFunction("eip712Domain").selector)) return account.encodeFunctionResult("eip712Domain",
      ["0x0f", "Union Sovereign Enterprise Account", "3", 5615610n, ACCOUNT, `0x${"0".repeat(64)}`, []]);
    if (data.startsWith(account.getFunction("policySigner").selector)) return account.encodeFunctionResult("policySigner", [POLICY]);
    if (data.startsWith(account.getFunction("entryPoint").selector)) return account.encodeFunctionResult("entryPoint", [ENTRY_POINT]);
    if (data.startsWith(account.getFunction("isValidSignature").selector)) return account.encodeFunctionResult("isValidSignature", [magic]);
    throw new Error("unexpected eth_call");
  };
}

test("emits a context-bound finalized ERC-1271 controller binding receipt", async () => {
  const receipt = await observeEnterpriseAccountControllerBinding(binding(), { rpc: rpc() });
  assert.equal(receipt.type, "EnterpriseAccountControllerBindingReceipt");
  assert.equal(receipt.protocol, "ERC-1271");
  assert.equal(receipt.observation.erc1271Magic, "0x1626ba7e");
  assert.equal(receipt.observation.policySigner, POLICY);
  assert.equal(receipt.userOpNonce, "9");
  assert.equal(receipt.capabilityNi, CAPABILITY_NI);
  assert.match(receipt.id, /^ni:\/\/\/sha-256;/u);
});

test("rotation refusal and nonce replay cannot produce a binding receipt", async () => {
  await assert.rejects(() => observeEnterpriseAccountControllerBinding(binding(), { rpc: rpc({ magic: "0xffffffff" }) }),
    /refused the controller binding/u);
  await assert.rejects(() => observeEnterpriseAccountControllerBinding(binding(), { rpc: rpc({ nonce: 10n }) }),
    /nonce is not current/u);
});

test("an unfinalized observation cannot produce a binding receipt", async () => {
  await assert.rejects(() => observeEnterpriseAccountControllerBinding(binding(), { rpc: rpc({ finalizedNumber: 99n }) }),
    /not an exact finalized block/u);
});

test("a malformed externally identified capability cannot produce a binding receipt", async () => {
  await assert.rejects(
    () => observeEnterpriseAccountControllerBinding({ ...binding(), capabilityNi: "ni:///sha-256;invalid" }, { rpc: rpc() }),
    /capabilityNi is malformed/u,
  );
});

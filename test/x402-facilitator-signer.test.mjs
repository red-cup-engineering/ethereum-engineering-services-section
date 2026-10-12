import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Interface } from "ethers";

import { createEnterpriseAccountFacilitatorSigner } from "../src/x402-facilitator-signer.mjs";

const ACCOUNT = "0x0000000000000000000000000000000000000001";
const TARGET = "0x0000000000000000000000000000000000000002";
const DIGEST = `0x${"11".repeat(32)}`;
const TRANSACTION = `0x${"22".repeat(32)}`;
const AUTHORITY = Object.freeze({ signUserOperationHash: async () => "0x", authorizeUserOperation: async () => ({ type: "test" }) });

test("x402 facilitator mutations are semantic-gated ERC-4337 UserOperations", async () => {
  const root = mkdtempSync(join(tmpdir(), "x402-erc4337-"));
  try {
    const bindingPath = join(root, "binding.json"); writeFileSync(bindingPath, JSON.stringify({ account: { address: ACCOUNT } }));
    let semantics, execution;
    const signer = createEnterpriseAccountFacilitatorSigner({
      bindingPath, authority: AUTHORITY, rpcUrl: "http://rpc", bundlerUrl: "http://bundler",
      semanticDigest: async (value) => { semantics = value; return DIGEST; },
      execute: async (value) => { execution = value; return { transactionHash: TRANSACTION }; },
      publicClient: {},
    });
    const transaction = await signer.writeContract({ address: TARGET, abi: ["function settle(address receiver,uint256 amount)"], functionName: "settle", args: [ACCOUNT, 7n] });
    assert.equal(transaction, TRANSACTION); assert.equal(signer.executionProfile, "ERC-4337"); assert.deepEqual(signer.getAddresses(), [ACCOUNT]);
    assert.equal(semantics.target, TARGET); assert.match(semantics.calldata, /^0x[0-9a-f]+$/u);
    assert.equal(execution.rmnSemanticDigest, DIGEST); assert.equal(execution.target, TARGET); assert.equal(execution.bundlerUrl, "http://bundler");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("x402 facilitator signer refuses mutation without a typed RMN digest", async () => {
  const root = mkdtempSync(join(tmpdir(), "x402-erc4337-"));
  try {
    const bindingPath = join(root, "binding.json"); writeFileSync(bindingPath, JSON.stringify({ account: { address: ACCOUNT } }));
    const signer = createEnterpriseAccountFacilitatorSigner({ bindingPath, authority: AUTHORITY, rpcUrl: "r", bundlerUrl: "b", semanticDigest: async () => "untyped", publicClient: {}, execute: async () => assert.fail("must not execute") });
    await assert.rejects(() => signer.sendTransaction({ to: TARGET, data: "0x" }), /bytes32/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("x402 facilitator signer resolves an overloaded token operation by exact arguments", async () => {
  const root = mkdtempSync(join(tmpdir(), "x402-erc4337-overload-"));
  try {
    const bindingPath = join(root, "binding.json");
    writeFileSync(bindingPath, JSON.stringify({ account: { address: ACCOUNT } }));
    let execution;
    const signer = createEnterpriseAccountFacilitatorSigner({
      bindingPath,
      authority: AUTHORITY,
      rpcUrl: "r",
      bundlerUrl: "b",
      semanticDigest: async () => DIGEST,
      publicClient: {},
      execute: async (value) => {
        execution = value;
        return { transactionHash: TRANSACTION };
      },
    });
    const abi = [
      "function transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)",
      "function transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,bytes)",
    ];
    await signer.writeContract({
      address: TARGET,
      abi,
      functionName: "transferWithAuthorization",
      args: [ACCOUNT, TARGET, 12n, 0n, 99n, DIGEST, "0x1234"],
    });
    assert.equal(execution.calldata.slice(0, 10), new Interface(abi)
      .getFunction("transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,bytes)")
      .selector);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

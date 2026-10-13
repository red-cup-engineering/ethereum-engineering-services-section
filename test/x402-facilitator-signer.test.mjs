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

async function withSigner(overrides, run) {
  const root = mkdtempSync(join(tmpdir(), "x402-erc4337-admission-"));
  try {
    const bindingPath = join(root, "binding.json");
    writeFileSync(bindingPath, JSON.stringify({ account: { address: ACCOUNT } }));
    return await run(createEnterpriseAccountFacilitatorSigner({
      bindingPath, authority: AUTHORITY, rpcUrl: "http://rpc", bundlerUrl: "http://bundler",
      semanticDigest: async () => DIGEST, publicClient: {},
      execute: async () => ({ transactionHash: TRANSACTION }), ...overrides,
    }));
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test("authority options cannot replace the exact semantic-gated execution", async () => {
  let semantics, execution;
  const authority = {
    ...AUTHORITY, target: ACCOUNT, calldata: "0xff", value: 999n,
    rmnSemanticDigest: TRANSACTION, rpcUrl: "http://wrong-chain", bundlerUrl: "http://wrong-bundler",
    bindingPath: "wrong-binding", expectedBindingSource: "wrong-source", receiptWaitMs: 999_999, paymaster: { tag: "sponsor" },
  };
  await withSigner({
    authority, confirmationTimeoutMs: 5_000,
    semanticDigest: async (call) => {
      semantics = call;
      authority.authorizeUserOperation = () => assert.fail("mutable authority must not replace captured policy");
      return DIGEST;
    },
    execute: async (call) => { execution = call; return { transactionHash: TRANSACTION }; },
  }, async (signer) => {
    assert.equal(await signer.sendTransaction({ to: TARGET, data: "0xABCD", value: 17n }), TRANSACTION);
    assert.equal(execution.target, semantics.target);
    assert.equal(execution.calldata, semantics.calldata);
    assert.equal(execution.value, semantics.value);
    assert.equal(execution.rmnSemanticDigest, DIGEST);
    assert.equal(execution.rpcUrl, "http://rpc");
    assert.equal(execution.bundlerUrl, "http://bundler");
    assert.notEqual(execution.bindingPath, "wrong-binding");
    assert.equal(execution.expectedBindingSource, JSON.stringify({ account: { address: ACCOUNT } }));
    assert.equal(execution.receiptWaitMs, 5_000);
    assert.equal(execution.authorizeUserOperation, AUTHORITY.authorizeUserOperation);
    assert.equal(execution.paymaster, authority.paymaster);
    assert.deepEqual(semantics, { account: ACCOUNT, target: TARGET, calldata: "0xabcd", value: 17n });
  });
});

test("malformed attribution suffixes and out-of-range native values refuse before semantic admission", async () => {
  await withSigner({ semanticDigest: async () => assert.fail("must refuse before semantic admission") }, async (signer) => {
    for (const dataSuffix of ["1234", "0x1", "0xzz", 0, null]) {
      await assert.rejects(() => signer.writeContract({ address: TARGET, abi: ["function settle()"], functionName: "settle", dataSuffix }), /dataSuffix/u);
    }
    for (const value of [-1n, 1n << 256n]) {
      await assert.rejects(() => signer.sendTransaction({ to: TARGET, data: "0x", value }), /uint256/u);
    }
  });
});

test("valid attribution suffix and native value are included in the semantic digest", async () => {
  let semantics;
  await withSigner({ semanticDigest: async (call) => { semantics = call; return DIGEST; } }, async (signer) => {
    await signer.writeContract({ address: TARGET, abi: ["function settle() payable"], functionName: "settle", dataSuffix: "0xABCD", value: 23n });
    assert.equal(semantics.calldata, new Interface(["function settle() payable"]).encodeFunctionData("settle") + "abcd");
    assert.equal(semantics.value, 23n);
  });
});

test("receipt lookups preserve SDK timeout bounds and refuse malformed hashes", async () => {
  const calls = [];
  await withSigner({ confirmationTimeoutMs: 5_000, publicClient: {
    waitForTransactionReceipt: async (call) => { calls.push(call); return { status: "success", logs: [] }; },
  } }, async (signer) => {
    assert.deepEqual(await signer.waitForTransactionReceipt({ hash: TRANSACTION }), { status: "success", logs: [] });
    await signer.waitForTransactionReceipt({ hash: TRANSACTION, timeout: 1_000 });
    await signer.waitForTransactionReceipt({ hash: TRANSACTION, timeout: 90_000 });
    await assert.rejects(() => signer.waitForTransactionReceipt({ hash: "0x" }), /transaction hash/u);
    await assert.rejects(() => signer.waitForTransactionReceipt({ hash: TRANSACTION, timeout: 0 }), /timeout/u);
    assert.deepEqual(calls.map(({ timeout }) => timeout), [5_000, 1_000, 5_000]);
  });
});

test("execution without a transaction hash never becomes a settlement handle", async () => {
  await withSigner({ execute: async () => ({ transactionHash: "accepted" }) }, async (signer) => {
    await assert.rejects(() => signer.sendTransaction({ to: TARGET, data: "0x" }), /transaction hash/u);
  });
});

test("semantic-gate binding replacement refuses in the actual executor before any RPC", async (context) => {
  const root = mkdtempSync(join(tmpdir(), "x402-binding-drift-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const bindingPath = join(root, "binding.json");
  const binding = { account: { address: ACCOUNT }, policy: { signer: ACCOUNT }, chain: { chainId: 5615611 } };
  let networkCalls = 0;
  context.mock.method(globalThis, "fetch", async () => { networkCalls += 1; assert.fail("binding drift must refuse before any network request"); });
  for (const replacement of [
    { ...binding, account: { address: TARGET } },
    { ...binding, policy: { signer: TARGET } },
    { ...binding, chain: { chainId: 5615610 } },
  ]) {
    writeFileSync(bindingPath, JSON.stringify(binding));
    const signer = createEnterpriseAccountFacilitatorSigner({
      bindingPath, authority: AUTHORITY, rpcUrl: "http://rpc", bundlerUrl: "http://bundler", publicClient: {},
      semanticDigest: async (call) => {
        assert.equal(call.account, ACCOUNT);
        writeFileSync(bindingPath, JSON.stringify(replacement));
        return DIGEST;
      },
    });
    await assert.rejects(() => signer.sendTransaction({ to: TARGET, data: "0x" }), /binding changed after semantic admission/u);
  }
  assert.equal(networkCalls, 0);
});

import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Interface, recoverAddress } from "ethers";
import { executeEnterpriseUserOperation, prepareEnterpriseUserOperation } from "../src/enterprise-user-operation.mjs";
import { createSettlementKeystore } from "../src/settlement-key-custody.mjs";
import { createLocalSettlementUserOperationAuthority } from "../src/local-settlement-user-operation-authority.mjs";

const ACCOUNT = "0x1111111111111111111111111111111111111111";
const ENTRY_POINT = "0x2222222222222222222222222222222222222222";
const TARGET = "0x3333333333333333333333333333333333333333";
const USER_OP_HASH = `0x${"44".repeat(32)}`;
const TX_HASH = `0x${"55".repeat(32)}`;
const RMN_DIGEST = `0x${"66".repeat(32)}`;
const accountAbi = new Interface([
  "function entryPoint() view returns (address)",
  "function validateUserOp((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature) userOp, bytes32 userOpHash, uint256 missingAccountFunds) returns (uint256)",
]);
const entryPointAbi = new Interface([
  "function getNonce(address sender,uint192 key) view returns (uint256)",
  "function getUserOpHash((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature) userOp) view returns (bytes32)",
]);

test("signs the exact EntryPoint hash and crosses only the ERC-7769 bundler boundary", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "enterprise-user-op-"));
  const passwordFile = join(root, "password");
  const keystorePath = join(root, "keystore.json");
  const bindingPath = join(root, "binding.json");
  writeFileSync(passwordFile, "a-strong-test-password-that-never-enters-a-request\n", { mode: 0o600 });
  const custody = await createSettlementKeystore({ path: keystorePath, passwordFile });
  writeFileSync(bindingPath, `${JSON.stringify({
    chain: { chainId: 31337 },
    account: { address: ACCOUNT, caip10: `eip155:31337:${ACCOUNT}` },
    policy: { signer: custody.signer },
  })}\n`);

  let sentOperation;
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const message = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const { id, method, params = [] } = message;
    let result;
    if (method === "eth_chainId") result = "0x7a69";
    else if (method === "eth_gasPrice") result = "0x3b9aca00";
    else if (method === "eth_supportedEntryPoints") result = [ENTRY_POINT];
    else if (method === "eth_estimateUserOperationGas") result = { callGasLimit: "0x186a0", verificationGasLimit: "0x30d40", preVerificationGas: "0xc350" };
    else if (method === "eth_sendUserOperation") {
      sentOperation = params[0];
      assert.equal(recoverAddress(USER_OP_HASH, sentOperation.signature).toLowerCase(), custody.signer);
      result = USER_OP_HASH;
    } else if (method === "eth_getUserOperationReceipt") {
      result = { success: true, receipt: { transactionHash: TX_HASH, blockNumber: "0x7" } };
    } else if (method === "eth_getCode") result = "0x6000";
    else if (method === "eth_call") {
      const data = params[0].data;
      if (data.startsWith(accountAbi.getFunction("entryPoint").selector)) result = accountAbi.encodeFunctionResult("entryPoint", [ENTRY_POINT]);
      else if (data.startsWith(entryPointAbi.getFunction("getNonce").selector)) result = entryPointAbi.encodeFunctionResult("getNonce", [0n]);
      else if (data.startsWith(entryPointAbi.getFunction("getUserOpHash").selector)) result = entryPointAbi.encodeFunctionResult("getUserOpHash", [USER_OP_HASH]);
      else if (data.startsWith(accountAbi.getFunction("validateUserOp").selector)) result = accountAbi.encodeFunctionResult("validateUserOp", [0n]);
      else throw new Error(`unexpected eth_call ${data.slice(0, 10)}`);
    } else throw new Error(`unexpected RPC method ${method}`);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ jsonrpc: "2.0", id, result }));
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  context.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}`;

  const authority = await createLocalSettlementUserOperationAuthority({ keystorePath, passwordFile, policySigner: custody.signer });
  const receipt = await executeEnterpriseUserOperation({
    bindingPath, rpcUrl: url, bundlerUrl: url, ...authority,
    target: TARGET, calldata: "0x1234", rmnSemanticDigest: RMN_DIGEST, receiptWaitMs: 1_000,
  });
  assert.equal(receipt.userOpHash, USER_OP_HASH);
  assert.equal(receipt.transactionHash, TX_HASH);
  assert.equal(receipt.directEoaExecution, false);
  assert.equal(sentOperation.sender, ACCOUNT);
  assert.equal(sentOperation.factory, null);
  assert.equal(sentOperation.paymaster, null);
});

test("core refuses ambient custody or an absent injected authority before network work", async () => {
  await assert.rejects(
    executeEnterpriseUserOperation({ bindingPath: "unused", bundlerUrl: "http://unused" }),
    /signUserOperationHash authority is required/u,
  );
  await assert.rejects(
    executeEnterpriseUserOperation({ bindingPath: "unused", bundlerUrl: "http://unused", signUserOperationHash: async () => "0x" }),
    /authorizeUserOperation authority is required/u,
  );
});

test("prepares and locally validates an operation without admitting it to a bundler", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "prepared-enterprise-user-op-"));
  const bindingPath = join(root, "binding.json");
  const signer = new (await import("ethers")).Wallet("0x0123456789012345678901234567890123456789012345678901234567890123");
  writeFileSync(bindingPath, `${JSON.stringify({ chain: { chainId: 31337 }, account: { address: ACCOUNT, caip10: `eip155:31337:${ACCOUNT}` }, policy: { signer: signer.address } })}\n`);
  const server = createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const { id, method, params = [] } = JSON.parse(Buffer.concat(chunks).toString("utf8")); let result;
    if (method === "eth_chainId") result = "0x7a69";
    else if (method === "eth_gasPrice") result = "0x3b9aca00";
    else if (method === "eth_supportedEntryPoints") result = [ENTRY_POINT];
    else if (method === "eth_estimateUserOperationGas") result = { callGasLimit: "0x186a0", verificationGasLimit: "0x30d40", preVerificationGas: "0xc350" };
    else if (method === "eth_sendUserOperation") throw new Error("prepare must not submit");
    else if (method === "eth_getCode") result = "0x6000";
    else if (method === "eth_call") { const data = params[0].data;
      if (data.startsWith(accountAbi.getFunction("entryPoint").selector)) result = accountAbi.encodeFunctionResult("entryPoint", [ENTRY_POINT]);
      else if (data.startsWith(entryPointAbi.getFunction("getNonce").selector)) result = entryPointAbi.encodeFunctionResult("getNonce", [0n]);
      else if (data.startsWith(entryPointAbi.getFunction("getUserOpHash").selector)) result = entryPointAbi.encodeFunctionResult("getUserOpHash", [USER_OP_HASH]);
      else if (data.startsWith(accountAbi.getFunction("validateUserOp").selector)) result = accountAbi.encodeFunctionResult("validateUserOp", [0n]);
      else throw new Error("unexpected eth_call"); }
    else throw new Error(`unexpected ${method}`);
    response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify({ jsonrpc: "2.0", id, result }));
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen)); context.after(() => server.close());
  const prepared = await prepareEnterpriseUserOperation({ bindingPath, rpcUrl: `http://127.0.0.1:${server.address().port}`, bundlerUrl: `http://127.0.0.1:${server.address().port}`, target: TARGET, calldata: "0x1234", rmnSemanticDigest: RMN_DIGEST, signUserOperationHash: async (hash) => signer.signingKey.sign(hash).serialized, authorizeUserOperation: async () => undefined });
  assert.equal(prepared.type, "PreparedEnterpriseUserOperation"); assert.equal(prepared.userOpHash, USER_OP_HASH); assert.equal(prepared.packedOperation.sender, ACCOUNT);
});

test("prepares a counterfactual EnterpriseAccount with its exact factory initCode and no paymaster", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "counterfactual-enterprise-user-op-")); const bindingPath = join(root, "binding.json");
  const signer = new (await import("ethers")).Wallet("0x0123456789012345678901234567890123456789012345678901234567890123");
  const factory = "0x4444444444444444444444444444444444444444"; const factoryData = "0x12345678";
  writeFileSync(bindingPath, `${JSON.stringify({ chain: { chainId: 31337 }, account: { address: ACCOUNT, caip10: `eip155:31337:${ACCOUNT}`, entryPoint: ENTRY_POINT, initCode: `${factory}${factoryData.slice(2)}` }, policy: { signer: signer.address } })}\n`);
  const server = createServer(async (request, response) => { const chunks = []; for await (const chunk of request) chunks.push(chunk); const { id, method, params = [] } = JSON.parse(Buffer.concat(chunks).toString("utf8")); let result;
    if (method === "eth_chainId") result = "0x7a69"; else if (method === "eth_gasPrice") result = "0x3b9aca00"; else if (method === "eth_getCode") result = "0x"; else if (method === "eth_supportedEntryPoints") result = [ENTRY_POINT]; else if (method === "eth_estimateUserOperationGas") result = { callGasLimit: "0x186a0", verificationGasLimit: "0x30d40", preVerificationGas: "0xc350" };
    else if (method === "eth_call") { const data = params[0].data; if (data.startsWith(entryPointAbi.getFunction("getNonce").selector)) result = entryPointAbi.encodeFunctionResult("getNonce", [0n]); else if (data.startsWith(entryPointAbi.getFunction("getUserOpHash").selector)) result = entryPointAbi.encodeFunctionResult("getUserOpHash", [USER_OP_HASH]); else throw new Error("counterfactual account must not be called"); } else throw new Error(`unexpected ${method}`);
    response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify({ jsonrpc: "2.0", id, result })); });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen)); context.after(() => server.close());
  const prepared = await prepareEnterpriseUserOperation({ bindingPath, rpcUrl: `http://127.0.0.1:${server.address().port}`, preparationProfile: { entryPoint: ENTRY_POINT, callGasLimit: "0x186a0", verificationGasLimit: "0x30d40", preVerificationGas: "0xc350", maxFeePerGas: "0x77359400", maxPriorityFeePerGas: "0x3b9aca00" }, target: TARGET, calldata: "0x1234", rmnSemanticDigest: RMN_DIGEST, forbidPaymaster: true, signUserOperationHash: async (hash) => signer.signingKey.sign(hash).serialized, authorizeUserOperation: async () => undefined });
  assert.equal(prepared.counterfactual, true); assert.equal(prepared.operation.factory, factory); assert.equal(prepared.operation.factoryData, factoryData); assert.equal(prepared.operation.paymaster, null);
});

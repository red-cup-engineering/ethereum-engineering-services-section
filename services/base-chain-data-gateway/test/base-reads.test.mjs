import { test } from "node:test";
import assert from "node:assert/strict";
import { readAddressBalance, readGasOracle, readTransactionByHash } from "../src/base-reads.mjs";

const RPC_URL = "https://mainnet.base.org";
const ADDRESS = "0x4200000000000000000000000000000000000006";
const HASH = "0x".padEnd(66, "a");

function mockRpc(table) {
  const calls = [];
  const rpc = async (url, method, params) => {
    calls.push({ url, method, params });
    if (!(method in table)) throw new Error(`unexpected RPC method ${method}`);
    return table[method];
  };
  rpc.calls = calls;
  return rpc;
}

test("readAddressBalance calls eth_getBalance and eth_blockNumber and shapes the result", async () => {
  const rpc = mockRpc({ eth_getBalance: "0xde0b6b3a7640000", eth_blockNumber: "0x64" });
  const result = await readAddressBalance({ rpcUrl: RPC_URL, address: ADDRESS, rpc });
  assert.deepEqual(result, { address: ADDRESS.toLowerCase(), weiBalance: "1000000000000000000", snapshotBlock: "100" });
  assert.equal(rpc.calls.length, 2);
  assert.deepEqual(rpc.calls[0], { url: RPC_URL, method: "eth_getBalance", params: [ADDRESS.toLowerCase(), "latest"] });
  assert.deepEqual(rpc.calls[1], { url: RPC_URL, method: "eth_blockNumber", params: [] });
});

test("readAddressBalance rejects a malformed address without calling the RPC", async () => {
  const rpc = mockRpc({});
  await assert.rejects(() => readAddressBalance({ rpcUrl: RPC_URL, address: "not-an-address", rpc }), /EVM address/);
  assert.equal(rpc.calls.length, 0);
});

test("readAddressBalance rejects a missing address", async () => {
  const rpc = mockRpc({});
  await assert.rejects(() => readAddressBalance({ rpcUrl: RPC_URL, address: null, rpc }), /EVM address/);
});

test("readGasOracle calls eth_gasPrice and eth_blockNumber and shapes the result", async () => {
  const rpc = mockRpc({ eth_gasPrice: "0x3b9aca00", eth_blockNumber: "0x1" });
  const result = await readGasOracle({ rpcUrl: RPC_URL, rpc });
  assert.equal(result.weiGasPrice, "1000000000");
  assert.equal(result.gweiGasPrice, 1);
  assert.equal(result.snapshotBlock, "1");
  assert.equal(rpc.calls.length, 2);
  assert.equal(rpc.calls[0].method, "eth_gasPrice");
  assert.equal(rpc.calls[1].method, "eth_blockNumber");
});

test("readTransactionByHash returns found:true and the raw transaction for a hit", async () => {
  const transaction = { hash: HASH, blockNumber: "0x64", from: ADDRESS };
  const rpc = mockRpc({ eth_getTransactionByHash: transaction });
  const result = await readTransactionByHash({ rpcUrl: RPC_URL, hash: HASH, rpc });
  assert.deepEqual(result, { hash: HASH, found: true, transaction });
  assert.deepEqual(rpc.calls[0], { url: RPC_URL, method: "eth_getTransactionByHash", params: [HASH] });
});

test("readTransactionByHash returns found:false for an unknown hash without throwing", async () => {
  const rpc = mockRpc({ eth_getTransactionByHash: null });
  const result = await readTransactionByHash({ rpcUrl: RPC_URL, hash: HASH, rpc });
  assert.deepEqual(result, { hash: HASH, found: false, transaction: null });
});

test("readTransactionByHash rejects a malformed hash without calling the RPC", async () => {
  const rpc = mockRpc({});
  await assert.rejects(() => readTransactionByHash({ rpcUrl: RPC_URL, hash: "0xnothex", rpc }), /transaction hash/);
  assert.equal(rpc.calls.length, 0);
});

test("readContractSignatureValidity asks isValidSignature and reads only the ERC-1271 magic value as valid", async () => {
  const { readContractSignatureValidity } = await import("../src/base-reads.mjs");
  const calls = [];
  const rpc = (answer) => async (url, method, params) => { calls.push({ method, params }); if (answer instanceof Error) throw answer; return answer; };
  const input = { address: `0x${"ab".repeat(20)}`, digest: `0x${"11".repeat(32)}`, signature: `0x${"22".repeat(65)}` };
  assert.equal(await readContractSignatureValidity({ ...input, rpc: rpc(`0x1626ba7e${"0".repeat(56)}`) }), true);
  assert.equal(calls[0].method, "eth_call");
  assert.equal(calls[0].params[0].to, input.address);
  assert.equal(calls[0].params[0].data, `0x1626ba7e${"11".repeat(32)}${(64).toString(16).padStart(64, "0")}${(65).toString(16).padStart(64, "0")}${"22".repeat(65)}${"0".repeat(62)}`);
  assert.equal(await readContractSignatureValidity({ ...input, rpc: rpc(`0xffffffff${"0".repeat(56)}`) }), false);
  assert.equal(await readContractSignatureValidity({ ...input, rpc: rpc(new Error("execution reverted")) }), false);
});

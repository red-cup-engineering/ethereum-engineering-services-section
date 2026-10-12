import assert from "node:assert/strict";
import test from "node:test";
import { Interface } from "ethers";

import { observeFixedForkBeefyVaultExits, recordFixedForkBeefyVaultExitObservation }
  from "../src/fixed-fork-beefy-vault-exit-observation.mjs";

const EVENT = new Interface(["event FixedForkRecoveryObserved(string candidateId,uint256 blockNumber,address vault,address lpToken,uint256 sharesBurned,uint256 lpBurned,address token0,uint256 amount0,address token1,uint256 amount1,uint256 gasUsed,uint256 gasUnitsCeil,uint256 baseFeePerGas,uint256 l1DataFeeWeiCeil,uint256 operatorFeeWeiCeil,uint256 transactionCount,uint256 unsignedTxSizeCeil)"]);
const BLOCK_HASH = `0x${"a".repeat(64)}`;
const input = { profile: "org.emsenn.evm.fixed-fork-beefy-vault-exit-observation.v1",
  authority: { fixedForkEvidenceOnly: true, liveMutation: false, signerMaterialPresent: false,
    transactionAssembly: false, signing: false, broadcast: false, chainMutation: false, outputCalldata: false },
  chain: "eip155:8453", rpcUrl: "https://mainnet.base.org/", block: "48971240",
  blockHash: BLOCK_HASH, timestamp: "1784731827", candidates: ["yanagi-beefy-weeth-weth"] };

function harness(candidateId = "yanagi-beefy-weeth-weth") {
  const encoded = EVENT.encodeEventLog(EVENT.getEvent("FixedForkRecoveryObserved"), [candidateId, 48971240n,
    "0x47579c50c7aedea788d18927aed4c827fe34996a", "0x91f0f34916ca4e2cce120116774b0e4fa0cdcaa8",
    100n, 110n, "0x04c0599ae5a44757c0af6f9ec3b93da8976c150a", 120n,
    "0x4200000000000000000000000000000000000006", 130n, 474575n, 634218n, 5000000n,
    1000n, 200n, 3n, 256n]);
  return { "test/BeefyLegacyRecoveryFork.t.sol:BeefyLegacyRecoveryForkTest": { test_results: {
    "testYanagiBeefyWeethWethFixedForkExit()": { status: "Success",
      logs: [{ address: "0x0000000000000000000000000000000000000001",
        topics: encoded.topics, data: encoded.data }] } } } };
}

const rpc = async (url, method) => method === "eth_maxPriorityFeePerGas" ? "0xf4240"
  : ({ number: "0x2eb3de8", hash: BLOCK_HASH, timestamp: "0x6a60d8b3", baseFeePerGas: "0x4c4b40" });

test("projects conserved outputs and route gas from the exact typed fixed-fork event", async () => {
  const result = await observeFixedForkBeefyVaultExits(input, { rpc, runHarness: async () => harness(),
    now: () => "2026-07-22T15:00:00.000Z" });
  assert.equal(result.candidates[0].sharesBurned, "100");
  assert.equal(result.candidates[0].outputs[1].amount, "130");
  assert.equal(result.candidates[0].routeGasUsed, "474575");
  assert.equal(result.candidates[0].gasUnitsCeil, "634218");
  assert.equal(result.candidates[0].fee.maxFeePerGasCeil, "12000000");
  assert.equal(result.candidates[0].fee.totalFeeWeiCeil, "7610616001200");
  assert.equal(result.feeObservedAt, "2026-07-22T15:00:00.000Z");
  assert.equal(result.feeSource, "https://mainnet.base.org/");
  assert.equal(result.gate.outputVerified, true);
  assert.equal(result.gate.gasEstimated, true);
  assert.equal(result.gate.executionAdmitted, false);
});

test("refuses block drift, widened authority, and contradictory harness events", async () => {
  await assert.rejects(() => observeFixedForkBeefyVaultExits(input, { rpc: async (url, method) =>
    method === "eth_maxPriorityFeePerGas" ? "0xf4240" : ({ number: "0x2eb3de8",
      hash: `0x${"b".repeat(64)}`, timestamp: "0x6a60d8b3", baseFeePerGas: "0x4c4b40" }),
    runHarness: async () => harness() }), /block identity/u);
  await assert.rejects(() => observeFixedForkBeefyVaultExits({ ...input,
    authority: { ...input.authority, transactionAssembly: true } }, { rpc, runHarness: async () => harness() }),
  /authority/u);
  await assert.rejects(() => observeFixedForkBeefyVaultExits({ ...input, privateKey: "refused" },
    { rpc, runHarness: async () => harness() }), /secret or transaction/u);
  await assert.rejects(() => observeFixedForkBeefyVaultExits({ ...input, block: 48971240 },
    { rpc, runHarness: async () => harness() }), /decimal text/u);
  await assert.rejects(() => observeFixedForkBeefyVaultExits(input,
    { rpc, runHarness: async () => harness("yanagi-beefy-sfrxeth-wsteth") }), /contradicts/u);
  await assert.rejects(() => observeFixedForkBeefyVaultExits(input, { rpc: async (url, method) =>
    method === "eth_maxPriorityFeePerGas" ? "0xf4240" : ({ number: "0x2eb3de8", hash: BLOCK_HASH,
      timestamp: "0x6a60d8b3", baseFeePerGas: "0x4c4b41" }), runHarness: async () => harness() }), /contradicts/u);
});

test("records only a request-bound provider observation", async () => {
  const result = await observeFixedForkBeefyVaultExits(input, { rpc, runHarness: async () => harness(),
    now: () => "2026-07-22T14:59:00.000Z" });
  const writes = [];
  const recorded = await recordFixedForkBeefyVaultExitObservation(input, result, { recordedAt: "2026-07-22T15:00:00.000Z",
    record: async (request) => { writes.push(request); return { digest: "projection" }; } });
  assert.equal(writes[0].category, "ethereum-services.fixed-fork-beefy-vault-exit-observation");
  assert.equal(recorded.record.decisionBoundary.executionAdmitted, false);
  await assert.rejects(() => recordFixedForkBeefyVaultExitObservation({ ...input, block: "48971241" }, result,
    { record: async () => ({}) }), /request-bound/u);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { lazySettlementAccount, settlementIdentity } from "../src/settlement-account-binding.mjs";

test("settlement identity derives only from its owning directory", () => {
  assert.deepEqual(settlementIdentity("/srv/settlements/turntide-islands"), {
    nodeId: "turntide-islands",
    urn: "urn:ame:turntide-islands",
  });
});


test("a lazy settlement account preserves refusal until a settlement path is entered", () => {
  const prior = process.env.EVM_RPC_URL;
  delete process.env.EVM_RPC_URL;
  try {
    const account = lazySettlementAccount("/srv/settlements/turntide-islands");
    assert.equal(typeof account, "function");
    assert.throws(() => account(), /EVM_RPC_URL must name the settlement chain/u);
  } finally {
    if (prior === undefined) delete process.env.EVM_RPC_URL; else process.env.EVM_RPC_URL = prior;
  }
});

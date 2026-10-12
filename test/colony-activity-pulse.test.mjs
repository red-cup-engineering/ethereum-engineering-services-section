import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { collectEthereumColonyActivity } from "../src/collect-colony-activity.mjs";

test("reports EVM flow inside the exact interval and chain stocks separately", async () => {
  const root = mkdtempSync(join(tmpdir(), "evm-pulse-")); const statePath = join(root, "state.json"); const deploymentPath = join(root, "deploy.json");
  writeFileSync(statePath, JSON.stringify({ best_block_number: 2, blocks: [
    { header: { number: "0x1", timestamp: "0x6681f180", gasUsed: "0xa" }, transactions: ["0x1"] },
    { header: { number: "0x2", timestamp: "0x66820030", gasUsed: "0x14" }, transactions: ["0x2"] }
  ], transactions: [{ block_number: 1, receipt: { status: "0x1", logs: [{}] } }, { block_number: 2, receipt: { status: "0x0", logs: [] } }] }));
  writeFileSync(deploymentPath, JSON.stringify({ deployments: [{ standard: "one" }] }));
  const pulse = await collectEthereumColonyActivity({ window: { fromExclusive: "2024-07-01T00:00:00.000Z", toInclusive: "2024-07-02T00:00:00.000Z", baseline: false }, recordedAt: "2024-07-02T00:00:00.000Z", statePath, deploymentPath });
  assert.equal(pulse.events.length, 1);
  assert.match(pulse.events[0].summary, /1 EVM blocks \(2–2 in the development-chain trace\) carried 1 transactions from 0 senders to 0 destinations/u);
  assert.deepEqual(pulse.events[0].localOrder, { traceId: "urn:ame:ethereum-services-section:development-chain:eip155-31337", fromOrdinal: 2, toOrdinal: 2, unit: "blocks" });
  assert.equal(pulse.stocks.find((item) => item.id === "development-chain-height").amount, "2");
});

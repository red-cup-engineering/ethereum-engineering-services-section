import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { sha256 } from "ethers";
import { createFileCirculationStorage, createSemioticExchangeCirculationIndex } from "../src/semiotic-exchange-circulation-index.mjs";

const exchange = "0x98bBC65824962b61dF876A47B5779C4EcBBD4939";
const h = (byte) => `0x${byte.repeat(64)}`;
function memory() { const rows = new Map(); return { async get(key) { return rows.get(key) ?? null; }, async put(key, value) { rows.set(key, value); }, async remove(key) { rows.delete(key); }, async list(prefix) { return [...rows.keys()].filter((key) => key.startsWith(prefix)); } }; }
function event(block, blockHash = h("a"), carrier = new Uint8Array([1, 2])) { const digest = sha256(carrier).slice(2); return { kind: "DemandRaised", chainPosition: { blockNumber: BigInt(block), blockHash, transactionHash: h("b"), logIndex: 0 }, carrier, carrierNi: `ni:///sha-256;${Buffer.from(digest, "hex").toString("base64url")}` }; }
function index(storage, rows, blocks) { return createSemioticExchangeCirculationIndex({ storage, exchange, readEvents: async ({ fromBlock, toBlock }) => rows.filter(({ chainPosition }) => chainPosition.blockNumber >= fromBlock && chainPosition.blockNumber <= toBlock), getBlock: async (at) => ({ hash: blocks.get(BigInt(at)) }), getContractState: async () => ({ demandCount: "0" }) }); }

test("restart is idempotent and v1 begins at block 70", async () => {
  const storage = memory(), rows = [event(70)], blocks = new Map([[70n, h("a")]]), subject = index(storage, rows, blocks);
  const first = await subject.reconcile({ finalized: { number: 70, hash: h("a") } });
  const second = await subject.reconcile({ finalized: { number: 70, hash: h("a") } });
  assert.equal(first.indexed.length, 1); assert.equal(second.indexed.length, 0); assert.equal(second.signature, null);
});

test("checkpoint hash mismatch rolls back a bounded suffix and replays canonical logs", async () => {
  const storage = memory(), blocks = new Map([[70n, h("a")], [71n, h("c")]]), rows = [event(70), event(71, h("c"))], subject = index(storage, rows, blocks);
  await subject.reconcile({ finalized: { number: 70, hash: h("a") } });
  blocks.set(70n, h("d")); rows[0] = event(70, h("d"));
  const receipt = await subject.reconcile({ finalized: { number: 71, hash: h("c") } });
  assert.equal(receipt.reorg, true); assert.equal(receipt.replayFrom, "70"); assert.equal(receipt.indexed.length, 2);
});

test("corrupt carrier bytes refuse before storage", async () => {
  const storage = memory(), blocks = new Map([[70n, h("a")]]), corrupt = { ...event(70), carrierNi: "ni:///sha-256;wrong" };
  await assert.rejects(index(storage, [corrupt], blocks).reconcile({ finalized: { number: 70, hash: h("a") } }), /not verified/);
  assert.deepEqual(await storage.list("circulation/carrier/"), []);
});

test("file storage persists the deterministic index manifest across restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "circulation-index-"));
  try {
    const blocks = new Map([[70n, h("a")]]), rows = [event(70)];
    await index(createFileCirculationStorage(directory), rows, blocks).reconcile({ finalized: { number: 70, hash: h("a") } });
    const restarted = await index(createFileCirculationStorage(directory), rows, blocks).reconcile({ finalized: { number: 70, hash: h("a") } });
    assert.equal(restarted.indexed.length, 0);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

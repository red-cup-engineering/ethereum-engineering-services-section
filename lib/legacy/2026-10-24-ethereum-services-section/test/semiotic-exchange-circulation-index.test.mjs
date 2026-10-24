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

test("a claimed finalized head without matching chain evidence cannot change the event ledger", async () => {
  const storage = memory(), rows = [event(70)], blocks = new Map([[70n, h("a")]]);
  await assert.rejects(index(storage, rows, blocks).reconcile({
    finalized: { number: 70, hash: h("b") },
  }), /finalized checkpoint disagrees with the observed chain/u);
  assert.deepEqual(await storage.list("circulation/"), []);
  assert.equal(await storage.get("circulation/checkpoint"), null);
});

test("checkpoint hash mismatch rolls back a bounded suffix and replays canonical logs", async () => {
  const storage = memory(), blocks = new Map([[70n, h("a")], [71n, h("c")]]), rows = [event(70), event(71, h("c"))], subject = index(storage, rows, blocks);
  await subject.reconcile({ finalized: { number: 70, hash: h("a") } });
  blocks.set(70n, h("d")); rows[0] = event(70, h("d"));
  const receipt = await subject.reconcile({ finalized: { number: 71, hash: h("c") } });
  assert.equal(receipt.reorg, true); assert.equal(receipt.replayFrom, "70"); assert.equal(receipt.indexed.length, 2);
});

test("reorganization rolls back decimal heights numerically across digit boundaries", async () => {
  const storage = memory();
  const blocks = new Map([[70n, h("a")], [700n, h("b")], [1000n, h("c")]]);
  const rows = [event(70, h("a")), event(700, h("b")), event(1000, h("c"))];
  const subject = createSemioticExchangeCirculationIndex({
    storage, exchange, rollbackBlocks: 301n,
    readEvents: async ({ fromBlock, toBlock }) => rows.filter(({chainPosition}) =>
      chainPosition.blockNumber >= fromBlock && chainPosition.blockNumber <= toBlock),
    getBlock: async (at) => ({ hash: blocks.get(BigInt(at)) }),
  });
  await subject.reconcile({ finalized: { number: 1000, hash: h("c") } });
  const before = await storage.list("circulation/event/");
  assert.equal(before.length, 3);
  blocks.set(1000n, h("d"));
  rows[2] = event(1000, h("d"));
  const result = await subject.reconcile({ finalized: { number: 1000, hash: h("d") } });
  assert.equal(result.reorg, true);
  assert.equal(result.replayFrom, "699");
  const after = await storage.list("circulation/event/");
  assert.equal(after.length, 3);
  assert.ok(!after.includes(before.find(key => key.includes(h("c")))));
  assert.ok(after.some(key => key.includes(h("d"))));
  assert.ok(after.some(key => key.includes(h("a"))));
});

test("invalid replacement history cannot retire the previously received ledger", async () => {
  const storage = memory(), blocks = new Map([[70n, h("a")]]), rows = [event(70, h("a"))];
  const subject = index(storage, rows, blocks);
  await subject.reconcile({ finalized: { number: 70, hash: h("a") } });
  const original = await storage.list("circulation/event/");
  const checkpoint = await storage.get("circulation/checkpoint");
  blocks.set(70n, h("d"));
  rows[0] = { ...event(70, h("d")), carrierNi: "ni:///sha-256;invalid" };
  await assert.rejects(subject.reconcile({ finalized: { number: 70, hash: h("d") } }), /not verified/);
  assert.deepEqual(await storage.list("circulation/event/"), original);
  assert.deepEqual(await storage.get("circulation/checkpoint"), checkpoint);
});

test("event block hashes and duplicated log identities are verified before ledger mutation", async () => {
  const blocks = new Map([[70n, h("a")], [71n, h("c")]]);
  const wrong = event(70, h("d")), head = event(71, h("c"));
  const storage = memory();
  await assert.rejects(index(storage, [wrong, head], blocks).reconcile({
    finalized: { number: 71, hash: h("c") },
  }), /event block hash disagrees/);
  assert.deepEqual(await storage.list("circulation/"), []);
  const duplicate = event(70, h("a"));
  await assert.rejects(index(storage, [duplicate, duplicate], blocks).reconcile({
    finalized: { number: 70, hash: h("a") },
  }), /repeated one event identity/);
  assert.deepEqual(await storage.list("circulation/"), []);
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

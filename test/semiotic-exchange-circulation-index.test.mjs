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

test("one deployed exchange address is one witness source even through case variants or companion aliases", () => {
  const second = "0x1111111111111111111111111111111111111111";
  const inputs = [
    [{ address: exchange.toLowerCase(), deploymentBlock: 90n, version: 1 }],
    [{ address: second, deploymentBlock: 90n }, { address: second.toUpperCase().replace(/^0X/, "0x"), deploymentBlock: 95n }],
  ];
  for (const companions of inputs) {
    assert.throws(() => createSemioticExchangeCirculationIndex({
      storage: memory(), exchange, companions, getBlock: async () => ({ hash: h("a") }),
    }), /duplicate semiotic exchange contract source/u);
  }
});

test("restart is idempotent and v1 begins at block 70", async () => {
  const storage = memory(), rows = [event(70)], blocks = new Map([[70n, h("a")]]), subject = index(storage, rows, blocks);
  const first = await subject.reconcile({ finalized: { number: 70, hash: h("a") } });
  const second = await subject.reconcile({ finalized: { number: 70, hash: h("a") } });
  assert.equal(first.indexed.length, 1); assert.equal(second.indexed.length, 0); assert.equal(second.signature, null);
});

test("unverified supplied finalized block hash cannot write any exchange event or cursor", async () => {
  const storage = memory();
  const blocks = new Map([[70n, h("a")]]);
  let eventReads = 0;
  const indexer = createSemioticExchangeCirculationIndex({
    storage, exchange, getBlock: async number => ({ hash: blocks.get(BigInt(number)) }),
    readEvents: async () => { eventReads++; return [event(70)]; },
  });
  await assert.rejects(
    indexer.reconcile({ finalized: { number: 70n, hash: h("f") } }),
    /head hash differs from observed block/u,
  );
  assert.equal(eventReads, 0, "no side effects after an unreceived chain claim");
  assert.deepEqual(await storage.list("circulation/event/"), []);
  assert.equal(await storage.get("circulation/checkpoint"), null);
});

test("stale finalized head refuses without deleting paid history or moving its cursor backwards", async () => {
  const storage = memory(), blocks = new Map([[70n, h("a")], [71n, h("b")]]);
  const indexer = index(storage, [event(70), event(71, h("b"))], blocks);
  await indexer.reconcile({ finalized: { number: 71n, hash: h("b") } });
  const checkpoint = await storage.get("circulation/checkpoint");
  const before = await storage.list("circulation/event/");
  await assert.rejects(
    indexer.reconcile({ finalized: { number: 70n, hash: h("a") } }),
    /finalized head regressed/u,
  );
  assert.deepEqual(await storage.get("circulation/checkpoint"), checkpoint);
  assert.deepEqual(await storage.list("circulation/event/"), before);
});

test("checkpoint hash mismatch rolls back a bounded suffix and replays canonical logs", async () => {
  const storage = memory(), blocks = new Map([[70n, h("a")], [71n, h("c")]]), rows = [event(70), event(71, h("c"))], subject = index(storage, rows, blocks);
  await subject.reconcile({ finalized: { number: 70, hash: h("a") } });
  blocks.set(70n, h("d")); rows[0] = event(70, h("d"));
  const receipt = await subject.reconcile({ finalized: { number: 71, hash: h("c") } });
  assert.equal(receipt.reorg, true); assert.equal(receipt.replayFrom, "70"); assert.equal(receipt.indexed.length, 2);
});

test("reorg cleanup uses integer block ordering across 99 to 100, never deleting earlier paid witness history", async () => {
  const storage = memory();
  const blocks = new Map([[132n, h("a")], [133n, h("c")]]);
  const old = event(99, h("1")), oldFork = event(125, h("2"));
  const rows = [old, oldFork];
  const subject = index(storage, rows, blocks);
  const before = await subject.reconcile({ finalized: { number: 132n, hash: h("a") } });
  assert.equal(before.indexed.length, 2);
  assert.equal((await storage.list("circulation/event/")).length, 2);
  // The new finalized chain diverges at the previous checkpoint. With a
  // 32-block rollback, only block >= 100 may be replaced.
  blocks.set(132n, h("b"));
  rows[1] = event(125, h("3"));
  const after = await subject.reconcile({ finalized: { number: 133n, hash: h("c") } });
  assert.equal(after.reorg, true);
  assert.equal(after.replayFrom, "100");
  const retained = await Promise.all((await storage.list("circulation/event/")).map(key => storage.get(key)));
  assert.deepEqual(retained.map(row => row.blockNumber).sort(), ["125", "99"]);
  assert.ok(retained.some(row => row.blockNumber === "99" && row.event.chainPosition.blockHash === h("1")));
  assert.ok(retained.some(row => row.blockNumber === "125" && row.event.chainPosition.blockHash === h("3")));
  assert.ok(!retained.some(row => row.event.chainPosition.blockHash === h("2")));
});

test("malformed persisted block coordinates refuse reorg instead of silently losing evidence", async () => {
  const storage = memory(), blocks = new Map([[132n,h("a")],[133n,h("c")]]);
  const subject = index(storage, [event(125,h("2"))], blocks);
  await subject.reconcile({ finalized: { number: 132n, hash: h("a") } });
  const [key] = await storage.list("circulation/event/");
  await storage.put(key, { ...(await storage.get(key)), blockNumber: "0100" });
  blocks.set(132n,h("b"));
  await assert.rejects(subject.reconcile({ finalized: { number: 133n, hash: h("c") } }), /canonical decimal/u);
  assert.equal((await storage.get(key)).blockNumber, "0100");
});

test("new exchange companion backfills from its own deployment block after primary checkpoint", async () => {
  const storage = memory(), second = "0x1111111111111111111111111111111111111111";
  const primaryEvent = event(80,h("1")), addedEvent = event(95,h("2"));
  const readEvents = async ({exchange: contract,fromBlock,toBlock}) =>
    (contract.toLowerCase() === second.toLowerCase() ? [addedEvent] : [primaryEvent])
      .filter(row => row.chainPosition.blockNumber >= fromBlock && row.chainPosition.blockNumber <= toBlock);
  const common = {
    storage, exchange, readEvents, getBlock: async at => ({ hash: BigInt(at) === 120n ? h("b") : h("a") }),
    getContractState: async () => ({ demandCount: "2" }),
  };
  const original = createSemioticExchangeCirculationIndex(common);
  assert.equal((await original.reconcile({ finalized: { number: 110n, hash: h("a") } })).indexed.length,1);
  const enlarged = createSemioticExchangeCirculationIndex({
    ...common, companions: [{address: second,deploymentBlock:90n,version:1}],
  });
  const receipt = await enlarged.reconcile({ finalized: { number: 120n, hash: h("b") } });
  assert.equal(receipt.reorg,false);
  assert.equal(receipt.indexed.length,1);
  const stored = await Promise.all((await storage.list("circulation/event/")).map(key=>storage.get(key)));
  assert.deepEqual(stored.map(row=>row.blockNumber).sort(),["80","95"]);
  assert.equal(receipt.checkpoint.contracts.length,2);
  await assert.rejects(original.reconcile({finalized:{number:121n,hash:h("c")}}), /cannot disappear or change/u);
  assert.equal((await storage.list("circulation/event/")).length,2);
});

test("multi-thousand-block exchange backfill uses bounded closed RPC windows and replays on restart", async () => {
  const storage = memory(), reads = [], rows = [event(70,h("1")),event(1094,h("2")),event(2500,h("3"))];
  const subject = createSemioticExchangeCirculationIndex({
    storage, exchange,
    getBlock: async () => ({hash:h("a")}),
    readEvents: async ({fromBlock,toBlock}) => {
      reads.push([fromBlock.toString(),toBlock.toString()]);
      return rows.filter(({chainPosition})=>chainPosition.blockNumber>=fromBlock && chainPosition.blockNumber<=toBlock);
    },
  });
  const first = await subject.reconcile({finalized:{number:2500n,hash:h("a")}});
  assert.deepEqual(reads,[["70","1093"],["1094","2117"],["2118","2500"]]);
  assert.equal(first.indexed.length,3);
  reads.length=0;
  const again=await subject.reconcile({finalized:{number:2500n,hash:h("a")}});
  assert.equal(again.indexed.length,0);
  assert.deepEqual(reads,[]);
  assert.equal((await storage.list("circulation/event/")).length,3);
});

test("an injected chain reader cannot persist events outside the requested bounded window", async () => {
  const storage=memory();
  const subject=createSemioticExchangeCirculationIndex({
    storage,exchange,blockWindow:2n,getBlock:async()=>({hash:h("a")}),
    readEvents:async()=>[event(500,h("2"))],
  });
  await assert.rejects(subject.reconcile({finalized:{number:73n,hash:h("a")}}),/outside its requested window/u);
  assert.equal((await storage.list("circulation/event/")).length,0);
  assert.equal(await storage.get("circulation/checkpoint"),null);
  for(const bad of [0n,4097n,-1n]) {
    assert.throws(()=>createSemioticExchangeCirculationIndex({
      storage:memory(),exchange,blockWindow:bad,getBlock:async()=>({hash:h("a")}),
    }),/blockWindow|nonnegative/u);
  }
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

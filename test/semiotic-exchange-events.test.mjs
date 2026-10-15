import assert from "node:assert/strict";
import test from "node:test";
import { Interface, sha256 } from "ethers";
import {
  SEMIOTIC_EXCHANGE_EVENTS_ABI,
  MAX_SEMIOTIC_EXCHANGE_READ_BLOCKS,
  createSemioticExchangeA2aSources,
  invokeFinalizedDemandInterval,
  projectSemioticExchangeActivities,
  projectDemandRaised,
  readDemandRaised,
  readSemioticExchangeEvents,
  semioticExchangeEventReceipt,
} from "../src/semiotic-exchange-events.mjs";

const iface = new Interface(SEMIOTIC_EXCHANGE_EVENTS_ABI);
const exchange = "0x98bBC65824962b61dF876A47B5779C4EcBBD4939";
const carrier = new TextEncoder().encode("rmn:org.emsenn.a2a-rmn-hire-request.v1:test");
const event = iface.encodeEventLog(iface.getEvent("DemandRaised"), [
  sha256(carrier),
  "0x08E4B3bc9ef76b403879C0eC372d1Fd146E3a07B",
  `0x${"22".repeat(32)}`,
  `0x${"33".repeat(32)}`,
  carrier,
]);

function rpcWith(logs, calls = []) {
  return async (url, method, params) => {
    calls.push({ url, method, params });
    // Ethereum eth_getLogs always supplies the emitting address. A test
    // override can deliberately return the wrong address or interval.
    return logs.map(log => ({ address: exchange, ...log }));
  };
}

function logFor({ carrier: demandCarrier, blockNumber, logIndex }) {
  const encoded = iface.encodeEventLog(iface.getEvent("DemandRaised"), [
    sha256(demandCarrier),
    "0x08E4B3bc9ef76b403879C0eC372d1Fd146E3a07B",
    `0x${"22".repeat(32)}`,
    `0x${"33".repeat(32)}`,
    demandCarrier,
  ]);
  return {
    ...encoded,
    blockNumber: `0x${blockNumber.toString(16)}`,
    blockHash: `0x${"44".repeat(32)}`,
    transactionHash: `0x${"55".repeat(32)}`,
    logIndex: `0x${logIndex.toString(16)}`,
  };
}

test("reads complete RMN demand carriers from a bounded chain interval", async () => {
  const calls = [];
  const demands = await readDemandRaised({
    rpcUrl: "http://chain.invalid",
    exchange,
    fromBlock: 12n,
    toBlock: 14n,
    rpc: rpcWith([{
      ...event,
      blockNumber: "0xd",
      blockHash: `0x${"44".repeat(32)}`,
      transactionHash: `0x${"55".repeat(32)}`,
      logIndex: "0x2",
    }], calls),
  });

  assert.equal(demands.length, 1);
  assert.deepEqual(demands[0].carrier, carrier);
  assert.equal(demands[0].chainPosition.blockNumber, 13n);
  assert.equal(calls[0].method, "eth_getLogs");
  assert.deepEqual(calls[0].params[0].fromBlock, "0x0c");
  assert.deepEqual(calls[0].params[0].toBlock, "0x0e");
});

test("projects witnessed demands sequentially and advances the cursor", async () => {
  const submitted = [];
  const projection = await projectDemandRaised({
    rpcUrl: "http://chain.invalid",
    exchange,
    fromBlock: 20n,
    toBlock: 20n,
    rpc: rpcWith([{
      ...event,
      blockNumber: "0x14",
      blockHash: `0x${"66".repeat(32)}`,
      transactionHash: `0x${"77".repeat(32)}`,
      logIndex: "0x0",
    }]),
    submitDemand: async (demand) => {
      submitted.push(demand.demand);
      return { accepted: true };
    },
  });

  assert.equal(projection.witnessed, 1);
  assert.equal(projection.nextBlock, 21n);
  assert.deepEqual(projection.projections, [{ accepted: true }]);
  assert.equal(submitted.length, 1);
});

test("refuses unbounded or reversed reads", async () => {
  await assert.rejects(
    readDemandRaised({ rpcUrl: "x", exchange, fromBlock: 2n }),
    /toBlock/,
  );
  await assert.rejects(
    readDemandRaised({ rpcUrl: "x", exchange, fromBlock: 2n, toBlock: 1n }),
    /precedes/,
  );
});

test("every direct EVM exchange reader respects the existing bounded circulation window before RPC", async () => {
  assert.equal(MAX_SEMIOTIC_EXCHANGE_READ_BLOCKS, 4096n);
  for (const read of [readDemandRaised, readSemioticExchangeEvents]) {
    const calls = [];
    const args = { rpcUrl: "http://chain.invalid", exchange, fromBlock: 70n,
      toBlock: 70n + MAX_SEMIOTIC_EXCHANGE_READ_BLOCKS - 1n,
      rpc: rpcWith([], calls) };
    assert.deepEqual(await read(args), []);
    assert.equal(calls.length, 1);
    await assert.rejects(read({ ...args, toBlock: args.toBlock + 1n }),
      /exceeds 4096 blocks/u);
    assert.equal(calls.length, 1, "oversized requests must never reach the chain");
  }
});

test("demand-only reader refuses forged content claims before any provider submission", async () => {
  const forged = iface.encodeEventLog(iface.getEvent("DemandRaised"), [
    `0x${"11".repeat(32)}`,
    "0x08E4B3bc9ef76b403879C0eC372d1Fd146E3a07B",
    `0x${"22".repeat(32)}`, `0x${"33".repeat(32)}`, carrier,
  ]);
  let submitted = 0;
  await assert.rejects(projectDemandRaised({
    rpcUrl: "http://chain.invalid", exchange, fromBlock: 12n, toBlock: 14n,
    rpc: rpcWith([{ ...forged, blockNumber: "0xd",
      blockHash: `0x${"44".repeat(32)}`, transactionHash: `0x${"55".repeat(32)}`,
      logIndex: "0x1" }]),
    submitDemand: async () => { submitted++; },
  }), /canonical content address/u);
  assert.equal(submitted, 0);
});

test("a chain log index outside JavaScript's exact integer range is refused", async () => {
  await assert.rejects(readDemandRaised({
    rpcUrl: "http://chain.invalid", exchange, fromBlock: 12n, toBlock: 14n,
    rpc: rpcWith([{ ...event, blockNumber: "0xd",
      blockHash: `0x${"44".repeat(32)}`, transactionHash: `0x${"55".repeat(32)}`,
      logIndex: "0x20000000000000" }]),
  }), /safe integer range/u);
});

test("an RPC response cannot silently substitute contract, block or removed logs", async () => {
  const valid = {
    ...event, blockNumber: "0xd", blockHash: `0x${"44".repeat(32)}`,
    transactionHash: `0x${"55".repeat(32)}`, logIndex: "0x0",
  };
  const illegal = [
    { ...valid, address: "0x1111111111111111111111111111111111111111" },
    { ...valid, blockNumber: "0xf" },
    { ...valid, removed: true },
    { ...valid, blockHash: "0xabcdef" },
    { ...valid, transactionHash: "0xabcdef" },
  ];
  for (const log of illegal) {
    const options = {
      rpcUrl: "http://chain.invalid", exchange, fromBlock: 12n, toBlock: 14n,
      rpc: rpcWith([log]),
    };
    await assert.rejects(readDemandRaised(options), /admitted contract or finalized interval/u);
    await assert.rejects(readSemioticExchangeEvents(options), /admitted contract or finalized interval/u);
  }
});

test("duplicated RPC log coordinates refuse before any provider effect or double work", async () => {
  const same = {
    ...event, blockNumber: "0xd", blockHash: `0x${"44".repeat(32)}`,
    transactionHash: `0x${"55".repeat(32)}`, logIndex: "0x2",
  };
  let submitted = 0;
  const options = {
    rpcUrl: "http://chain.invalid", exchange, fromBlock: 12n, toBlock: 14n,
    rpc: rpcWith([same,same]),
  };
  await assert.rejects(readSemioticExchangeEvents(options), /duplicate chain log coordinate/u);
  await assert.rejects(projectDemandRaised({
    ...options, submitDemand: () => { submitted += 1; },
  }), /duplicate chain log coordinate/u);
  assert.equal(submitted,0);
});

test("cold-spore adapter admits canonical hires before ordered provider submission", async () => {
  const firstCarrier = new Uint8Array([0x82, 0x01, 0x02]);
  const secondCarrier = new Uint8Array([0x82, 0x03, 0x04]);
  const seen = [];
  const receipt = await invokeFinalizedDemandInterval({
    finalized: true,
    rpcUrl: "http://chain.invalid",
    exchange,
    fromBlock: 31n,
    toBlock: 32n,
    // Deliberately return the logs in reverse order: the shared chain
    // reader must restore exact causal order before effects on providers.
    rpc: rpcWith([
      logFor({ carrier: secondCarrier, blockNumber: 32, logIndex: 0 }),
      logFor({ carrier: firstCarrier, blockNumber: 31, logIndex: 0 }),
    ]),
    conformHireInput: ({ carrier }) => ({ hire: { kind: "hire", byte: carrier[1] }, canonicalCarrier: carrier }),
    selectProvider: ({ demand, hire }) => ({ id: `provider-${hire.byte}`, demand: demand.demand }),
    submitHire: async ({ demand, provider }) => {
      seen.push(demand.demand);
      return { accepted: true, provider: provider.id };
    },
  });

  assert.equal(receipt.finality.status, "finalized");
  assert.equal(receipt.witnessed, 2);
  assert.equal(receipt.nextBlock, 33n);
  assert.deepEqual(seen, [sha256(firstCarrier), sha256(secondCarrier)]);
  assert.deepEqual(receipt.invocations.map(({ submission }) => submission.provider), ["provider-1", "provider-3"]);
  assert.throws(() => { receipt.invocations.push({}); }, TypeError);
  assert.throws(() => { receipt.invocations[0].submission.accepted = false; }, TypeError);
});

test("cold-spore adapter refuses malformed or noncanonical carriers before selecting a provider", async () => {
  let selected = 0;
  const base = {
    finalized: true,
    rpcUrl: "http://chain.invalid",
    exchange,
    fromBlock: 40n,
    toBlock: 40n,
    rpc: rpcWith([logFor({ carrier: new Uint8Array([0x81, 0x01]), blockNumber: 40, logIndex: 0 })]),
    selectProvider: () => { selected += 1; return { id: "never" }; },
    submitHire: () => { throw new Error("must not submit"); },
  };

  await assert.rejects(
    invokeFinalizedDemandInterval({ ...base, conformHireInput: () => { throw new Error("malformed RMN/A2A hire input"); } }),
    /malformed RMN\/A2A hire input/,
  );
  await assert.rejects(
    invokeFinalizedDemandInterval({
      ...base,
      conformHireInput: ({ carrier }) => ({ hire: { kind: "hire" }, canonicalCarrier: new Uint8Array([...carrier, 0]) }),
    }),
    /not canonical/,
  );
  assert.equal(selected, 0);
});

test("cold-spore adapter requires an explicitly finalized interval", async () => {
  await assert.rejects(
    invokeFinalizedDemandInterval({ fromBlock: 1n, toBlock: 1n }),
    /finalized closed interval/,
  );
});

test("replays the complete exchange history in chain order", async () => {
  const cellCarrier = new Uint8Array([1]), demandCarrier = new Uint8Array([2]), offerCarrier = new Uint8Array([3]), resultCarrier = new Uint8Array([4]);
  const cellId = sha256(cellCarrier), demandId = sha256(demandCarrier), offerId = sha256(offerCarrier), resultId = sha256(resultCarrier);
  const definitions = [
    ["CellSeated", [cellId, "0x08E4B3bc9ef76b403879C0eC372d1Fd146E3a07B", `0x${"02".repeat(32)}`, cellCarrier]],
    ["CellRetired", [cellId, "0x08E4B3bc9ef76b403879C0eC372d1Fd146E3a07B"]],
    ["DemandRaised", [demandId, "0x08E4B3bc9ef76b403879C0eC372d1Fd146E3a07B", `0x${"02".repeat(32)}`, `0x${"04".repeat(32)}`, demandCarrier]],
    ["DemandOffered", [demandId, offerId, cellId, "0x08E4B3bc9ef76b403879C0eC372d1Fd146E3a07B", offerCarrier]],
    ["PurchaseMoved", [demandId, offerId, cellId, "0x08E4B3bc9ef76b403879C0eC372d1Fd146E3a07B", "0x08E4B3bc9ef76b403879C0eC372d1Fd146E3a07B"]],
    ["DemandSettled", [demandId, cellId, "0x08E4B3bc9ef76b403879C0eC372d1Fd146E3a07B", resultId, resultCarrier]],
  ];
  const logs = definitions.map(([name, args], index) => ({
    ...iface.encodeEventLog(iface.getEvent(name), args),
    blockNumber: index < 2 ? "0xb" : "0xc",
    blockHash: `0x${"44".repeat(32)}`,
    transactionHash: `0x${String(index + 1).padStart(2, "0").repeat(32)}`,
    logIndex: `0x${(index < 2 ? 1 - index : index).toString(16)}`,
  })).reverse();
  const calls = [];
  const history = await readSemioticExchangeEvents({ rpcUrl: "http://chain.invalid", exchange, fromBlock: 11n, toBlock: 12n, rpc: rpcWith(logs, calls) });
  assert.deepEqual(history.map(({ kind }) => kind), ["CellRetired", "CellSeated", "DemandRaised", "DemandOffered", "PurchaseMoved", "DemandSettled"]);
  assert.deepEqual(calls[0].params[0].topics[0], definitions.map(([name]) => iface.getEvent(name).topicHash));
  assert.equal(history[2].carrierHex, "0x02");
  assert.equal(history[5].result, resultId);
  assert.match(history[5].carrierNi, /^ni:\/\/\/sha-256;/u);
});

test("projects one chain move through receiptRmn into the existing ActivityPub projector", async () => {
  const witnessed = [{
    kind: "DemandSettled",
    chainPosition: { blockNumber: 99n, blockHash: `0x${"11".repeat(32)}`, transactionHash: `0x${"12".repeat(32)}`, logIndex: 7 },
    demand: `0x${"21".repeat(32)}`, cell: `0x${"22".repeat(32)}`, controller: "0x08E4B3bc9ef76b403879C0eC372d1Fd146E3a07B",
    result: `0x${"23".repeat(32)}`, carrierHex: "0x8101",
  }];
  const projected = await projectSemioticExchangeActivities({
    witnessed, chainId: "eip155:5615610", exchange,
    receiptRmn: (receipt) => ({ bytes: new TextEncoder().encode(JSON.stringify(receipt)) }),
    projectRmnActivity: (input) => input,
    origin: "https://actions.561.group", identifier: "semiotic-exchange", recipient: "https://www.w3.org/ns/activitystreams#Public", agentCard: "https://actions.561.group/.well-known/agent-card.json",
  });
  assert.equal(projected[0].type, "Announce");
  const receipt = JSON.parse(new TextDecoder().decode(projected[0].objectBytes));
  assert.deepEqual(receipt, semioticExchangeEventReceipt(witnessed[0], { chainId: "eip155:5615610", exchange }));
  assert.equal(receipt.position.blockNumber, "99");
});

test("A2A sources replay task, coordination, and all six public exchange moves without resident state", async () => {
  const encode = (value) => new TextEncoder().encode(JSON.stringify(value));
  const task = (state, sha) => ({ taskId: "task-1", tenant: "", sha256: sha, envelope: { protocol: "A2A", protocolVersion: "1.0", tenant: "", task: { id: "task-1", status: { state } } } });
  const records = [task("TASK_STATE_SUBMITTED", "one"), { namespace: "push-outbox", tenant: "", key: "delivery-1", value: { disposition: "pending" } }, task("TASK_STATE_WORKING", "two")];
  const kinds = ["CellSeated", "CellRetired", "DemandRaised", "DemandOffered", "PurchaseMoved", "DemandSettled"];
  const history = kinds.map((kind, index) => ({
    kind,
    chainPosition: { blockNumber: BigInt(index + 1), blockHash: `0x${"11".repeat(32)}`, transactionHash: `0x${String(index + 1).padStart(2, "0").repeat(32)}`, logIndex: 0 },
    ...(index < records.length ? { carrier: encode(records[index]), carrierHex: "0x01", carrierNi: `ni:///sha-256;${"a".repeat(42)}A` } : {}),
    ...(kind === "CellSeated" ? { cell: `0x${"01".repeat(32)}`, controller: "0x08E4B3bc9ef76b403879C0eC372d1Fd146E3a07B", law: `0x${"02".repeat(32)}` } : {}),
    ...(kind === "CellRetired" ? { cell: `0x${"01".repeat(32)}`, controller: "0x08E4B3bc9ef76b403879C0eC372d1Fd146E3a07B" } : {}),
    ...(kind === "DemandRaised" ? { demand: `0x${"03".repeat(32)}`, raiser: "0x08E4B3bc9ef76b403879C0eC372d1Fd146E3a07B", wantedLaw: `0x${"02".repeat(32)}`, grounding: `0x${"04".repeat(32)}` } : {}),
    ...(kind === "DemandOffered" ? { demand: `0x${"03".repeat(32)}`, offer: `0x${"05".repeat(32)}`, cell: `0x${"01".repeat(32)}`, controller: "0x08E4B3bc9ef76b403879C0eC372d1Fd146E3a07B" } : {}),
    ...(kind === "PurchaseMoved" ? { demand: `0x${"03".repeat(32)}`, offer: `0x${"05".repeat(32)}`, cell: `0x${"01".repeat(32)}`, raiser: "0x08E4B3bc9ef76b403879C0eC372d1Fd146E3a07B", controller: "0x08E4B3bc9ef76b403879C0eC372d1Fd146E3a07B" } : {}),
    ...(kind === "DemandSettled" ? { demand: `0x${"03".repeat(32)}`, cell: `0x${"01".repeat(32)}`, controller: "0x08E4B3bc9ef76b403879C0eC372d1Fd146E3a07B", result: `0x${"06".repeat(32)}` } : {}),
  }));
  const appended = [];
  const sources = createSemioticExchangeA2aSources({
    chainId: "eip155:5615610", exchange,
    history: async () => history,
    decodeCarrier: async (bytes) => JSON.parse(new TextDecoder().decode(bytes)),
    append: async (transition) => { appended.push(transition); return { admitted: true }; },
  });
  assert.equal((await sources.taskSource.get({ taskId: "task-1", tenant: "" })).sha256, "two");
  assert.equal((await sources.taskSource.list({ tenant: "" })).length, 1);
  assert.equal((await sources.coordinationSource.list({ namespace: "semiotic-exchange-events", tenant: "" })).length, 6);
  assert.equal((await sources.coordinationSource.get({ namespace: "push-outbox", tenant: "", key: "delivery-1" })).value.disposition, "pending");
  await sources.taskSource.put(task("TASK_STATE_COMPLETED", "three"));
  await sources.coordinationSource.remove({ namespace: "push-outbox", tenant: "", key: "delivery-1" });
  assert.deepEqual(appended.map(({ type }) => type), ["A2aTaskStateTransition", "A2aCoordinationRetraction"]);
  assert.equal(appended[0].causalPredecessor, "two");
});

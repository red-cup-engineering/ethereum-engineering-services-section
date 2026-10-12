import assert from "node:assert/strict";
import test from "node:test";

import { BASE_PUBLIC_EVM_CHAIN, BASE_PUBLIC_EVM_PROVIDERS, createPublicEvmReadPool,
  PublicEvmReadExhaustedError, PublicEvmReadLimitError } from "../src/public-evm-read.mjs";

const ADDRESS = "0x0000000000000000000000000000000000000001";
const HASH_A = `0x${"a".repeat(64)}`;
const HASH_B = `0x${"b".repeat(64)}`;

function provider(id) { return { id, url: `https://${id}.example/` }; }
function error(message, status) { return Object.assign(new Error(message), { status }); }
function pool(clients, overrides = {}) {
  return createPublicEvmReadPool({ chain: BASE_PUBLIC_EVM_CHAIN,
    providers: Object.keys(clients).map(provider), maxAttemptsPerProvider: 1,
    minimumIntervalMs: 0, schedule: async () => {}, createClient: ({ provider: selected }) => clients[selected.id],
    ...overrides });
}
function client(overrides = {}) {
  return {
    async getChainId() { return 8453; },
    async getBlock({ blockNumber } = {}) { return { number: blockNumber ?? 10n, hash: HASH_A }; },
    async request({ method }) { return method; },
    async multicall({ contracts }) { return contracts.map(({ functionName }) => functionName); },
    ...overrides,
  };
}

test("provider A's boundary then 429 replays on provider B at the same block hash", async () => {
  let firstCalls = 0;
  const invocations = [];
  const readPool = pool({
    first: client({ async request() { firstCalls += 1; if (firstCalls === 2) throw error("HTTP 429", 429); return "first-partial"; } }),
    second: client({ async request({ method }) { return `second:${method}`; } }),
    third: client({ async getChainId() { throw error("HTTP 403", 403); } }),
  });
  const result = await readPool.requestAtBoundary({ operation: async ({ provider: selected, request }) => {
    invocations.push(selected.id);
    return [await request({ method: "eth_getBalance", params: [ADDRESS] }),
      await request({ method: "eth_getCode", params: [ADDRESS] })];
  } });
  assert.deepEqual(result.value, ["second:eth_getBalance", "second:eth_getCode"]);
  assert.deepEqual(invocations, ["first", "second"]);
  assert.deepEqual(result.attempts.map(({ providerId, outcome }) => [providerId, outcome]),
    [["first", "failure"], ["second", "success"]]);
  assert.deepEqual(result.failures.map(({ status }) => status), [429]);
  assert.deepEqual(readPool.failedProviderIds(), ["first"]);
  const next = await readPool.requestAtBoundary({ boundary: result.boundary,
    method: "eth_getBalance", params: [ADDRESS] });
  assert.equal(next.provider.id, "second");
});

test("rate scheduling and transient retry replay the whole callback on one provider", async () => {
  let requestCount = 0;
  const invocations = [];
  const scheduledStages = [];
  const readPool = pool({ only: client({ async request() {
    requestCount += 1;
    if (requestCount === 2) throw error("HTTP 429", 429);
    return `read-${requestCount}`;
  } }) }, { maxAttemptsPerProvider: 2, schedule: async ({ stage }) => scheduledStages.push(stage) });
  const result = await readPool.requestAtBoundary({ operation: async ({ request }) => {
    invocations.push("start");
    return [await request({ method: "eth_getBalance", params: [ADDRESS] }),
      await request({ method: "eth_getCode", params: [ADDRESS] })];
  } });
  assert.deepEqual(invocations, ["start", "start"]);
  assert.deepEqual(result.value, ["read-3", "read-4"]);
  assert.deepEqual(result.attempts.map(({ outcome }) => outcome), ["failure", "success"]);
  assert.ok(scheduledStages.filter((stage) => stage === "verify-chain").length === 2);
});

test("propagates callback domain errors without failing over or poisoning the provider", async () => {
  const domainError = new Error("receiver policy rejected observation");
  let invocations = 0;
  const readPool = pool({ first: client(), second: client() });
  await assert.rejects(() => readPool.requestAtBoundary({ operation: async () => {
    invocations += 1;
    throw domainError;
  } }), (observed) => observed === domainError);
  assert.equal(invocations, 1);
  assert.deepEqual(readPool.failedProviderIds(), []);
  const next = await readPool.requestAtBoundary({ method: "eth_getBalance", params: [ADDRESS] });
  assert.equal(next.provider.id, "first");
});

test("provider B with a different block hash is refused before reading", async () => {
  let reads = 0;
  const readPool = pool({
    wrong: client({ async getChainId() { return 1; } }),
    fork: client({ async getBlock() { return { number: 10n, hash: HASH_B }; } }),
    exact: client({ async request() { reads += 1; return "exact"; } }),
  });
  const result = await readPool.requestAtBoundary({ boundary: { chainId: 8453, blockNumber: "10", blockHash: HASH_A },
    method: "eth_getBalance", params: [ADDRESS] });
  assert.equal(result.value, "exact");
  assert.equal(reads, 1);
  assert.match(result.failures[0].message, /chain 1/u);
  assert.match(result.failures[1].message, /block hash/u);
});

test("enforces call, batch, and operation-concurrency bounds", async () => {
  const bounded = pool({ only: client() }, { maxCallsPerOperation: 3, maxContractsPerBatch: 2,
    maxConcurrentOperations: 1 });
  await assert.rejects(() => bounded.requestAtBoundary({ operation: async ({ request }) => {
    await request({ method: "eth_getBalance", params: [ADDRESS] });
    return request({ method: "eth_getCode", params: [ADDRESS] });
  } }), PublicEvmReadLimitError);
  await assert.rejects(() => bounded.readContractsAtBoundary({ contracts: [1, 2, 3] }), PublicEvmReadLimitError);

  const serialized = pool({ only: client() }, { maxConcurrentOperations: 1 });
  let active = 0;
  let maximum = 0;
  const operation = () => serialized.requestAtBoundary({ operation: async () => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active -= 1;
    return "done";
  } });
  await Promise.all([operation(), operation(), operation()]);
  assert.equal(maximum, 1);
});

test("forces atomic Multicall3 reads with allowFailure false", async () => {
  let observed;
  const readPool = pool({ only: client({ async multicall(options) { observed = options; return ["ok"]; } }) });
  const result = await readPool.readContractsAtBoundary({ contracts: [{ address: ADDRESS, abi: [], functionName: "one" }] });
  assert.deepEqual(result.value, ["ok"]);
  assert.equal(observed.allowFailure, false);
  assert.equal(observed.multicallAddress.toLowerCase(), BASE_PUBLIC_EVM_CHAIN.multicall3.address.toLowerCase());
  assert.equal(observed.blockNumber, 10n);
  await assert.rejects(() => readPool.readContractsAtBoundary({ allowFailure: true,
    contracts: [{ address: ADDRESS, abi: [], functionName: "one" }] }), /allowFailure must be false/u);

  const partial = pool({ only: client({ async multicall() { return [{ status: "failure", error: new Error("revert") }]; } }) });
  await assert.rejects(() => partial.readContractsAtBoundary({ contracts: [{ address: ADDRESS, abi: [], functionName: "one" }] }),
    (observedError) => observedError instanceof PublicEvmReadExhaustedError
      && /failed contract read/u.test(observedError.report.failures[0].message));
});

test("reports bounded provider exhaustion and rejects credential-bearing endpoints", async () => {
  const exhausted = pool({ first: client({ async getChainId() { throw error("offline", 503); } }),
    second: client({ async getChainId() { throw error("forbidden", 403); } }) });
  await assert.rejects(() => exhausted.requestAtBoundary({ method: "eth_getBalance", params: [ADDRESS] }),
    (observed) => observed instanceof PublicEvmReadExhaustedError
      && observed.report.failures.length === 2 && observed.report.failedProviderIds.length === 2);
  assert.throws(() => createPublicEvmReadPool({ chain: BASE_PUBLIC_EVM_CHAIN,
    providers: ["https://user:secret@example.test/"] }), /credential-free/u);
  assert.throws(() => createPublicEvmReadPool({ chain: BASE_PUBLIC_EVM_CHAIN,
    providers: ["https://rpc.example.test/?apiKey=secret"] }), /credential-free/u);
  assert.deepEqual(BASE_PUBLIC_EVM_PROVIDERS.map(({ url }) => url), ["https://mainnet.base.org/",
    "https://base-rpc.publicnode.com/", "https://base.drpc.org/"]);
});

test("log reads use the pool's verified provider, enforce EIP-234 selectors, and preserve range provenance", async () => {
  let observed;
  const readPool = pool({ only: client({ async request(request) {
    observed = request;
    return [{ address: ADDRESS, topics: [HASH_A], blockHash: HASH_A, blockNumber: "0xa", transactionHash: HASH_B, logIndex: "0x0", data: "0x", removed: false }];
  } }) });
  const result = await readPool.readLogs({ providerIds: ["only"], filter: {
    address: ADDRESS, topics: [HASH_A], fromBlock: 10, toBlock: 12,
  } });
  assert.equal(result.provider.id, "only");
  assert.equal(result.boundary.blockHash, HASH_A);
  assert.equal(observed.method, "eth_getLogs");
  assert.deepEqual(observed.params[0], { address: ADDRESS, topics: [HASH_A], fromBlock: "0xa", toBlock: "0xc" });
  await assert.rejects(() => readPool.readLogs({ filter: { address: ADDRESS, blockHash: HASH_A, fromBlock: 1, toBlock: 1 } }), /exactly blockHash or fromBlock/);
  await assert.rejects(() => readPool.readLogs({ filter: { address: ADDRESS, fromBlock: 1, toBlock: 20_001 } }), PublicEvmReadLimitError);
});

test("a malformed eth_getLogs result is a provider refusal, never a successful empty observation", async () => {
  const readPool = pool({ only: client({ async request() { return { logs: [] }; } }) });
  await assert.rejects(() => readPool.readLogs({ filter: { address: ADDRESS, fromBlock: 1, toBlock: 1 } }), PublicEvmReadExhaustedError);
});

test("header reads keep number-selected boundaries and hash-selected headers separate", async () => {
  const readPool = pool({ only: client({ async getBlock({ blockHash, blockNumber } = {}) {
    if (blockHash != null) {
      assert.equal(blockHash, HASH_B);
      return { number: "0x11", hash: HASH_B, timestamp: "0x64" };
    }
    return { number: blockNumber ?? 10n, hash: HASH_A };
  } }) });
  const numbered = await readPool.readBlockHeader({ block: { blockNumber: 10 }, providerIds: ["only"] });
  assert.equal(numbered.value.blockNumber, "10");
  const selected = await readPool.readBlockHeader({ block: { blockHash: HASH_B }, providerIds: ["only"] });
  assert.equal(selected.value.blockHash, HASH_B);
  assert.equal(selected.value.blockTimestamp, "100");
  await assert.rejects(() => readPool.readBlockHeader({ block: { blockHash: HASH_A, blockNumber: 10 } }), /not both/);
});

test("log reads refuse duplicate identities and never present a supplied boundary as an unrelated range", async () => {
  const log = { address: ADDRESS, topics: [HASH_A], blockHash: HASH_A, blockNumber: "0xa", transactionHash: HASH_B, logIndex: "0x0", data: "0x", removed: false };
  const readPool = pool({ only: client({ async request() { return [log, log]; } }) });
  await assert.rejects(() => readPool.readLogs({ filter: { address: ADDRESS, topics: [HASH_A], fromBlock: 10, toBlock: 10 } }), PublicEvmReadExhaustedError);
  await assert.rejects(() => readPool.readLogs({ boundary: { chainId: 8453, blockNumber: 10, blockHash: HASH_A },
    filter: { address: ADDRESS, topics: [HASH_A], fromBlock: 9, toBlock: 10 } }), PublicEvmReadExhaustedError);
});


test("finalized selection pins reads to the observed finalized header", async () => {
  const blocks = [], requests = [];
  const readPool = pool({ only: client({
    async getBlock(input) { blocks.push(input); return { number: 8n, hash: HASH_A }; },
    async request(input) { requests.push(input); return "0x1"; },
  }) });
  const result = await readPool.requestAtBoundary({ blockTag: "finalized", method: "eth_getBalance", params: [ADDRESS] });
  assert.deepEqual(blocks, [{ blockTag: "finalized" }, { blockTag: "finalized" }]);
  assert.equal(result.boundary.blockNumber, "8");
  assert.equal(requests[0].params[1], "0x8");
  assert.deepEqual(result.finality, { finalized: true, headNumber: "8", headHash: HASH_A });
});
test("finality cannot be carried into a provider whose finalized head lags the boundary", async () => {
  let unsafeReads = 0;
  const readPool = pool({
    lagging: client({ async getBlock({blockTag}) { return {number:blockTag === "finalized" ? 9n : 10n, hash:HASH_A}; }, async request() { unsafeReads++; } }),
    ready: client({ async getBlock() { return {number:10n,hash:HASH_A}; } }),
  });
  const result = await readPool.requestAtBoundary({ boundary:{blockNumber:"10",blockHash:HASH_A}, blockTag:"finalized", method:"eth_getBalance", params:[ADDRESS] });
  assert.equal(unsafeReads,0);
  assert.equal(result.provider.id,"ready");
  assert.equal(result.failures[0].stage,"verify-finality");
  assert.equal(result.finality.finalized,true);
});
test("unsupported finality tags and conflicting finalized headers refuse reads", async () => {
  const readPool = pool({ only:client({ async getBlock({blockTag}) { return {number:10n,hash:blockTag === "finalized" ? HASH_B : HASH_A}; } }) });
  await assert.rejects(readPool.requestAtBoundary({blockTag:"pending"}), /block selection/);
  await assert.rejects(readPool.requestAtBoundary({boundary:{blockNumber:"10",blockHash:HASH_A},blockTag:"finalized",method:"eth_getBalance",params:[ADDRESS]}),PublicEvmReadExhaustedError);
});

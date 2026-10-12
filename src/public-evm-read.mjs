import { toChecksumAddress } from "@red-cup-engineering/cryptographic-computer-data-engineering-services-section/evm";

const BASE_CHAIN_ID = 8453;

/** EIP-55: accept an all-lower or all-upper address or a correctly checksummed one; return it checksummed. */
function getAddress(value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/u.test(value)) throw new Error(`Address "${value}" is invalid.`);
  const checksummed = toChecksumAddress(value), body = value.slice(2);
  if (body !== body.toLowerCase() && body !== body.toUpperCase() && value !== checksummed) throw new Error(`Address "${value}" is invalid.`);
  return checksummed;
}

const MAX_PROVIDERS = 8;
const MAX_CALLS_PER_OPERATION = 128;
const MAX_CONCURRENT_OPERATIONS = 4;
const MAX_CONTRACTS_PER_BATCH = 256;
const MAX_LOG_BLOCK_SPAN = 20_000n;
const MAX_LOG_RESULTS = 10_000;
const BASE_MULTICALL3 = Object.freeze({ address: "0xcA11bde05977b3631167028862bE2a173976CA11", blockCreated: 5022 });
const BLOCK_PARAMETER_INDEX = new Map([
  ["eth_call", 1],
  ["eth_estimateGas", 1],
  ["eth_getBalance", 1],
  ["eth_getCode", 1],
  ["eth_getStorageAt", 2],
  ["eth_getTransactionCount", 1],
  ["eth_getProof", 2],
]);

export const BASE_PUBLIC_EVM_CHAIN = Object.freeze({
  id: BASE_CHAIN_ID,
  name: "Base",
  nativeCurrency: Object.freeze({ name: "Ether", symbol: "ETH", decimals: 18 }),
  multicall3: Object.freeze({ address: BASE_MULTICALL3.address, blockCreated: BASE_MULTICALL3.blockCreated }),
});

export const BASE_PUBLIC_EVM_PROVIDERS = Object.freeze([
  Object.freeze({ id: "base-mainnet", url: "https://mainnet.base.org/" }),
  Object.freeze({ id: "base-publicnode", url: "https://base-rpc.publicnode.com/" }),
  Object.freeze({ id: "base-drpc", url: "https://base.drpc.org/" }),
]);

export class PublicEvmReadExhaustedError extends Error {
  constructor(message, report) {
    super(message);
    this.name = "PublicEvmReadExhaustedError";
    this.code = "PUBLIC_EVM_READ_EXHAUSTED";
    this.report = report;
  }
}

export class PublicEvmReadLimitError extends Error {
  constructor(message) {
    super(message);
    this.name = "PublicEvmReadLimitError";
    this.code = "PUBLIC_EVM_READ_LIMIT";
  }
}

export class PublicEvmProviderReadError extends Error {
  constructor(stage, cause) {
    super(`public EVM provider ${stage} failed: ${String(cause?.message ?? cause)}`, { cause });
    this.name = "PublicEvmProviderReadError";
    this.code = "PUBLIC_EVM_PROVIDER_READ_FAILED";
    this.stage = stage;
  }
}

function boundedInteger(name, value, fallback, minimum, maximum) {
  const selected = value ?? fallback;
  if (!Number.isInteger(selected) || selected < minimum || selected > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} through ${maximum}`);
  }
  return selected;
}

function normalizeChain(value) {
  if (!Number.isInteger(value?.id) || value.id < 1) throw new Error("chain.id must be a positive integer");
  const multicallAddress = getAddress(value?.multicall3?.address);
  const blockCreated = value?.multicall3?.blockCreated;
  if (blockCreated != null && (!Number.isInteger(blockCreated) || blockCreated < 0)) {
    throw new Error("chain.multicall3.blockCreated must be a non-negative integer");
  }
  if (value.id === BASE_CHAIN_ID && multicallAddress !== getAddress(BASE_MULTICALL3.address)) {
    throw new Error("Base reads require the official Multicall3 address");
  }
  return Object.freeze({
    id: value.id,
    name: String(value.name ?? `EVM chain ${value.id}`).slice(0, 128),
    nativeCurrency: Object.freeze({ ...(value.nativeCurrency ?? { name: "Native", symbol: "ETH", decimals: 18 }) }),
    multicall3: Object.freeze({ address: multicallAddress, blockCreated }),
  });
}

function normalizeProvider(value, index) {
  const item = typeof value === "string" ? { url: value } : value;
  let url;
  try { url = new URL(item?.url); }
  catch { throw new Error(`providers[${index}].url must be an absolute URL`); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error(`providers[${index}].url must be credential-free HTTPS without query or fragment`);
  }
  return Object.freeze({ id: String(item.id ?? `provider-${index + 1}`).slice(0, 128), url: url.href });
}

function normalizeProviders(values, maximum) {
  if (!Array.isArray(values) || values.length === 0 || values.length > maximum) {
    throw new Error(`providers must contain 1 through ${maximum} public endpoints`);
  }
  const providers = values.map(normalizeProvider);
  if (new Set(providers.map(({ id }) => id)).size !== providers.length) throw new Error("provider ids must be unique");
  if (new Set(providers.map(({ url }) => url)).size !== providers.length) throw new Error("provider URLs must be unique");
  return providers;
}

function normalizeHash(name, value) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${name} must be a block hash`);
  return value.toLowerCase();
}

function normalizeBlockNumber(name, value) {
  if (typeof value === "bigint" && value >= 0n) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)) return BigInt(value);
  if (typeof value === "string" && /^0x[0-9a-f]+$/iu.test(value)) return BigInt(value);
  throw new Error(`${name} must be a non-negative integer`);
}

function normalizeBoundary(value, chainId) {
  if (value == null) return null;
  if (value.chainId != null && value.chainId !== chainId) throw new Error(`boundary chainId must be ${chainId}`);
  return Object.freeze({
    chainId,
    blockNumber: normalizeBlockNumber("boundary.blockNumber", value.blockNumber),
    blockHash: value.blockHash == null ? null : normalizeHash("boundary.blockHash", value.blockHash),
    blockTimestamp: value.blockTimestamp == null ? null
      : normalizeBlockNumber("boundary.blockTimestamp", value.blockTimestamp),
  });
}

function publicBoundary(value) {
  return Object.freeze({ chainId: value.chainId, blockNumber: value.blockNumber.toString(), blockHash: value.blockHash,
    blockTimestamp: value.blockTimestamp == null ? null : value.blockTimestamp.toString() });
}

function errorStatus(error) {
  for (const candidate of [error?.status, error?.statusCode, error?.cause?.status, error?.cause?.statusCode]) {
    if (Number.isInteger(candidate)) return candidate;
  }
  const match = /(?:HTTP|status(?: code)?)\s*(\d{3})/iu.exec(String(error?.message ?? error));
  return match ? Number(match[1]) : null;
}

function failure(provider, stage, attempt, error) {
  return Object.freeze({
    providerId: provider.id,
    endpoint: provider.url,
    stage,
    attempt,
    status: errorStatus(error),
    code: typeof error?.code === "string" ? error.code : null,
    message: String(error?.message ?? error).slice(0, 512),
  });
}

function shouldRetryProvider(error, attempt, maximum) {
  if (attempt >= maximum) return false;
  const status = errorStatus(error);
  return status === 429 || status === 408 || (status != null && status >= 500);
}

function makeSemaphore(maximum) {
  let active = 0;
  const waiting = [];
  return async () => {
    if (active >= maximum) await new Promise((resolve) => waiting.push(resolve));
    active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      active -= 1;
      waiting.shift()?.();
    };
  };
}

function makeRateScheduler(minimumIntervalMs, now, sleep) {
  const nextAt = new Map();
  const tails = new Map();
  return async ({ provider }) => {
    const scheduled = (tails.get(provider.id) ?? Promise.resolve()).then(async () => {
      const delay = Math.max(0, (nextAt.get(provider.id) ?? 0) - now());
      if (delay > 0) await sleep(delay);
      nextAt.set(provider.id, now() + minimumIntervalMs);
    });
    tails.set(provider.id, scheduled.catch(() => {}));
    await scheduled;
  };
}

async function defaultCreateClient({ chain, provider }) {
  // The RPC client library loads only when a live read first needs a client.
  const { createPublicClient, http } = await import("viem");
  const viemChain = {
    id: chain.id,
    name: chain.name,
    nativeCurrency: chain.nativeCurrency,
    rpcUrls: { default: { http: [provider.url] } },
    contracts: { multicall3: chain.multicall3 },
  };
  return createPublicClient({ chain: viemChain, transport: http(provider.url, { retryCount: 0 }) });
}

function pinnedRequest(request, boundary) {
  const index = BLOCK_PARAMETER_INDEX.get(request?.method);
  if (index == null) throw new Error(`unsupported fixed-boundary RPC method: ${request?.method}`);
  const params = [...(request.params ?? [])];
  const tag = `0x${boundary.blockNumber.toString(16)}`;
  if (params[index] != null && params[index] !== tag) {
    throw new Error(`${request.method} block parameter must equal the selected boundary`);
  }
  params[index] = tag;
  return { method: request.method, params };
}

function hexBlock(value) {
  return `0x${value.toString(16)}`;
}

function normalizeLogTopic(value, name) {
  if (value == null) return null;
  if (typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value)) return value.toLowerCase();
  throw new Error(`${name} must be a 32-byte topic or null`);
}

function normalizeLogFilter(value, { maximumBlockSpan } = {}) {
  if (value == null || typeof value !== "object" || Array.isArray(value)) throw new Error("filter must be an object");
  const hasHash = value.blockHash != null;
  const hasRange = value.fromBlock != null || value.toBlock != null;
  if (hasHash === hasRange) throw new Error("logs filter must select exactly blockHash or fromBlock/toBlock");
  const address = getAddress(value.address).toLowerCase();
  if (!Array.isArray(value.topics ?? [])) throw new Error("filter.topics must be an array");
  const topics = value.topics == null ? [] : value.topics.map((topic, index) => normalizeLogTopic(topic, `filter.topics[${index}]`));
  if (hasHash) return Object.freeze({ address, topics: Object.freeze(topics), blockHash: normalizeHash("filter.blockHash", value.blockHash) });
  const fromBlock = normalizeBlockNumber("filter.fromBlock", value.fromBlock);
  const toBlock = normalizeBlockNumber("filter.toBlock", value.toBlock);
  if (toBlock < fromBlock) throw new Error("filter.toBlock must be greater than or equal to filter.fromBlock");
  if (toBlock - fromBlock + 1n > maximumBlockSpan) throw new PublicEvmReadLimitError(`logs filter spans more than ${maximumBlockSpan} blocks`);
  return Object.freeze({ address, topics: Object.freeze(topics), fromBlock, toBlock });
}

function publicLogFilter(filter) {
  return Object.freeze(filter.blockHash == null
    ? { address: filter.address, topics: filter.topics, fromBlock: hexBlock(filter.fromBlock), toBlock: hexBlock(filter.toBlock) }
    : { address: filter.address, topics: filter.topics, blockHash: filter.blockHash });
}

function normalizeRpcLog(value, filter, index) {
  if (value == null || typeof value !== "object" || Array.isArray(value)) throw new Error(`eth_getLogs result[${index}] must be an object`);
  const address = getAddress(value.address).toLowerCase();
  if (address !== filter.address) throw new Error(`eth_getLogs result[${index}] address does not match the filter`);
  if (!Array.isArray(value.topics)) throw new Error(`eth_getLogs result[${index}].topics must be an array`);
  const topics = value.topics.map((topic, topicIndex) => normalizeHash(`eth_getLogs result[${index}].topics[${topicIndex}]`, topic));
  for (let topicIndex = 0; topicIndex < filter.topics.length; topicIndex += 1) {
    if (filter.topics[topicIndex] != null && topics[topicIndex] !== filter.topics[topicIndex]) {
      throw new Error(`eth_getLogs result[${index}] topic does not match the filter`);
    }
  }
  const blockHash = normalizeHash(`eth_getLogs result[${index}].blockHash`, value.blockHash);
  const blockNumber = normalizeBlockNumber(`eth_getLogs result[${index}].blockNumber`, value.blockNumber);
  if (filter.blockHash != null && blockHash !== filter.blockHash) throw new Error(`eth_getLogs result[${index}] block hash does not match the filter`);
  if (filter.blockHash == null && (blockNumber < filter.fromBlock || blockNumber > filter.toBlock)) {
    throw new Error(`eth_getLogs result[${index}] block number is outside the filter range`);
  }
  const transactionHash = normalizeHash(`eth_getLogs result[${index}].transactionHash`, value.transactionHash);
  const logIndex = normalizeBlockNumber(`eth_getLogs result[${index}].logIndex`, value.logIndex);
  if (typeof value.data !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/u.test(value.data)) throw new Error(`eth_getLogs result[${index}].data must be hex bytes`);
  if (typeof value.removed !== "boolean") throw new Error(`eth_getLogs result[${index}].removed must be boolean`);
  return Object.freeze({ address, topics: Object.freeze(topics), blockHash, blockNumber: hexBlock(blockNumber),
    transactionHash, logIndex: hexBlock(logIndex), data: value.data.toLowerCase(), removed: value.removed });
}

function normalizeProviderIds(value, providers) {
  if (value == null) return providers;
  if (!Array.isArray(value) || value.length === 0) throw new Error("providerIds must be a non-empty array");
  const selected = value.map((id) => {
    if (typeof id !== "string") throw new Error("providerIds must contain provider ids");
    const provider = providers.find((candidate) => candidate.id === id);
    if (provider == null) throw new Error(`unknown public EVM provider: ${id}`);
    return provider;
  });
  if (new Set(selected.map(({ id }) => id)).size !== selected.length) throw new Error("providerIds must be unique");
  return selected;
}

function refusePartialMulticall(value) {
  if (Array.isArray(value) && value.some((entry) => entry?.status === "failure")) {
    throw new Error("Multicall3 returned a failed contract read while allowFailure is false");
  }
  return value;
}

export function createPublicEvmReadPool(options) {
  const chain = normalizeChain(options?.chain);
  const maxProviders = boundedInteger("maxProviders", options?.maxProviders, MAX_PROVIDERS, 1, MAX_PROVIDERS);
  const providers = normalizeProviders(options?.providers, maxProviders);
  const maxCallsPerOperation = boundedInteger("maxCallsPerOperation", options?.maxCallsPerOperation,
    MAX_CALLS_PER_OPERATION, 3, 4096);
  const maxConcurrentOperations = boundedInteger("maxConcurrentOperations", options?.maxConcurrentOperations,
    MAX_CONCURRENT_OPERATIONS, 1, 32);
  const maxContractsPerBatch = boundedInteger("maxContractsPerBatch", options?.maxContractsPerBatch,
    MAX_CONTRACTS_PER_BATCH, 1, 2048);
  const maxLogBlockSpan = BigInt(boundedInteger("maxLogBlockSpan", options?.maxLogBlockSpan,
    Number(MAX_LOG_BLOCK_SPAN), 1, Number(MAX_LOG_BLOCK_SPAN)));
  const maxLogResults = boundedInteger("maxLogResults", options?.maxLogResults, MAX_LOG_RESULTS, 1, MAX_LOG_RESULTS);
  const maxAttemptsPerProvider = boundedInteger("maxAttemptsPerProvider", options?.maxAttemptsPerProvider, 2, 1, 5);
  const minimumIntervalMs = boundedInteger("minimumIntervalMs", options?.minimumIntervalMs, 125, 0, 60_000);
  const now = options?.now ?? Date.now;
  const sleep = options?.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const schedule = options?.schedule ?? makeRateScheduler(minimumIntervalMs, now, sleep);
  const retryProvider = options?.retryProvider ?? shouldRetryProvider;
  const createClient = options?.createClient ?? defaultCreateClient;
  const clients = new Map();
  const clientOf = (provider) => {
    if (!clients.has(provider.id)) clients.set(provider.id, Promise.resolve(createClient({ chain, provider })));
    return clients.get(provider.id);
  };
  const failedProviders = new Set();
  const acquireSlot = makeSemaphore(maxConcurrentOperations);

  async function requestAtBoundary({ boundary: requestedBoundary, blockTag = "latest", operation, method, params, providerIds } = {}) {
    if (!["latest", "finalized"].includes(blockTag)) throw new TypeError("latest or finalized block selection required");
    const release = await acquireSlot();
    try {
      const callback = operation ?? (async ({ request }) => request({ method, params }));
      if (typeof callback !== "function") throw new Error("operation must be a function");
      let boundary = normalizeBoundary(requestedBoundary, chain.id);
      const attempts = [];
      const failures = [];
      let callCount = 0;
      const invoke = async (provider, stage, work) => {
        callCount += 1;
        if (callCount > maxCallsPerOperation) {
          throw new PublicEvmReadLimitError(`operation exceeded ${maxCallsPerOperation} provider calls`);
        }
        await schedule({ provider, stage, callCount });
        try { return await work(); }
        catch (error) { throw new PublicEvmProviderReadError(stage, error); }
      };

      const providerRefusal = (stage, messageOrError) => {
        const cause = messageOrError instanceof Error ? messageOrError : new Error(messageOrError);
        throw new PublicEvmProviderReadError(stage, cause);
      };

      for (const provider of normalizeProviderIds(providerIds, providers)) {
        if (failedProviders.has(provider.id)) continue;
        const client = await clientOf(provider);
        for (let attempt = 1; attempt <= maxAttemptsPerProvider; attempt += 1) {
          const callsBefore = callCount;
          let stage = "verify-chain";
          try {
            const selectedChainId = await invoke(provider, stage, () => client.getChainId());
            if (selectedChainId !== chain.id) providerRefusal(stage,
              `provider identified chain ${selectedChainId}, expected ${chain.id}`);
            stage = "verify-boundary";
            const selectedBlock = await invoke(provider, stage, () => boundary?.blockNumber == null
              ? client.getBlock({ blockTag }) : client.getBlock({ blockNumber: boundary.blockNumber }));
            let selectedNumber;
            let selectedHash;
            let selectedTimestamp;
            try {
              selectedNumber = normalizeBlockNumber("provider block number", selectedBlock?.number);
              selectedHash = normalizeHash("provider block hash", selectedBlock?.hash);
              selectedTimestamp = selectedBlock?.timestamp == null ? null
                : normalizeBlockNumber("provider block timestamp", selectedBlock.timestamp);
            } catch (error) { providerRefusal(stage, error); }
            if (boundary == null) boundary = Object.freeze({ chainId: chain.id, blockNumber: selectedNumber,
              blockHash: selectedHash, blockTimestamp: selectedTimestamp });
            else {
              if (selectedNumber !== boundary.blockNumber) providerRefusal(stage,
                "provider returned a different block number");
              if (boundary.blockHash == null) boundary = Object.freeze({ ...boundary, blockHash: selectedHash,
                blockTimestamp: selectedTimestamp });
              else if (selectedHash !== boundary.blockHash) providerRefusal(stage,
                "provider block hash does not match the selected boundary");
              if (boundary.blockTimestamp != null && selectedTimestamp != null
                && boundary.blockTimestamp !== selectedTimestamp) providerRefusal(stage,
                "provider block timestamp does not match the selected boundary");
              if (boundary.blockTimestamp == null && selectedTimestamp != null) {
                boundary = Object.freeze({ ...boundary, blockTimestamp: selectedTimestamp });
              }
            }
            let finality;
            if (blockTag === "finalized") {
              stage = "verify-finality";
              const head = await invoke(provider, stage, () => client.getBlock({ blockTag: "finalized" }));
              try {
                const headNumber = normalizeBlockNumber("finalized head number", head?.number);
                const headHash = normalizeHash("finalized head hash", head?.hash);
                if (headNumber < boundary.blockNumber || (headNumber === boundary.blockNumber && headHash !== boundary.blockHash)) {
                  throw new Error("selected boundary is not finalized on this provider");
                }
                finality = Object.freeze({ finalized: true, headNumber: headNumber.toString(), headHash });
              } catch (error) { providerRefusal(stage, error); }
            }
            const context = Object.freeze({
              provider,
              boundary: publicBoundary(boundary),
              request: async (request) => {
                stage = "request";
                const pinned = pinnedRequest(request, boundary);
                return invoke(provider, stage, () => client.request(pinned));
              },
              readLogs: async ({ filter } = {}) => {
                const selectedFilter = normalizeLogFilter(filter, { maximumBlockSpan: maxLogBlockSpan });
                if (requestedBoundary != null && selectedFilter.blockHash != null && selectedFilter.blockHash !== boundary.blockHash) {
                  providerRefusal("get-logs", "blockHash log filter does not match the selected boundary");
                }
                if (requestedBoundary != null && selectedFilter.blockHash == null
                  && (selectedFilter.fromBlock !== boundary.blockNumber || selectedFilter.toBlock !== boundary.blockNumber)) {
                  providerRefusal("get-logs", "range log filter must select exactly the requested boundary block");
                }
                stage = "get-logs";
                const value = await invoke(provider, stage, () => client.request({ method: "eth_getLogs", params: [publicLogFilter(selectedFilter)] }));
                if (!Array.isArray(value)) providerRefusal(stage, "eth_getLogs returned a non-array result");
                if (value.length > maxLogResults) providerRefusal(stage, `eth_getLogs returned more than ${maxLogResults} results`);
                try {
                  const logs = value.map((entry, index) => normalizeRpcLog(entry, selectedFilter, index));
                  const identities = new Set();
                  for (const log of logs) {
                    const identity = `${log.blockHash.toLowerCase()}:${log.transactionHash.toLowerCase()}:${log.logIndex.toLowerCase()}`;
                    if (identities.has(identity)) throw new Error("eth_getLogs returned a duplicate block/transaction/log identity");
                    identities.add(identity);
                  }
                  return Object.freeze(logs);
                }
                catch (error) { providerRefusal(stage, error); }
              },
              readBlockHeader: async ({ blockHash } = {}) => {
                const selectedHash = normalizeHash("block.blockHash", blockHash);
                stage = "get-block-header";
                const value = await invoke(provider, stage, () => client.getBlock({ blockHash: selectedHash }));
                try {
                  const blockNumber = normalizeBlockNumber("provider block number", value?.number);
                  const hash = normalizeHash("provider block hash", value?.hash);
                  if (hash !== selectedHash) throw new Error("provider block hash does not match the selected block");
                  return Object.freeze({ chainId: chain.id, blockNumber: blockNumber.toString(), blockHash: hash,
                    blockTimestamp: value?.timestamp == null ? null : normalizeBlockNumber("provider block timestamp", value.timestamp).toString(), endpoint: provider.url });
                } catch (error) { providerRefusal(stage, error); }
              },
              readContracts: async ({ contracts, allowFailure = false } = {}) => {
                if (allowFailure !== false) throw new Error("Multicall3 allowFailure must be false");
                if (!Array.isArray(contracts) || contracts.length === 0 || contracts.length > maxContractsPerBatch) {
                  throw new PublicEvmReadLimitError(`contracts must contain 1 through ${maxContractsPerBatch} reads`);
                }
                stage = "multicall";
                return invoke(provider, stage, async () => refusePartialMulticall(await client.multicall({ contracts,
                  allowFailure: false, blockNumber: boundary.blockNumber, multicallAddress: chain.multicall3.address })));
              },
            });
            const value = await callback(context);
            attempts.push(Object.freeze({ providerId: provider.id, endpoint: provider.url, attempt,
              outcome: "success", calls: callCount - callsBefore }));
            return Object.freeze({ boundary: publicBoundary(boundary), provider, value,
              ...(finality == null ? {} : { finality }),
              attempts: Object.freeze(attempts), failures: Object.freeze(failures), callCount });
          } catch (error) {
            if (!(error instanceof PublicEvmProviderReadError)) throw error;
            const observed = failure(provider, stage, attempt, error);
            failures.push(observed);
            attempts.push(Object.freeze({ providerId: provider.id, endpoint: provider.url, attempt,
              outcome: "failure", stage, calls: callCount - callsBefore }));
            if (retryProvider(error, attempt, maxAttemptsPerProvider) === true) continue;
            failedProviders.add(provider.id);
            break;
          }
        }
      }
      throw new PublicEvmReadExhaustedError("public EVM read providers exhausted", Object.freeze({
        boundary: boundary == null ? null : publicBoundary(boundary), attempts: Object.freeze(attempts),
        failures: Object.freeze(failures), failedProviderIds: Object.freeze([...failedProviders]), callCount,
      }));
    } finally {
      release();
    }
  }

  async function readContractsAtBoundary({ boundary, contracts, allowFailure = false, providerIds } = {}) {
    return requestAtBoundary({ boundary, providerIds, operation: ({ readContracts }) => readContracts({ contracts, allowFailure }) });
  }

  async function readLogs({ boundary, filter, providerIds } = {}) {
    return requestAtBoundary({ boundary, providerIds, operation: ({ readLogs: selectedReadLogs }) => selectedReadLogs({ filter }) });
  }

  async function readBlockHeader({ block, providerIds } = {}) {
    if (block?.blockHash != null && block?.blockNumber != null) throw new Error("block selector must contain blockHash or blockNumber, not both");
    if (block?.blockHash != null) {
      const blockHash = normalizeHash("block.blockHash", block.blockHash);
      const result = await requestAtBoundary({ providerIds,
        operation: ({ readBlockHeader: selectedReadBlockHeader }) => selectedReadBlockHeader({ blockHash }) });
      return Object.freeze({ ...result, boundary: result.value });
    }
    const boundary = { chainId: chain.id, blockNumber: normalizeBlockNumber("block.blockNumber", block?.blockNumber) };
    return requestAtBoundary({ boundary, providerIds, operation: ({ provider, boundary: selected }) =>
      Object.freeze({ ...selected, endpoint: provider.url }) });
  }

  return Object.freeze({ chain, providers, requestAtBoundary, readContractsAtBoundary, readLogs, readBlockHeader,
    failedProviderIds: () => Object.freeze([...failedProviders]) });
}

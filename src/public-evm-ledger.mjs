import { Interface, getAddress, keccak256 } from "ethers";

const PROFILE = "org.emsenn.evm.public-ledger.v1";
const TRANSFER_CATEGORIES = ["erc20", "erc721", "erc1155"];
const MAX_ACCOUNTS = 100;
const MAX_INDEX_RECORDS = 10_000;
const MAX_CONTRACTS = 2_000;
const MAX_ALCHEMY_PAGES = 100;
const RABBY_CHAIN_IDS = new Map([
  ["eth", 1n], ["op", 10n], ["bsc", 56n], ["xdai", 100n], ["matic", 137n],
  ["sonic", 146n], ["base", 8453n], ["arb", 42161n],
]);
const EIP1967_IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const EIP1967_BEACON_SLOT =
  "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50";

const erc20 = new Interface([
  "function balanceOf(address) view returns (uint256)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);
const erc165 = new Interface(["function supportsInterface(bytes4) view returns (bool)"]);
const erc721 = new Interface(["function ownerOf(uint256) view returns (address)"]);
const erc1155 = new Interface(["function balanceOf(address,uint256) view returns (uint256)"]);

function compareText(a, b) { return a.localeCompare(b); }
function uniqueSorted(values) { return [...new Set(values)].sort(compareText); }
function rawDecimal(value) { return BigInt(value).toString(); }
function lowerAddress(value) { return getAddress(value).toLowerCase(); }
function boundedText(value) { return typeof value === "string" ? value.slice(0, 256) : null; }
function nonzeroAddressFromSlot(value) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value ?? "")) return null;
  const address = `0x${value.slice(-40)}`.toLowerCase();
  return /^0x0{40}$/.test(address) ? null : lowerAddress(address);
}
function failure(scope, error) {
  return { scope, message: String(error?.message ?? error).slice(0, 500) };
}

async function mapBounded(values, limit, work) {
  const output = new Array(values.length);
  let cursor = 0;
  async function worker() {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= values.length) return;
      output[index] = await work(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => worker()));
  return output;
}

export function parseCaip10(value) {
  const match = /^(eip155):(\d+):(0x[0-9a-fA-F]{40})$/.exec(value ?? "");
  if (!match) throw new Error(`unsupported public CAIP-10 account: ${value}`);
  return { namespace: match[1], chainId: BigInt(match[2]), caip2: `${match[1]}:${match[2]}`,
    address: lowerAddress(match[3]), caip10: `${match[1]}:${match[2]}:${lowerAddress(match[3])}` };
}

export function validateSource(source) {
  if (!/^eip155:\d+$/.test(source?.caip2 ?? "")) throw new Error("source must name one eip155 CAIP-2 chain");
  for (const [field, value] of [["rpcUrl", source.rpcUrl], ["transferIndexerUrl", source.transferIndexerUrl]]) {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
      throw new Error(`${field} must be a credential-free HTTPS URL without query or fragment`);
    }
  }
  if (!["alchemy-asset-transfers", "blockscout-current-holdings", "rabby-current-holdings"].includes(source.transferIndexerKind)) {
    throw new Error("unsupported transfer indexer kind");
  }
  if (source.transferIndexerKind === "rabby-current-holdings"
      && !/^[a-z0-9_-]{1,32}$/.test(source.transferIndexerChain ?? "")) {
    throw new Error("Rabby current-holdings source requires a bounded chain slug");
  }
  if (source.transferIndexerKind === "rabby-current-holdings") {
    const indexerUrl = new URL(source.transferIndexerUrl);
    if (indexerUrl.origin !== "https://api.rabby.io" || indexerUrl.pathname !== "/") {
      throw new Error("Rabby current-holdings source must use the public api.rabby.io origin");
    }
    if (RABBY_CHAIN_IDS.get(source.transferIndexerChain) !== BigInt(source.caip2.split(":")[1])) {
      throw new Error("Rabby chain slug does not match the source CAIP-2 chain");
    }
    if (source.transferIndexerRelayUrl != null) {
      const relayUrl = new URL(source.transferIndexerRelayUrl);
      if (relayUrl.origin !== "https://r.jina.ai" || relayUrl.pathname !== "/http://api.rabby.io/"
          || relayUrl.search || relayUrl.hash || relayUrl.username || relayUrl.password) {
        throw new Error("Rabby relay must be the credential-free r.jina.ai HTTP relay for api.rabby.io");
      }
    }
  }
  if (source.transferIndexerKind === "blockscout-current-holdings") {
    const indexerUrl = new URL(source.transferIndexerUrl);
    if (indexerUrl.pathname !== "/api/v2/") {
      throw new Error("Blockscout current-holdings source must end at /api/v2/");
    }
    if (source.transferIndexerRelayUrl != null) {
      const relayUrl = new URL(source.transferIndexerRelayUrl);
      const expected = `https://r.jina.ai/http://${indexerUrl.host}${indexerUrl.pathname}`;
      if (relayUrl.href !== expected) {
        throw new Error("Blockscout relay must be the matching credential-free r.jina.ai HTTP relay");
      }
    }
  }
  return { caip2: source.caip2, rpcUrl: source.rpcUrl,
    transferIndexerKind: source.transferIndexerKind, transferIndexerUrl: source.transferIndexerUrl,
    transferIndexerChain: source.transferIndexerChain ?? null,
    transferIndexerRelayUrl: source.transferIndexerRelayUrl ?? null };
}

export async function jsonRpc(url, method, params, fetchImpl = fetch) {
  const response = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json",
    "user-agent": "@red-cup-engineering/ethereum-services-section public-read" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  if (!response.ok) throw new Error(`JSON-RPC HTTP ${response.status}`);
  const value = await response.json();
  if (value.error) throw new Error(`JSON-RPC ${value.error.code}: ${value.error.message}`);
  return value.result;
}

async function jsonGet(url, fetchImpl = fetch) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await fetchImpl(url, { method: "GET", headers: { accept: "application/json" } });
    if (response.ok) return response.json();
    if (response.status !== 429 || attempt === 4) throw new Error(`index HTTP ${response.status}`);
    const retryAfter = Number(response.headers?.get?.("retry-after"));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * (2 ** attempt);
    await new Promise((resolve) => setTimeout(resolve, Math.min(delay, 10_000)));
  }
  throw new Error("index retry state exhausted");
}

async function jsonGetViaJinaRabbyRelay(relayBase, rabbyUrl, fetchImpl = fetch) {
  const relayUrl = new URL(`${rabbyUrl.pathname.slice(1)}${rabbyUrl.search}`, relayBase);
  const response = await fetchImpl(relayUrl, { method: "GET", headers: { accept: "text/plain" } });
  if (!response.ok) throw new Error(`relay HTTP ${response.status}`);
  const text = await response.text();
  const marker = "\nMarkdown Content:\n";
  const index = text.indexOf(marker);
  if (index < 0) throw new Error("relay response omitted its Markdown Content boundary");
  try { return JSON.parse(text.slice(index + marker.length)); }
  catch { throw new Error("relay response did not carry JSON after its declared boundary"); }
}

async function jsonGetViaJinaBlockscoutRelay(relayBase, blockscoutUrl, fetchImpl = fetch) {
  const marker = "/api/v2/";
  const index = blockscoutUrl.pathname.indexOf(marker);
  if (index < 0) throw new Error("Blockscout relay target omitted /api/v2/");
  const relative = `${blockscoutUrl.pathname.slice(index + marker.length)}${blockscoutUrl.search}`;
  const relayUrl = new URL(relative, relayBase);
  const response = await fetchImpl(relayUrl, { method: "GET", headers: { accept: "text/plain" } });
  if (!response.ok) throw new Error(`relay HTTP ${response.status}`);
  const text = await response.text();
  const boundary = "\nMarkdown Content:\n";
  const boundaryIndex = text.indexOf(boundary);
  if (boundaryIndex < 0) throw new Error("relay response omitted its Markdown Content boundary");
  try { return JSON.parse(text.slice(boundaryIndex + boundary.length)); }
  catch { throw new Error("relay response did not carry JSON after its declared boundary"); }
}

async function call(source, to, iface, functionName, args, rpc, blockTag) {
  const data = iface.encodeFunctionData(functionName, args);
  const result = await rpc(source.rpcUrl, "eth_call", [{ to, data }, blockTag]);
  return iface.decodeFunctionResult(functionName, result)[0];
}

async function alchemyTransfers(source, address, direction, rpc) {
  const transfers = [];
  let pageKey;
  let pages = 0;
  do {
    pages += 1;
    if (pages > MAX_ALCHEMY_PAGES) throw new Error(`transfer index exceeds ${MAX_ALCHEMY_PAGES} pages`);
    const filter = { fromBlock: "0x0", toBlock: "latest", withMetadata: false,
      excludeZeroValue: false, maxCount: "0x3e8", category: TRANSFER_CATEGORIES };
    filter[direction === "incoming" ? "toAddress" : "fromAddress"] = address;
    if (pageKey) filter.pageKey = pageKey;
    const page = await rpc(source.transferIndexerUrl, "alchemy_getAssetTransfers", [filter]);
    for (const transfer of page?.transfers ?? []) transfers.push(transfer);
    if (transfers.length > MAX_INDEX_RECORDS) throw new Error(`transfer index exceeds ${MAX_INDEX_RECORDS} records`);
    pageKey = page?.pageKey;
  } while (pageKey);
  return transfers;
}

async function rabbyCurrentHoldings(source, address, fetchImpl) {
  const records = [];
  for (const resource of ["token_list", "nft_list"]) {
    const url = new URL(`/v1/user/${resource}`, source.transferIndexerUrl);
    url.searchParams.set("id", address);
    url.searchParams.set("chain_id", source.transferIndexerChain);
    url.searchParams.set("is_all", "true");
    const indexed = source.transferIndexerRelayUrl == null
      ? await jsonGet(url, fetchImpl)
      : await jsonGetViaJinaRabbyRelay(source.transferIndexerRelayUrl, url, fetchImpl);
    if (!Array.isArray(indexed)) throw new Error(`${resource} did not return an array`);
    for (const item of indexed) {
      if (item?.chain !== source.transferIndexerChain) continue;
      if (resource === "token_list" && item?.id) {
        records.push({ category: "erc20", rawContract: { address: item.id }, untrustedIndexClaim: {
          kind: "fungible-balance", rawBalance: item.raw_amount_hex_str != null
            ? rawDecimal(item.raw_amount_hex_str) : null,
          name: boundedText(item.name),
          symbol: boundedText(item.symbol),
          decimals: Number.isInteger(item.decimals) ? item.decimals : null,
        } });
      } else if (item?.contract_id && item?.inner_id != null) {
        records.push({ category: item.is_erc1155 === true ? "erc1155" : "erc721",
          rawContract: { address: item.contract_id }, tokenId: rawDecimal(item.inner_id),
          untrustedIndexClaim: { kind: item.is_erc1155 === true ? "erc1155-balance" : "erc721-ownership",
            tokenId: rawDecimal(item.inner_id), rawBalance: item.amount != null ? rawDecimal(item.amount) : null,
            name: boundedText(item.name) } });
      }
      if (records.length > MAX_INDEX_RECORDS) throw new Error(`current-holdings index exceeds ${MAX_INDEX_RECORDS} records`);
    }
  }
  return records;
}

async function blockscoutCurrentHoldings(source, address, fetchImpl) {
  const url = new URL(`addresses/${address}/token-balances`, source.transferIndexerUrl);
  const indexed = source.transferIndexerRelayUrl == null
    ? await jsonGet(url, fetchImpl)
    : await jsonGetViaJinaBlockscoutRelay(source.transferIndexerRelayUrl, url, fetchImpl);
  if (!Array.isArray(indexed)) throw new Error("token-balances did not return an array");
  if (indexed.length > MAX_INDEX_RECORDS) {
    throw new Error(`current-holdings index exceeds ${MAX_INDEX_RECORDS} records`);
  }
  const records = [];
  for (const item of indexed) {
    const addressHash = item?.token?.address_hash;
    const tokenType = item?.token?.type;
    if (!addressHash || !["ERC-20", "ERC-721", "ERC-1155"].includes(tokenType)) continue;
    if (tokenType === "ERC-20") {
      records.push({ category: "erc20", rawContract: { address: addressHash }, untrustedIndexClaim: {
        kind: "fungible-balance", rawBalance: item.value != null ? rawDecimal(item.value) : null,
        name: boundedText(item.token.name), symbol: boundedText(item.token.symbol),
        decimals: /^\d+$/.test(String(item.token.decimals ?? "")) ? Number(item.token.decimals) : null,
      } });
      continue;
    }
    const tokenId = item.token_id ?? item.token_instance?.id;
    if (tokenId == null) continue;
    records.push({ category: tokenType === "ERC-1155" ? "erc1155" : "erc721",
      rawContract: { address: addressHash }, tokenId: rawDecimal(tokenId),
      untrustedIndexClaim: { kind: tokenType === "ERC-1155" ? "erc1155-balance" : "erc721-ownership",
        tokenId: rawDecimal(tokenId), rawBalance: item.value != null ? rawDecimal(item.value) : null,
        name: boundedText(item.token.name) } });
  }
  return records;
}

function discover(transfers) {
  const contracts = new Map();
  for (const transfer of transfers) {
    const address = transfer?.rawContract?.address;
    if (!address) continue;
    let normalized;
    try { normalized = lowerAddress(address); } catch { continue; }
    const entry = contracts.get(normalized) ?? { address: normalized, categories: new Set(), tokenIds: new Set(), indexClaims: new Map() };
    if (TRANSFER_CATEGORIES.includes(transfer.category)) entry.categories.add(transfer.category);
    if (transfer.tokenId != null) entry.tokenIds.add(rawDecimal(transfer.tokenId));
    for (const item of transfer.erc1155Metadata ?? []) if (item?.tokenId != null) entry.tokenIds.add(rawDecimal(item.tokenId));
    if (transfer.untrustedIndexClaim) {
      const serialized = JSON.stringify(transfer.untrustedIndexClaim);
      entry.indexClaims.set(serialized, transfer.untrustedIndexClaim);
    }
    contracts.set(normalized, entry);
  }
  return [...contracts.values()].sort((a, b) => compareText(a.address, b.address));
}

async function optional(read, scope, failures) {
  try { return await read(); } catch (error) { failures.push(failure(scope, error)); return null; }
}

async function observeContract(source, account, discovered, rpc, blockTag) {
  const failures = [];
  const fungibleCandidate = discovered.categories.has("erc20");
  const nftCandidate = discovered.categories.has("erc721") || discovered.categories.has("erc1155");
  const code = await optional(() => rpc(source.rpcUrl, "eth_getCode", [discovered.address, blockTag]), "code", failures);
  const implementationSlot = await optional(() => rpc(source.rpcUrl, "eth_getStorageAt",
    [discovered.address, EIP1967_IMPLEMENTATION_SLOT, blockTag]), "eip1967-implementation", failures);
  const beaconSlot = await optional(() => rpc(source.rpcUrl, "eth_getStorageAt",
    [discovered.address, EIP1967_BEACON_SLOT, blockTag]), "eip1967-beacon", failures);
  const is721 = nftCandidate
    ? await optional(() => call(source, discovered.address, erc165, "supportsInterface", ["0x80ac58cd"], rpc, blockTag), "erc165-721", failures)
    : null;
  const is1155 = nftCandidate
    ? await optional(() => call(source, discovered.address, erc165, "supportsInterface", ["0xd9b67a26"], rpc, blockTag), "erc165-1155", failures)
    : null;
  const balance = fungibleCandidate
    ? await optional(() => call(source, discovered.address, erc20, "balanceOf", [account.address], rpc, blockTag), "balanceOf(address)", failures)
    : null;
  const name = await optional(() => call(source, discovered.address, erc20, "name", [], rpc, blockTag), "metadata-name", failures);
  const symbol = await optional(() => call(source, discovered.address, erc20, "symbol", [], rpc, blockTag), "metadata-symbol", failures);
  const decimals = fungibleCandidate
    ? await optional(() => call(source, discovered.address, erc20, "decimals", [], rpc, blockTag), "metadata-decimals", failures)
    : null;
  const tokenIds = uniqueSorted([...discovered.tokenIds].map(rawDecimal));
  const holdings = [];
  let holdingVerificationComplete = !discovered.categories.has("erc20") || balance != null;
  if ((discovered.categories.has("erc721") || discovered.categories.has("erc1155")) && tokenIds.length === 0) {
    holdingVerificationComplete = false;
  }
  if (is721 === true || discovered.categories.has("erc721")) {
    for (const tokenId of tokenIds) {
      const owner = await optional(() => call(source, discovered.address, erc721, "ownerOf", [tokenId], rpc, blockTag), `ownerOf:${tokenId}`, failures);
      if (owner == null) holdingVerificationComplete = false;
      if (owner && lowerAddress(owner) === account.address) holdings.push({ tokenId, rawBalance: "1" });
    }
  }
  if (is1155 === true || discovered.categories.has("erc1155")) {
    for (const tokenId of tokenIds) {
      const value = await optional(() => call(source, discovered.address, erc1155, "balanceOf", [account.address, tokenId], rpc, blockTag), `balanceOf:${tokenId}`, failures);
      if (value == null) holdingVerificationComplete = false;
      if (value != null && value > 0n) holdings.push({ tokenId, rawBalance: value.toString() });
    }
  }
  return { address: discovered.address, transferCategories: uniqueSorted([...discovered.categories]),
    untrustedIndexClaims: [...discovered.indexClaims.values()].sort((a, b) => compareText(JSON.stringify(a), JSON.stringify(b))),
    code: { present: code != null ? code !== "0x" : null, hash: code && code !== "0x" ? keccak256(code) : null },
    proxy: { implementation: nonzeroAddressFromSlot(implementationSlot), beacon: nonzeroAddressFromSlot(beaconSlot) },
    standards: { erc721: is721, erc1155: is1155 },
    current: { snapshotBlock: blockTag === "latest" ? null : rawDecimal(blockTag), holdingVerificationComplete,
      rawBalance: balance == null ? null : balance.toString(), tokenHoldings: holdings },
    untrustedMetadata: { name: boundedText(name), symbol: boundedText(symbol),
      decimals: decimals == null ? null : Number(decimals) }, failures };
}

export async function observePublicEvmLedger(request, dependencies = {}) {
  if (request?.profile !== PROFILE) throw new Error(`request profile must be ${PROFILE}`);
  const rpc = dependencies.rpc ?? ((url, method, params) => jsonRpc(url, method, params, dependencies.fetchImpl));
  const sources = new Map();
  for (const supplied of request.sources ?? []) {
    const source = validateSource(supplied);
    if (sources.has(source.caip2)) throw new Error(`duplicate source for ${source.caip2}`);
    sources.set(source.caip2, source);
  }
  const parsedAccounts = (request.accounts ?? []).map(parseCaip10);
  const accounts = [...new Map(parsedAccounts.map((account) => [account.caip10, account])).values()]
    .sort((a, b) => compareText(a.caip10, b.caip10));
  if (accounts.length === 0) throw new Error("at least one public account is required");
  if (accounts.length > MAX_ACCOUNTS) throw new Error(`at most ${MAX_ACCOUNTS} public accounts are admitted`);
  const contractConcurrency = dependencies.contractConcurrency ?? 4;
  if (!Number.isInteger(contractConcurrency) || contractConcurrency < 1 || contractConcurrency > 16) {
    throw new Error("contractConcurrency must be an integer from 1 through 16");
  }
  const observations = [];
  for (const account of accounts) {
    const source = sources.get(account.caip2);
    if (!source) throw new Error(`no source for ${account.caip2}`);
    if (BigInt(account.caip2.split(":")[1]) !== account.chainId) throw new Error("CAIP chain mismatch");
    const failures = [];
    const chainId = await optional(() => rpc(source.rpcUrl, "eth_chainId", []), "chain-id", failures);
    if (chainId != null && BigInt(chainId) !== account.chainId) throw new Error(`RPC chain mismatch for ${account.caip2}`);
    const snapshotBlock = await optional(() => rpc(source.rpcUrl, "eth_blockNumber", []), "snapshot-block", failures);
    const blockTag = snapshotBlock ?? "latest";
    const nativeBalance = await optional(() => rpc(source.rpcUrl, "eth_getBalance", [account.address, blockTag]), "native-balance", failures);
    const transactionCount = await optional(() => rpc(source.rpcUrl, "eth_getTransactionCount", [account.address, blockTag]), "transaction-count", failures);
    const indexed = [];
    const indexScopes = source.transferIndexerKind === "alchemy-asset-transfers"
      ? ["incoming", "outgoing"] : ["current-holdings"];
    for (const scope of indexScopes) {
      const page = await optional(
        () => source.transferIndexerKind === "alchemy-asset-transfers"
          ? alchemyTransfers(source, account.address, scope, rpc)
          : source.transferIndexerKind === "blockscout-current-holdings"
            ? blockscoutCurrentHoldings(source, account.address, dependencies.fetchImpl)
            : rabbyCurrentHoldings(source, account.address, dependencies.fetchImpl),
        `${scope}-${source.transferIndexerKind === "alchemy-asset-transfers" ? "transfers" : "index"}`,
        failures,
      );
      if (page) indexed.push(...page);
    }
    const discoveredContracts = discover(indexed);
    if (discoveredContracts.length > MAX_CONTRACTS) failures.push(failure("contract-discovery-limit",
      `index discovered ${discoveredContracts.length} contracts; only the first ${MAX_CONTRACTS} sorted addresses were verified`));
    const contracts = await mapBounded(discoveredContracts.slice(0, MAX_CONTRACTS), contractConcurrency,
      (discovered) => observeContract(source, account, discovered, rpc, blockTag));
    const discoveryComplete = !failures.some((item) => item.scope.endsWith("-index")
      || item.scope.endsWith("-transfers") || item.scope === "contract-discovery-limit");
    const verificationComplete = chainId != null && snapshotBlock != null && nativeBalance != null && transactionCount != null
      && contracts.every((contract) => contract.current.holdingVerificationComplete);
    observations.push({ account: account.caip10, chain: account.caip2,
      snapshotBlock: snapshotBlock == null ? null : rawDecimal(snapshotBlock),
      native: { rawBalance: nativeBalance == null ? null : rawDecimal(nativeBalance),
        transactionCount: transactionCount == null ? null : Number(BigInt(transactionCount)) },
      coverage: { transferIndexer: source.transferIndexerKind,
        transferIndexerTransport: source.transferIndexerRelayUrl == null ? "direct" : "untrusted-jina-http-relay",
        directions: indexScopes, categories: TRANSFER_CATEGORIES,
        transferCount: indexed.length, discoveryComplete, verificationComplete,
        complete: discoveryComplete && verificationComplete },
      contracts, failures });
  }
  return { profile: PROFILE, observationOnly: true, signerMaterialAccepted: false,
    transactionAssembly: false, chainMutation: false, observations };
}

export const PUBLIC_EVM_LEDGER_PROFILE = PROFILE;

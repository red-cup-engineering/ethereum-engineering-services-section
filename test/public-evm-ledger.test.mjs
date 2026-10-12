import assert from "node:assert/strict";
import test from "node:test";

import { Interface } from "ethers";

import { observePublicEvmLedger, parseCaip10 } from "../src/public-evm-ledger.mjs";

const account = "0x00000000000000000000000000000000000000a1";
const token = "0x00000000000000000000000000000000000000b1";
const nft = "0x00000000000000000000000000000000000000b2";
const rpcUrl = "https://public.example/rpc";
const indexUrl = "https://public.example/index";
const erc20 = new Interface(["function balanceOf(address) view returns(uint256)", "function name() view returns(string)", "function symbol() view returns(string)", "function decimals() view returns(uint8)"]);
const erc165 = new Interface(["function supportsInterface(bytes4) view returns(bool)"]);
const erc721 = new Interface(["function ownerOf(uint256) view returns(address)"]);

function encoded(iface, name, values) { return iface.encodeFunctionResult(name, values); }
function request() { return { profile: "org.emsenn.evm.public-ledger.v1",
  accounts: [`eip155:8453:${account}`], sources: [{ caip2: "eip155:8453", rpcUrl,
    transferIndexerKind: "alchemy-asset-transfers", transferIndexerUrl: indexUrl }] }; }

function fixtureRpc(reverse = false) {
  return async (url, method, params) => {
    if (method === "eth_chainId") return "0x2105";
    if (method === "eth_blockNumber") return "0x1234";
    if (method === "eth_getBalance") return "0x2a";
    if (method === "eth_getTransactionCount") return "0x3";
    if (method === "eth_getCode") return "0x6000";
    if (method === "eth_getStorageAt") return `0x${"0".repeat(64)}`;
    if (method === "alchemy_getAssetTransfers") {
      const incoming = params[0].toAddress != null;
      const values = incoming ? [
        { category: "erc721", rawContract: { address: nft }, tokenId: "0x7" },
        { category: "erc20", rawContract: { address: token } },
      ] : [{ category: "erc20", rawContract: { address: token } }];
      return { transfers: reverse ? values.reverse() : values };
    }
    if (method === "eth_call") {
      const { to, data } = params[0];
      if (data.startsWith(erc165.getFunction("supportsInterface").selector)) {
        const [id] = erc165.decodeFunctionData("supportsInterface", data);
        return encoded(erc165, "supportsInterface", [to.toLowerCase() === nft && id === "0x80ac58cd"]);
      }
      if (data.startsWith(erc20.getFunction("balanceOf").selector)) return encoded(erc20, "balanceOf", [to.toLowerCase() === token ? 123n : 1n]);
      if (data.startsWith(erc20.getFunction("name").selector)) return encoded(erc20, "name", [to.toLowerCase() === token ? "Token" : "Collectible"]);
      if (data.startsWith(erc20.getFunction("symbol").selector)) return encoded(erc20, "symbol", [to.toLowerCase() === token ? "TOK" : "NFT"]);
      if (data.startsWith(erc20.getFunction("decimals").selector)) return encoded(erc20, "decimals", [18]);
      if (data.startsWith(erc721.getFunction("ownerOf").selector)) return encoded(erc721, "ownerOf", [account]);
    }
    throw new Error(`unexpected ${url} ${method}`);
  };
}

test("parses and normalizes an EVM CAIP-10 without custody", () => {
  assert.deepEqual(parseCaip10(`eip155:8453:${account.toUpperCase().replace("0X", "0x")}`), {
    namespace: "eip155", chainId: 8453n, caip2: "eip155:8453", address: account, caip10: `eip155:8453:${account}` });
  assert.throws(() => parseCaip10("solana:mainnet:not-evm"), /unsupported public CAIP-10/);
});

test("discovers, deduplicates, sorts, and verifies current fungible and NFT holdings", async () => {
  const ledger = await observePublicEvmLedger(request(), { rpc: fixtureRpc() });
  assert.equal(ledger.observationOnly, true);
  assert.equal(ledger.signerMaterialAccepted, false);
  assert.equal(ledger.observations[0].native.rawBalance, "42");
  assert.equal(ledger.observations[0].coverage.transferCount, 3);
  assert.deepEqual(ledger.observations[0].contracts.map((item) => item.address), [token, nft]);
  assert.equal(ledger.observations[0].contracts[0].current.rawBalance, "123");
  assert.deepEqual(ledger.observations[0].contracts[1].current.tokenHoldings, [{ tokenId: "7", rawBalance: "1" }]);
});

test("output is stable when indexer transfer ordering changes", async () => {
  const a = await observePublicEvmLedger(request(), { rpc: fixtureRpc(false) });
  const b = await observePublicEvmLedger(request(), { rpc: fixtureRpc(true) });
  assert.deepEqual(a, b);
});

test("refuses credential-bearing sources and reports partial indexed coverage", async () => {
  const bad = request(); bad.sources[0].rpcUrl = "https://user:secret@example.test/rpc";
  await assert.rejects(() => observePublicEvmLedger(bad, { rpc: fixtureRpc() }), /credential-free/);
  const rpc = fixtureRpc();
  const partial = await observePublicEvmLedger(request(), { rpc: async (url, method, params) => {
    if (method === "alchemy_getAssetTransfers" && params[0].fromAddress) throw new Error("index unavailable");
    return rpc(url, method, params);
  } });
  assert.equal(partial.observations[0].coverage.complete, false);
  assert.equal(partial.observations[0].failures[0].scope, "outgoing-transfers");
});

test("uses a public current-holdings index only for discovery and verifies it onchain", async () => {
  const current = request();
  current.sources[0] = { caip2: "eip155:8453", rpcUrl,
    transferIndexerKind: "rabby-current-holdings", transferIndexerUrl: "https://api.rabby.io/",
    transferIndexerChain: "base" };
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get("id"), account);
    assert.equal(parsed.searchParams.get("chain_id"), "base");
    if (parsed.pathname.endsWith("/token_list")) return { ok: true, json: async () => [
      { chain: "base", id: token, raw_amount_hex_str: "0x0f423f", name: "Untrusted Token", symbol: "UT", decimals: 18 },
      { chain: "wrong-chain", id: "0x00000000000000000000000000000000000000ff" },
    ] };
    return { ok: true, json: async () => [
      { chain: "base", contract_id: nft, inner_id: "7", is_erc721: true },
    ] };
  };
  const ledger = await observePublicEvmLedger(current, { rpc: fixtureRpc(), fetchImpl });
  assert.deepEqual(ledger.observations[0].coverage.directions, ["current-holdings"]);
  assert.equal(ledger.observations[0].snapshotBlock, "4660");
  assert.equal(ledger.observations[0].coverage.verificationComplete, true);
  assert.equal(ledger.observations[0].coverage.transferCount, 2);
  assert.equal(ledger.observations[0].contracts[0].current.rawBalance, "123");
  assert.deepEqual(ledger.observations[0].contracts[0].untrustedIndexClaims, [{
    kind: "fungible-balance", rawBalance: "999999", name: "Untrusted Token", symbol: "UT", decimals: 18,
  }]);
  assert.deepEqual(ledger.observations[0].contracts[1].current.tokenHoldings,
    [{ tokenId: "7", rawBalance: "1" }]);
});

test("deduplicates normalized accounts and refuses a Rabby chain mismatch", async () => {
  const duplicated = request();
  duplicated.accounts.push(`eip155:8453:${account.toUpperCase().replace("0X", "0x")}`);
  const ledger = await observePublicEvmLedger(duplicated, { rpc: fixtureRpc() });
  assert.equal(ledger.observations.length, 1);
  const mismatched = request();
  mismatched.sources[0] = { caip2: "eip155:8453", rpcUrl,
    transferIndexerKind: "rabby-current-holdings", transferIndexerUrl: "https://api.rabby.io/",
    transferIndexerChain: "arb" };
  await assert.rejects(() => observePublicEvmLedger(mismatched, { rpc: fixtureRpc() }), /does not match/);
});

test("uses Blockscout balances only for discovery and verifies exact holdings onchain", async () => {
  const current = request();
  current.sources[0] = { caip2: "eip155:8453", rpcUrl,
    transferIndexerKind: "blockscout-current-holdings", transferIndexerUrl: "https://base.blockscout.com/api/v2/" };
  const fetchImpl = async (url) => {
    assert.equal(String(url), `https://base.blockscout.com/api/v2/addresses/${account}/token-balances`);
    return { ok: true, json: async () => [
      { value: "999999", token_id: null, token: { address_hash: token, type: "ERC-20",
        name: "Indexed Token", symbol: "IDX", decimals: "18" } },
      { value: "1", token_id: "7", token: { address_hash: nft, type: "ERC-721",
        name: "Indexed Collectible", symbol: "IC" } },
      { value: "5", token_id: null, token: { address_hash: token, type: "unknown" } },
    ] };
  };
  const ledger = await observePublicEvmLedger(current, { rpc: fixtureRpc(), fetchImpl });
  assert.equal(ledger.observations[0].coverage.transferIndexer, "blockscout-current-holdings");
  assert.equal(ledger.observations[0].coverage.transferCount, 2);
  assert.equal(ledger.observations[0].contracts[0].current.rawBalance, "123");
  assert.deepEqual(ledger.observations[0].contracts[0].untrustedIndexClaims, [{
    kind: "fungible-balance", rawBalance: "999999", name: "Indexed Token", symbol: "IDX", decimals: 18,
  }]);
  assert.deepEqual(ledger.observations[0].contracts[1].current.tokenHoldings,
    [{ tokenId: "7", rawBalance: "1" }]);
  const malformed = structuredClone(current);
  malformed.sources[0].transferIndexerUrl = "https://base.blockscout.com/api/";
  await assert.rejects(() => observePublicEvmLedger(malformed, { rpc: fixtureRpc(), fetchImpl }), /must end at/);
});

test("discloses an optional untrusted Rabby relay while retaining direct onchain verification", async () => {
  const current = request();
  current.sources[0] = { caip2: "eip155:8453", rpcUrl,
    transferIndexerKind: "rabby-current-holdings", transferIndexerUrl: "https://api.rabby.io/",
    transferIndexerChain: "base", transferIndexerRelayUrl: "https://r.jina.ai/http://api.rabby.io/" };
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin, "https://r.jina.ai");
    assert.match(parsed.pathname, /^\/http:\/\/api\.rabby\.io\/v1\/user\/(?:token_list|nft_list)$/u);
    const body = parsed.pathname.endsWith("token_list")
      ? [{ chain: "base", id: token, raw_amount_hex_str: "0x7b", name: "Relay Token", symbol: "RT", decimals: 18 }]
      : [{ chain: "base", contract_id: nft, inner_id: "7", is_erc721: true }];
    return { ok: true, text: async () => `Title: \n\nURL Source: http://api.rabby.io${parsed.pathname}\n\nMarkdown Content:\n${JSON.stringify(body)}` };
  };
  const ledger = await observePublicEvmLedger(current, { rpc: fixtureRpc(), fetchImpl });
  assert.equal(ledger.observations[0].coverage.transferIndexerTransport, "untrusted-jina-http-relay");
  assert.equal(ledger.observations[0].contracts[0].current.rawBalance, "123");
  assert.deepEqual(ledger.observations[0].contracts[1].current.tokenHoldings,
    [{ tokenId: "7", rawBalance: "1" }]);
  const bad = structuredClone(current);
  bad.sources[0].transferIndexerRelayUrl = "https://relay.example/http://api.rabby.io/";
  await assert.rejects(() => observePublicEvmLedger(bad, { rpc: fixtureRpc(), fetchImpl }), /r\.jina\.ai/);
});

test("discloses a matching Blockscout relay and refuses a relay for another origin", async () => {
  const current = request();
  current.sources[0] = { caip2: "eip155:8453", rpcUrl,
    transferIndexerKind: "blockscout-current-holdings", transferIndexerUrl: "https://base.blockscout.com/api/v2/",
    transferIndexerRelayUrl: "https://r.jina.ai/http://base.blockscout.com/api/v2/" };
  const fetchImpl = async (url) => {
    assert.equal(String(url), `https://r.jina.ai/http://base.blockscout.com/api/v2/addresses/${account}/token-balances`);
    const body = [{ value: "999999", token_id: null, token: { address_hash: token, type: "ERC-20",
      name: "Relayed Token", symbol: "RLY", decimals: "18" } }];
    return { ok: true, text: async () => `Title: \n\nURL Source: http://base.blockscout.com/api/v2/\n\nMarkdown Content:\n${JSON.stringify(body)}` };
  };
  const ledger = await observePublicEvmLedger(current, { rpc: fixtureRpc(), fetchImpl });
  assert.equal(ledger.observations[0].coverage.transferIndexerTransport, "untrusted-jina-http-relay");
  assert.equal(ledger.observations[0].contracts[0].current.rawBalance, "123");
  const bad = structuredClone(current);
  bad.sources[0].transferIndexerRelayUrl = "https://r.jina.ai/http://arbitrum.blockscout.com/api/v2/";
  await assert.rejects(() => observePublicEvmLedger(bad, { rpc: fixtureRpc(), fetchImpl }), /matching credential-free/);
});

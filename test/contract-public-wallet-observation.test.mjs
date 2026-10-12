import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { Interface } from "ethers";
import { querySettlementRecords } from "@lenticule-science/witness-journal-rdf-projection-service/client";
import { startWitnessJournalProviderProcess } from "@lenticule-science/witness-journal-rdf-projection-service/test-provider";

import { observePublicWallet, run } from "../src/contract-public-wallet-observation.mjs";

const AT = "2026-07-21T18:00:00.000Z";
const CUSTOMER = "urn:ame:agrodao";
const PROVIDER = "urn:ame:ethereum-services-section";
const ACCOUNT = "eip155:42161:0x224C08A8526751887a83e2711B167f890c6D078d";
const REQUEST = { account: ACCOUNT, intendedUse: "AGRODAO Yanagi public treasury disclosure", scope: "gmx-arbitrum-public-position" };
const CONTEXT = "https://www.w3.org/ns/activitystreams";
const BASE_ACCOUNT = "0x224C08A8526751887a83e2711B167f890c6D078d";
const BASE_TOKEN = "0x4200000000000000000000000000000000000006";

import { digest } from "../src/contract-public-wallet-observation.mjs";
function identify(body) { return { id: digest(body), ...body }; }
function networkEvidence() {
  const objects = new Map(), memberships = new Map();
  const custody = {
    async put({ ni, bytes, mediaType }) {
      objects.set(ni, { ni, bytes: Buffer.from(bytes), mediaType });
      return { profile: "org.red-cup-engineering.immutable-content-reference.v1", ni, key: ni, byteLength: bytes.length, mediaType };
    },
    async get(reference) { return objects.get(typeof reference === "string" ? reference : reference.ni) ?? null; },
  };
  const categoryIndex = {
    async add({ predicate, category, ni }) {
      const key = `${predicate}\n${category}`;
      if (!memberships.has(key)) memberships.set(key, new Set());
      memberships.get(key).add(ni);
      return { predicate, category, ni };
    },
    async query(category, { predicate }) {
      return { references: [...(memberships.get(`${predicate}\n${category}`) ?? [])].map((ni) => ({ ni })), continuationToken: undefined };
    },
  };
  return { custody, categoryIndex };
}

function fixtureFetch(fail = new Set()) {
  return async (url, init = {}) => {
    const source = url.includes("/positions?") ? "positions" : url.includes("/orders?") ? "orders"
      : url.includes("/staking/power?") ? "staking" : url.includes("prices/tickers") ? "oracle"
        : url.includes("/api/graphql") ? "claims" : "balances";
    if (fail.has(source)) throw new Error("fixture-unavailable");
    if (source === "positions") return [];
    if (source === "orders") return [];
    if (source === "staking") return { currentStaked: "740317467429280984", historicalMaxStaked: "740317467429280984", projectedRewardShare: "39172556409776732" };
    if (source === "oracle") return [{ tokenAddress: "0xdF03EEd325b82bC1d4Db8b49c30ecc9E05104b96", minPrice: "1366253000000000000000000000000", maxPrice: "1366375000000000000000000000000" }];
    if (source === "claims") {
      assert.equal(init.method, "POST"); assert.doesNotMatch(init.body, /mnemonic|private|seed/i);
      return { data: { claimableAmounts: [{ distributionId: "11802763389053472339483616176459046875189472617101418668457790595837638713068",
        token: "0x528A5bac7E746C9A509A1f4F6dF58A03d44279F9", amount: "4149456793756073183", account: ACCOUNT.split(":").at(-1) }] } };
    }
    return [
      { token: { address_hash: "0xdF03EEd325b82bC1d4Db8b49c30ecc9E05104b96", type: "ERC-20" }, token_id: null, value: "9116172534368098201" },
      { token: { address_hash: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", type: "forged-kind" }, token_id: null, value: "malformed" },
      { token: { address_hash: "0xAEDeF7904CECc1672a5Eb03AC53E00003E25ba56", type: "ERC-20", symbol: "visit.example" }, token_id: null, value: "999" },
    ];
  };
}

test("normalizes allowlisted public evidence and suppresses unsolicited token metadata", async () => {
  const observation = await observePublicWallet(REQUEST, AT, { fetchJson: fixtureFetch() });
  assert.equal(observation.account, ACCOUNT);
  assert.equal(observation.completeness, "complete");
  assert.equal(observation.positions.openCount, 0);
  assert.equal(observation.orders.openCount, 0);
  assert.equal(observation.holdings.length, 1);
  assert.equal(observation.holdings[0].symbol, "GLV-WBTC-USDC");
  assert.equal(observation.suppressedUntrustedAssetCount, 1);
  assert.equal(observation.invalidTrustedAssetCount, 1);
  assert.equal(observation.glpCompensation.legalAcceptanceRequired, true);
  assert.equal(observation.glpCompensation.claimables[0].rawAmount, "4149456793756073183");
  assert.equal(observation.credentialAccess, false);
  assert.equal(observation.transactionAssembly, false);
});

test("marks a source outage partial and fails closed when every source is unavailable", async () => {
  const partial = await observePublicWallet(REQUEST, AT, { fetchJson: fixtureFetch(new Set(["orders"])) });
  assert.equal(partial.completeness, "partial");
  assert.equal(partial.orders.openCount, null);
  assert.equal(partial.sources.find((source) => source.id === "gmx-orders").status, "unavailable");
  await assert.rejects(() => observePublicWallet(REQUEST, AT, { fetchJson: fixtureFetch(new Set(["positions", "orders", "staking", "oracle", "claims", "balances"])) }), /all public observation sources/);
});

test("dispatches a bounded multi-account ledger scope with index claims verified onchain", async () => {
  const token = new Interface(["function balanceOf(address) view returns(uint256)", "function name() view returns(string)",
    "function symbol() view returns(string)", "function decimals() view returns(uint8)"]);
  const request = { accounts: [`eip155:8453:${BASE_ACCOUNT}`], intendedUse: "AGRODAO deterministic Base treasury inventory",
    scope: "public-evm-ledger", sources: [{ caip2: "eip155:8453", rpcUrl: "https://base.example/rpc",
      transferIndexerKind: "blockscout-current-holdings", transferIndexerUrl: "https://base.blockscout.com/api/v2/" }] };
  const rpc = async (_url, method, params) => {
    if (method === "eth_chainId") return "0x2105";
    if (method === "eth_blockNumber") return "0x1234";
    if (method === "eth_getBalance" || method === "eth_getTransactionCount") return "0x0";
    if (method === "eth_getCode") return "0x6000";
    if (method === "eth_getStorageAt") return `0x${"0".repeat(64)}`;
    if (method === "eth_call") {
      const data = params[0].data;
      if (data.startsWith(token.getFunction("balanceOf").selector)) return token.encodeFunctionResult("balanceOf", [42n]);
      if (data.startsWith(token.getFunction("name").selector)) return token.encodeFunctionResult("name", ["Wrapped Ether"]);
      if (data.startsWith(token.getFunction("symbol").selector)) return token.encodeFunctionResult("symbol", ["WETH"]);
      if (data.startsWith(token.getFunction("decimals").selector)) return token.encodeFunctionResult("decimals", [18]);
    }
    throw new Error(`unexpected ${method}`);
  };
  const fetchImpl = async () => ({ ok: true, json: async () => [{ value: "999", token_id: null,
    token: { address_hash: BASE_TOKEN, type: "ERC-20", name: "Indexed WETH", symbol: "IWETH", decimals: "18" } }] });
  const observation = await observePublicWallet(request, AT, { rpc, fetchImpl });
  assert.equal(observation.type, "PublicEvmLedgerObservation");
  assert.equal(observation.ledger.observations[0].snapshotBlock, "4660");
  assert.equal(observation.ledger.observations[0].contracts[0].current.rawBalance, "42");
  assert.equal(observation.ledger.observations[0].contracts[0].untrustedIndexClaims[0].rawBalance, "999");
  assert.equal(observation.ledger.observations[0].coverage.complete, true);
  assert.equal(observation.signerMaterialAccepted, false);
});

test("performs an exact offer and invocation without transaction authority", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "ethereum-public-observation-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const witnessJournal = await startWitnessJournalProviderProcess(); t.after(async () => witnessJournal.close());
  const env = { ETHEREUM_OBSERVATION_DATA_ROOT: root, WITNESS_JOURNAL_RDF_AGENT: witnessJournal.agentCardUrl };
  const evidence = networkEvidence();
  const observer = (request, at) => observePublicWallet(request, at, { fetchJson: fixtureFetch() });
  const solicitation = identify({ "@context": CONTEXT, type: "Offer", actor: CUSTOMER, target: PROVIDER,
    object: { type: "ServiceSolicitation", request: REQUEST }, published: AT });
  const offer = await run(solicitation, "solicit-service", AT, env, observer, evidence);
  assert.equal(offer.type, "Offer");
  const acceptance = identify({ "@context": CONTEXT, type: "Accept", actor: CUSTOMER, target: PROVIDER,
    object: { type: "ServiceContract",
      offer, termsAcceptance: { termDigest: offer.object.termsDigest, acceptedBy: CUSTOMER }, capability: { type: "Capability",
        holder: PROVIDER, invocationTarget: PROVIDER, parentOffer: offer.id, attenuation: { sourceObservationDigest: offer.object.sourceObservationDigest },
        capTP: { target: PROVIDER, method: "invoke-service" }, allowedActions: ["invoke-service", "public-network-read", "provider-local-witness-journal-evidence"] } }, published: AT });
  const result = await run(acceptance, "invoke-service", AT, env, observer, evidence);
  assert.equal(result.type, "Accept");
  assert.equal(result.object.exchange.observation.transactionAssembly, false);
  assert.equal(result.object.receipt.assetSettlementClaimed, false);
  assert.equal((await querySettlementRecords("ethereum-services.public-wallet-observation-receipt", evidence)).length, 1);
});

test("refuses any request shape that carries signer material", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "ethereum-public-observation-refusal-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const witnessJournal = await startWitnessJournalProviderProcess(); t.after(async () => witnessJournal.close());
  const env = { ETHEREUM_OBSERVATION_DATA_ROOT: root, WITNESS_JOURNAL_RDF_AGENT: witnessJournal.agentCardUrl };
  const evidence = networkEvidence();
  const request = { ...REQUEST, privateKey: "forbidden" };
  const solicitation = identify({ "@context": CONTEXT, type: "Offer", actor: CUSTOMER, target: PROVIDER,
    object: { type: "ServiceSolicitation", request }, published: AT });
  const result = await run(solicitation, "solicit-service", AT, env, async () => { throw new Error("must not observe"); }, evidence);
  assert.equal(result.type, "Reject");
  assert.match(result.object.reason, /contain only/);
  assert.equal(result.object.credentialAccess, false);
});

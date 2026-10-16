#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getAddress } from "ethers";
import { EMPTY_WITNESS_ROOT, identifyJsonSemanticContent } from "@red-cup-engineering/computer-data-engineering-services-section/semiotic-expression-notation/semantic-content-identity";
import { queryWitnessJournalDocumentsByCategory, recordSettlementRecord } from "@red-cup-engineering/witness-journal-document-service";

import { PUBLIC_EVM_LEDGER_PROFILE, observePublicEvmLedger } from "./public-evm-ledger.mjs";
import { ACTIVITYSTREAMS_CONTEXT } from "@red-cup-engineering/activitypub-services-section/activitystreams";

const ACTOR = "urn:ame:ethereum-services-section";
const SETTLEMENT = "eip155:31337:0x9a1ace657ad8688fb1236291c0e30d934931290f";
const NODE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OBSERVATION_CATEGORY = "ethereum-services.public-wallet-source-observation";
const EFFECTS = ["public-network-read", "provider-local-witness-journal-evidence"];

const TRUSTED_CONTRACTS = new Map(Object.entries({
  "0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f": { symbol: "WBTC", decimals: 8, kind: "ERC-20", role: "settlement-asset" },
  "0x82af49447d8a07e3bd95bd0d56f35241523fbab1": { symbol: "WETH", decimals: 18, kind: "ERC-20", role: "settlement-asset" },
  "0x1addd80e6039594ee970e5872d247bf0414c8903": { symbol: "fsGLP", decimals: 18, kind: "ERC-20", role: "deprecated-gmx-v1-liquidity-receipt" },
  "0xdf03eed325b82bc1d4db8b49c30ecc9e05104b96": { symbol: "GLV-WBTC-USDC", decimals: 18, kind: "ERC-20", role: "gmx-v2-liquidity-vault" },
  "0x528a5bac7e746c9a509a1f4f6df58a03d44279f9": { symbol: "GLV-ETH-USDC", decimals: 18, kind: "ERC-20", role: "gmx-v2-liquidity-vault" },
  "0xd2d1162512f927a7e282ef43a362659e4f2a728f": { symbol: "sbfGMX", decimals: 18, kind: "ERC-20", role: "gmx-staking-receipt" },
  "0x2a29d3a792000750807cc401806d6fd539928481": { symbol: "GMX_DAO", decimals: 18, kind: "ERC-20", role: "gmx-governance-receipt" },
  "0x7dc468d3d1417bc3628c73bb5dfbac50bf3d0a5d": { symbol: "GBC-WEARABLE", decimals: null, kind: "ERC-1155", role: "gmx-community-collectible" },
}));

const SOURCE_IDS = ["gmx-positions", "gmx-orders", "gmx-staking-power", "gmx-oracle", "gmx-glp-compensation", "arbitrum-blockscout"];

export function digest(value) {
  return identifyJsonSemanticContent({ objectKind: "ethereum.contract-public-wallet-observation", value, witnessRoot: EMPTY_WITNESS_ROOT }).token;
}
function identify(body) { return { id: digest(body), ...body }; }
function contentValid(value) { const { id: _id, ...body } = value ?? {}; return value?.id === digest(body); }
function arg(flag, argv = process.argv) { const index = argv.indexOf(flag); return index < 0 ? undefined : argv[index + 1]; }
export function cliOperation(argv = process.argv) {
  return arg("--operation", argv)
    ?? (basename(argv[1] ?? "") === "solicit-public-wallet-observation" ? "solicit-service" : "invoke-service");
}
function instant() { return arg("--now") ?? new Date().toISOString(); }
function dataRoot(env = process.env) { return resolve(env.ETHEREUM_OBSERVATION_DATA_ROOT ?? join(NODE_ROOT, "data")); }
function witnessJournalAgent(env = process.env) {
  if (!env.WITNESS_JOURNAL_RDF_AGENT) throw new Error("WITNESS_JOURNAL_RDF_AGENT must name the Ethereum provider's contracted witness-journal RDF provider");
  return env.WITNESS_JOURNAL_RDF_AGENT;
}
async function append(root, category, record, at, env, evidence) {
  return recordSettlementRecord({ agentUrl: witnessJournalAgent(env), settlement: SETTLEMENT,
    actor: ACTOR, category, recordedAt: at, record, ...evidence });
}
async function defaultFetchJson(url, init = {}) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000), headers: { accept: "application/json", ...(init.headers ?? {}) } });
  if (!response.ok) throw new Error(`http-${response.status}`);
  return response.json();
}
function parseAccount(caip10) {
  const match = /^eip155:(\d+):(0x[0-9a-fA-F]{40})$/.exec(caip10 ?? "");
  if (!match) throw new Error("account must be a CAIP-10 EVM account");
  if (match[1] !== "42161") throw new Error("only eip155:42161 is supported by this observation profile");
  const address = getAddress(match[2]);
  return { chainId: 42161, address, caip10: `eip155:42161:${address}` };
}
async function settleSource(id, work) {
  try { return { id, status: "fulfilled", value: await work() }; }
  catch { return { id, status: "unavailable", reason: "source-unavailable" }; }
}
function uintString(value) { const text = String(value ?? ""); return /^\d+$/.test(text) ? text : null; }
function normalizeBalances(rows) {
  const holdings = []; let suppressedUntrustedAssetCount = 0; let invalidTrustedAssetCount = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    const address = row?.token?.address_hash?.toLowerCase(); const trust = TRUSTED_CONTRACTS.get(address);
    if (!trust) { suppressedUntrustedAssetCount += 1; continue; }
    const rawBalance = uintString(row.value); if (rawBalance == null) { invalidTrustedAssetCount += 1; continue; }
    holdings.push({ contract: getAddress(address), tokenId: row.token_id ?? null, kind: trust.kind,
      symbol: trust.symbol, role: trust.role, decimals: trust.decimals, rawBalance, evidenceClass: "contract-allowlisted" });
  }
  holdings.sort((a, b) => `${a.contract}:${a.tokenId ?? ""}`.localeCompare(`${b.contract}:${b.tokenId ?? ""}`));
  return { holdings, suppressedUntrustedAssetCount, invalidTrustedAssetCount };
}
function normalizePrices(rows) {
  return (Array.isArray(rows) ? rows : []).flatMap((row) => {
    const address = row?.tokenAddress?.toLowerCase(); const trust = TRUSTED_CONTRACTS.get(address);
    const minPrice = uintString(row?.minPrice); const maxPrice = uintString(row?.maxPrice);
    return trust && minPrice != null && maxPrice != null ? [{ contract: getAddress(address), symbol: trust.symbol, minPrice, maxPrice, evidenceClass: "official-gmx-oracle" }] : [];
  }).sort((a, b) => a.contract.localeCompare(b.contract));
}
function normalizeClaims(rows) {
  return (Array.isArray(rows) ? rows : []).flatMap((row) => {
    const address = row?.token?.toLowerCase(); const trust = TRUSTED_CONTRACTS.get(address);
    const distributionId = uintString(row?.distributionId); const rawAmount = uintString(row?.amount);
    return trust && distributionId != null && rawAmount != null ? [{ distributionId, token: getAddress(address), symbol: trust.symbol,
      rawAmount, evidenceClass: "official-gmx-indexer" }] : [];
  }).sort((a, b) => a.token.localeCompare(b.token));
}

export async function observePublicWallet(request, at = new Date().toISOString(), io = {}) {
  if (request?.scope === "public-evm-ledger") {
    const ledger = await observePublicEvmLedger({ profile: PUBLIC_EVM_LEDGER_PROFILE,
      accounts: request.accounts, sources: request.sources }, io);
    return identify({ type: "PublicEvmLedgerObservation",
      scope: request.scope, intendedUse: request.intendedUse, observedAt: at, ledger,
      credentialAccess: false, signerMaterialAccepted: false, transactionAssembly: false, chainMutation: false,
      limits: ["public-indexes-are-discovery-only", "snapshot-blocks-may-differ-by-account",
        "contract-metadata-is-untrusted", "no-beneficial-ownership-conclusion", "no-transaction-authority"] });
  }
  const account = parseAccount(request?.account); const fetchJson = io.fetchJson ?? defaultFetchJson; const encoded = encodeURIComponent(account.address);
  const graphql = { query: "query ($account: String!) { claimableAmounts(where: { account_eq: $account }, limit: 20) { distributionId token amount account } }", variables: { account: account.address } };
  const sources = await Promise.all([
    settleSource("gmx-positions", () => fetchJson(`https://arbitrum.gmxapi.io/v1/positions?address=${encoded}&includeRelatedOrders=true`)),
    settleSource("gmx-orders", () => fetchJson(`https://arbitrum.gmxapi.io/v1/orders?address=${encoded}`)),
    settleSource("gmx-staking-power", () => fetchJson(`https://arbitrum.gmxapi.io/v1/staking/power?address=${encoded}`)),
    settleSource("gmx-oracle", () => fetchJson("https://arbitrum-api.gmxinfra.io/prices/tickers")),
    settleSource("gmx-glp-compensation", () => fetchJson("https://gmx.squids.live/gmx-synthetics-arbitrum:prod/api/graphql", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(graphql) })),
    settleSource("arbitrum-blockscout", () => fetchJson(`https://arbitrum.blockscout.com/api/v2/addresses/${encoded}/token-balances`)),
  ]);
  const byId = new Map(sources.map((source) => [source.id, source])); const fulfilled = sources.filter((source) => source.status === "fulfilled").length;
  if (fulfilled === 0) throw new Error("all public observation sources are unavailable");
  const positions = byId.get("gmx-positions")?.value; const orders = byId.get("gmx-orders")?.value;
  const staking = byId.get("gmx-staking-power")?.value ?? {}; const balanceView = normalizeBalances(byId.get("arbitrum-blockscout")?.value);
  return identify({ type: "PublicEvmWalletObservation",
    account: account.caip10, scope: request.scope, completeness: fulfilled === SOURCE_IDS.length ? "complete" : "partial",
    observedAt: at, sources: sources.map(({ value: _value, ...source }) => source).sort((a, b) => a.id.localeCompare(b.id)),
    positions: { openCount: Array.isArray(positions) ? positions.length : null, evidenceClass: "official-gmx-api" },
    orders: { openCount: Array.isArray(orders) ? orders.length : null, evidenceClass: "official-gmx-api" },
    staking: { currentStakedGmxRaw: uintString(staking.currentStaked), historicalMaxStakedGmxRaw: uintString(staking.historicalMaxStaked),
      projectedRewardShareRaw: uintString(staking.projectedRewardShare), evidenceClass: "official-gmx-api" },
    holdings: balanceView.holdings, suppressedUntrustedAssetCount: balanceView.suppressedUntrustedAssetCount,
    invalidTrustedAssetCount: balanceView.invalidTrustedAssetCount,
    oraclePrices: normalizePrices(byId.get("gmx-oracle")?.value),
    glpCompensation: { legalAcceptanceRequired: true,
      terms: "ipfs://bafkreiemqapoduhh2j5spg7ndmkqdx2l5s2uloqqcv4egu5qiy5oiv4kaq",
      claimables: normalizeClaims(byId.get("gmx-glp-compensation")?.value?.data?.claimableAmounts) },
    limits: ["public-source-observation-not-custody-title", "untrusted-token-metadata-suppressed", "malformed-trusted-source-values-suppressed", "no-transaction-authority",
      "no-claim-eligibility-warranty", "prices-are-raw-source-values-not-financial-advice", "arbitrum-gmx-scope-only"],
    credentialAccess: false, signerMaterialAccepted: false, transactionAssembly: false, chainMutation: false });
}

function response(type, source, object, at) {
  return identify({ "@context": ACTIVITYSTREAMS_CONTEXT, type, actor: ACTOR, target: source?.actor ?? null, inReplyTo: source?.id ?? null,
    object, published: at });
}
async function reject(root, source, reason, at, env, evidence) {
  const value = response("Reject", source, { type: "PublicEvmWalletObservationRefusal",
    reason, prohibitedEffectsPerformed: false, credentialAccess: false, signerMaterialAccepted: false,
    transactionAssembly: false, chainMutation: false, customerMutation: false }, at);
  await append(root, "ethereum-services.public-wallet-observation-refusal", value, at, env, evidence); return value;
}
function solicitationProblem(activity) {
  if (activity?.["@context"] !== ACTIVITYSTREAMS_CONTEXT || activity.type !== "Offer" || activity.target !== ACTOR || activity.object?.type !== "ServiceSolicitation") return "solicitation must be an ActivityStreams Offer<ServiceSolicitation> addressed to the provider";
  const request = activity.object.request; const keys = Object.keys(request ?? {}).sort().join(",");
  if (request?.scope === "public-evm-ledger") {
    if (keys !== "accounts,intendedUse,scope,sources" || typeof request.intendedUse !== "string" || request.intendedUse.length === 0
        || !Array.isArray(request.accounts) || !Array.isArray(request.sources)) {
      return "public-evm-ledger request must contain only bounded accounts, intendedUse, scope, and credential-free sources";
    }
  } else {
    if (keys !== "account,intendedUse,scope" || request?.scope !== "gmx-arbitrum-public-position" || typeof request.intendedUse !== "string" || request.intendedUse.length === 0) return "request must contain only account, gmx-arbitrum-public-position scope, and a nonempty intendedUse";
    try { parseAccount(request.account); } catch (error) { return error.message; }
  }
  return null;
}
async function solicit(root, activity, at, env, observer, evidence) {
  const invalid = solicitationProblem(activity); if (invalid) return reject(root, activity, invalid, at, env, evidence);
  let observation; try { observation = await observer(activity.object.request, at); }
  catch (error) { return reject(root, activity, error.message === "all public observation sources are unavailable" ? error.message : "public observation failed closed", at, env, evidence); }
  await append(root, OBSERVATION_CATEGORY, observation, at, env, evidence);
  const terms = { type: "UnpricedServiceTerms", assetPaymentRequired: false,
    legalAcceptancePerformed: false, transactionAuthorityGranted: false, credentialAccessGranted: false };
  const object = { type: "ExecutableServiceOffer", request: activity.object.request,
    requestDigest: digest(activity.object.request), sourceObservationDigest: observation.id, terms, termsDigest: digest(terms),
    operation: "invoke-service", effects: EFFECTS };
  const offer = response("Offer", activity, object, at); await append(root, "ethereum-services.public-wallet-observation-offer", offer, at, env, evidence); return offer;
}
async function sourceObservation(root, id, evidence) {
  return (await queryWitnessJournalDocumentsByCategory(OBSERVATION_CATEGORY, evidence)).map((document) => document.value?.record).find((record) => record?.id === id);
}
async function invocationProblem(activity, root, evidence) {
  if (activity?.["@context"] !== ACTIVITYSTREAMS_CONTEXT || activity.type !== "Accept" || activity.target !== ACTOR) return "invocation must be an ActivityStreams Accept addressed to the provider";
  const contract = activity.object; const offer = contract?.offer; const capability = contract?.capability; const actions = capability?.allowedActions ?? [];
  if (contract?.type !== "ServiceContract" || offer?.actor !== ACTOR || !contentValid(offer)) return "invocation must accept the exact provider-authored offer";
  if (offer.object?.requestDigest !== digest(offer.object?.request) || offer.object?.termsDigest !== digest(offer.object?.terms) || contract.termsAcceptance?.termDigest !== offer.object.termsDigest) return "accepted request or terms changed";
  if (!await sourceObservation(root, offer.object.sourceObservationDigest, evidence)) return "offered source observation is unavailable from provider evidence";
  if (capability?.holder !== ACTOR || capability.invocationTarget !== ACTOR || capability.parentOffer !== offer.id || capability.attenuation?.sourceObservationDigest !== offer.object.sourceObservationDigest || capability.capTP?.method !== "invoke-service") return "capability is not bound to the provider's exact observation";
  if (!actions.includes("invoke-service") || !EFFECTS.every((effect) => actions.includes(effect)) || actions.some((action) => ["sign", "broadcast", "assemble-transaction", "read-credentials", "move-assets", "customer-write"].includes(action))) return "capability grants missing or forbidden effects";
  return null;
}
async function invoke(root, activity, at, env, evidence) {
  const invalid = await invocationProblem(activity, root, evidence); if (invalid) return reject(root, activity, invalid, at, env, evidence);
  const offer = activity.object.offer; const observation = await sourceObservation(root, offer.object.sourceObservationDigest, evidence); const started = performance.now();
  const resources = { type: "TypedResourceVector", computeSeconds: null, wallTimeSeconds: Number(((performance.now() - started) / 1000).toFixed(6)), assetAmount: null, gas: null };
  const exchange = identify({ type: "PublicEvmWalletObservationExchange",
    request: offer.object.request, outcome: "completion", observation, resources, recordedAt: at,
    credentialAccess: false, signerMaterialAccepted: false, transactionAssembly: false, chainMutation: false, customerMutation: false });
  const receipt = identify({ type: "ServicePerformanceReceipt",
    provider: ACTOR, customer: activity.actor, offer: offer.id, invocation: activity.id, fulfillment: exchange.id,
    outcome: exchange.outcome, recordedAt: at, assetSettlementClaimed: false });
  const result = response("Accept", activity, { type: "PublicEvmWalletObservationResult",
    exchange, receipt, customerMutation: false }, at);
  await append(root, "ethereum-services.public-wallet-observation-exchange", exchange, at, env, evidence);
  await append(root, "ethereum-services.public-wallet-observation-receipt", receipt, at, env, evidence);
  await append(root, "ethereum-services.public-wallet-observation-result", result, at, env, evidence); return result;
}
export async function run(activity, op = "invoke-service", at = new Date().toISOString(), env = process.env, observer = observePublicWallet, evidence) {
  const root = dataRoot(env);
  if (op === "solicit-service") return solicit(root, activity, at, env, observer, evidence);
  if (op === "invoke-service") return invoke(root, activity, at, env, evidence);
  return reject(root, activity, `unknown-provider-operation:${op}`, at, env, evidence);
}
export async function runProviderCli(op = cliOperation()) {
  try { const activity = JSON.parse(readFileSync(0, "utf8")); const output = await run(activity, op, instant());
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`); if (output.type === "Reject") process.exitCode = 2; }
  catch (error) { process.stderr.write(`${basename(process.argv[1])}: ${error.message}\n`); process.exitCode = 1; }
}
if (process.argv.includes("--provider-cli") || (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))) {
  await runProviderCli();
}

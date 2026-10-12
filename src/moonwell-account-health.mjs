import { uint, normalizedAddress, mulDivFloor, evaluateMoonwellAccountHealth } from './moonwell-account-health-math.mjs';
export { evaluateMoonwellAccountHealth, MOONWELL_VALUE_SCALE, moonwellMath } from './moonwell-account-health-math.mjs';
import { createPublicClient, custom, parseAbi } from "viem";
import { base } from "viem/chains";

import { BASE_PUBLIC_EVM_CHAIN, BASE_PUBLIC_EVM_PROVIDERS,
  createPublicEvmReadPool } from "./public-evm-read.mjs";

const PROFILE = "org.emsenn.evm.moonwell-account-health.v1";
const MARKET_EMISSION_CONFIG_PROFILE = "org.emsenn.evm.moonwell-market-emission-config.v1";
const BASE_CAIP2 = "eip155:8453";
const MAX_MARKETS = 64;
const MAX_REWARD_CONFIGS = 64;
const SUPPORTED_BASE_RPC_URLS = new Set(BASE_PUBLIC_EVM_PROVIDERS.map(({ url }) => url));

const comptrollerReadAbi = parseAbi([
  "function getAssetsIn(address) view returns (address[])",
  "function getAccountLiquidity(address) view returns (uint256,uint256,uint256)",
  "function oracle() view returns (address)",
  "function markets(address) view returns (bool,uint256)",
]);
const marketReadAbi = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function underlying() view returns (address)",
  "function getAccountSnapshot(address) view returns (uint256,uint256,uint256,uint256)",
  "function balanceOfUnderlying(address) returns (uint256)",
  "function borrowBalanceCurrent(address) returns (uint256)",
  "function borrowRatePerTimestamp() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function borrowBalanceStored(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function totalBorrows() view returns (uint256)",
]);
const erc20ReadAbi = parseAbi(["function decimals() view returns (uint8)"]);
const oracleReadAbi = parseAbi(["function getUnderlyingPrice(address) view returns (uint256)"]);
const rewardDistributorReadAbi = parseAbi([
  "function getAllMarketConfigs(address) view returns ((address owner,address emissionToken,uint256 endTime,uint224 supplyGlobalIndex,uint32 supplyGlobalTimestamp,uint224 borrowGlobalIndex,uint32 borrowGlobalTimestamp,uint256 supplyEmissionsPerSec,uint256 borrowEmissionsPerSec)[])",
]);

function validateRpcUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("rpcUrl must be credential-free HTTPS without query or fragment");
  }
  if (!SUPPORTED_BASE_RPC_URLS.has(url.href)) {
    throw new Error("rpcUrl must be an allowlisted credential-free public Base endpoint");
  }
  return url.href;
}

function parseAccount(value) {
  const match = /^eip155:8453:(0x[0-9a-fA-F]{40})$/.exec(value ?? "");
  if (!match) throw new Error("account must be a Base CAIP-10 account");
  const address = normalizedAddress("account", match[1]);
  return { address, caip10: `${BASE_CAIP2}:${address}` };
}

function moonwellProviderUrls(request) {
  const values = request?.rpcUrls ?? (request?.rpcUrl == null
    ? BASE_PUBLIC_EVM_PROVIDERS.map(({ url }) => url) : [request.rpcUrl]);
  if (!Array.isArray(values) || values.length === 0) throw new Error("rpcUrls must name at least one public Base endpoint");
  return values.map(validateRpcUrl);
}

function moonwellBoundary(request) {
  if (request?.snapshotBlock == null) return undefined;
  return { chainId: 8453, blockNumber: uint("snapshotBlock", request.snapshotBlock),
    blockHash: request.snapshotBlockHash };
}

function moonwellReadPool(request, dependencies) {
  const providers = moonwellProviderUrls(request).map((url, index) => ({ id: `moonwell-public-${index + 1}`, url }));
  if (dependencies.readPool != null) return dependencies.readPool;
  const createClient = dependencies.rpc == null ? undefined : ({ provider }) => createPublicClient({ chain: base,
    transport: custom({ request: ({ method, params }) => dependencies.rpc(provider.url, method, params ?? []) }) });
  return createPublicEvmReadPool({ chain: BASE_PUBLIC_EVM_CHAIN, providers,
    ...(dependencies.readPoolOptions ?? {}), ...(createClient == null ? {} : { createClient }) });
}

function readContract(address, abi, functionName, args = []) {
  return { address, abi, functionName, args };
}

function accountRewardRate(emissionsPerSecond, accountAmount, marketTotal) {
  return marketTotal === 0n ? 0n : mulDivFloor(emissionsPerSecond, accountAmount, marketTotal);
}

export async function observeMoonwellMarketEmissionConfigs(request, dependencies = {}) {
  if (request?.profile !== MARKET_EMISSION_CONFIG_PROFILE) {
    throw new Error(`request profile must be ${MARKET_EMISSION_CONFIG_PROFILE}`);
  }
  const account = parseAccount(request.account);
  const distributor = normalizedAddress("distributor", request.distributor);
  const market = normalizedAddress("market", request.market);
  const readPool = moonwellReadPool(request, dependencies);
  const read = await readPool.requestAtBoundary({ boundary: moonwellBoundary(request), operation: async ({ readContracts }) => {
    const [rawConfigs, totalSupply, totalBorrows, accountSupply, accountBorrow] = await readContracts({ contracts: [
      readContract(distributor, rewardDistributorReadAbi, "getAllMarketConfigs", [market]),
      readContract(market, marketReadAbi, "totalSupply"),
      readContract(market, marketReadAbi, "totalBorrows"),
      readContract(market, marketReadAbi, "balanceOf", [account.address]),
      readContract(market, marketReadAbi, "borrowBalanceStored", [account.address]),
    ] });
    return { rawConfigs, totalSupply, totalBorrows, accountSupply, accountBorrow };
  } });
  if (read.boundary.blockTimestamp == null) throw new Error("selected block boundary did not include a timestamp");
  const timestamp = BigInt(read.boundary.blockTimestamp);
  const { rawConfigs, totalSupply, totalBorrows, accountSupply, accountBorrow } = read.value;
  if (rawConfigs.length > MAX_REWARD_CONFIGS) {
    throw new Error(`market reward configs exceed the bounded maximum of ${MAX_REWARD_CONFIGS}`);
  }
  const configs = rawConfigs.map((config, index) => {
    const field = (name, position) => config[name] ?? config[position];
    const endTime = field("endTime", 2);
    const active = timestamp < endTime;
    const configuredSupply = field("supplyEmissionsPerSec", 7);
    const configuredBorrow = field("borrowEmissionsPerSec", 8);
    const supplyEmissionsPerSecond = active ? configuredSupply : 0n;
    const borrowEmissionsPerSecond = active ? configuredBorrow : 0n;
    return {
      index,
      owner: normalizedAddress(`configs[${index}].owner`, field("owner", 0)),
      emissionToken: normalizedAddress(`configs[${index}].emissionToken`, field("emissionToken", 1)),
      endTime: endTime.toString(),
      supplyGlobalIndex: field("supplyGlobalIndex", 3).toString(),
      supplyGlobalTimestamp: field("supplyGlobalTimestamp", 4).toString(),
      borrowGlobalIndex: field("borrowGlobalIndex", 5).toString(),
      borrowGlobalTimestamp: field("borrowGlobalTimestamp", 6).toString(),
      configuredSupplyEmissionsPerSecondRaw: configuredSupply.toString(),
      configuredBorrowEmissionsPerSecondRaw: configuredBorrow.toString(),
      active,
      effectiveSupplyEmissionsPerSecondRaw: supplyEmissionsPerSecond.toString(),
      effectiveBorrowEmissionsPerSecondRaw: borrowEmissionsPerSecond.toString(),
      accountSupplyRewardPerSecondRaw: accountRewardRate(supplyEmissionsPerSecond, accountSupply, totalSupply).toString(),
      accountBorrowRewardPerSecondRaw: accountRewardRate(borrowEmissionsPerSecond, accountBorrow, totalBorrows).toString(),
    };
  });
  return {
    profile: MARKET_EMISSION_CONFIG_PROFILE,
    observationOnly: true,
    caip2: BASE_CAIP2,
    account: account.caip10,
    snapshotBlock: read.boundary.blockNumber,
    snapshotBlockHash: read.boundary.blockHash,
    snapshotTimestamp: read.boundary.blockTimestamp,
    distributor,
    market,
    marketTotals: { mTokenSupplyRaw: totalSupply.toString(), borrowedUnderlyingRaw: totalBorrows.toString() },
    accountPosition: { mTokenBalanceRaw: accountSupply.toString(), borrowedUnderlyingRaw: accountBorrow.toString() },
    configs,
    readProvider: read.provider, readAttempts: read.attempts, readFailures: read.failures, rpcCallCount: read.callCount,
    signerMaterialAccepted: false,
    credentialAccess: false,
    transactionAssembly: false,
    signing: false,
    broadcast: false,
    chainMutation: false,
    limits: ["fixed-block-public-rpc-observation", "integer-floor-account-reward-allocation",
      "emissions-capped-at-config-end-time", "no-transaction-authority"],
  };
}

export async function observeMoonwellAccountHealth(request, dependencies = {}) {
  if (request?.profile !== PROFILE) throw new Error(`request profile must be ${PROFILE}`);
  const account = parseAccount(request.account);
  const comptroller = normalizedAddress("comptroller", request.comptroller);
  const readPool = moonwellReadPool(request, dependencies);
  const read = await readPool.requestAtBoundary({ boundary: moonwellBoundary(request), operation: async ({ readContracts }) => {
    const [assetsResult, oracleResult, protocolLiquidityResult] = await readContracts({ contracts: [
      readContract(comptroller, comptrollerReadAbi, "getAssetsIn", [account.address]),
      readContract(comptroller, comptrollerReadAbi, "oracle"),
      readContract(comptroller, comptrollerReadAbi, "getAccountLiquidity", [account.address]),
    ] });
    if (protocolLiquidityResult[0] !== 0n) throw new Error(`Moonwell account liquidity error ${protocolLiquidityResult[0]}`);
    const assets = assetsResult.map((market) => normalizedAddress("entered market", market));
    if (assets.length === 0) return { oracle: normalizedAddress("oracle", oracleResult),
      protocolLiquidityResult, markets: [], noEnteredMarkets: true };
    if (assets.length > MAX_MARKETS) throw new Error(`entered markets exceed the bounded maximum of ${MAX_MARKETS}`);
    const oracle = normalizedAddress("oracle", oracleResult);
    const marketContracts = assets.flatMap((market) => [
      readContract(market, marketReadAbi, "symbol"),
      readContract(market, marketReadAbi, "decimals"),
      readContract(market, marketReadAbi, "underlying"),
      readContract(market, marketReadAbi, "getAccountSnapshot", [account.address]),
      readContract(comptroller, comptrollerReadAbi, "markets", [market]),
      readContract(oracle, oracleReadAbi, "getUnderlyingPrice", [market]),
      readContract(market, marketReadAbi, "borrowRatePerTimestamp"),
      readContract(market, marketReadAbi, "balanceOfUnderlying", [account.address]),
      readContract(market, marketReadAbi, "borrowBalanceCurrent", [account.address]),
    ]);
    const marketResults = await readContracts({ contracts: marketContracts });
    const underlyingAddresses = assets.map((_market, index) => normalizedAddress("underlying", marketResults[(index * 9) + 2]));
    const underlyingDecimals = await readContracts({ contracts: underlyingAddresses
      .map((underlying) => readContract(underlying, erc20ReadAbi, "decimals")) });
    const markets = assets.map((market, index) => {
      const offset = index * 9;
      const snapshot = marketResults[offset + 3];
      const marketConfiguration = marketResults[offset + 4];
      if (snapshot[0] !== 0n) throw new Error(`Moonwell account snapshot error ${snapshot[0]} for ${market}`);
      if (marketConfiguration[0] !== true) throw new Error(`entered Moonwell market is not listed: ${market}`);
      return { market, underlying: underlyingAddresses[index], symbol: String(marketResults[offset]).slice(0, 64),
        marketDecimals: Number(marketResults[offset + 1]), underlyingDecimals: Number(underlyingDecimals[index]), entered: true,
        suppliedUnderlyingRaw: marketResults[offset + 7].toString(), borrowedUnderlyingRaw: marketResults[offset + 8].toString(),
        storedMTokenBalanceRaw: snapshot[1].toString(), storedBorrowBalanceRaw: snapshot[2].toString(),
        storedExchangeRateMantissa: snapshot[3].toString(), underlyingPriceMantissa: marketResults[offset + 5].toString(),
        collateralFactorMantissa: marketConfiguration[1].toString(),
        borrowRatePerTimestampMantissa: marketResults[offset + 6].toString() };
    });
    return { oracle, protocolLiquidityResult, markets, noEnteredMarkets: false };
  } });
  if (read.boundary.blockTimestamp == null) throw new Error("selected block boundary did not include a timestamp");
  const { oracle, protocolLiquidityResult, markets, noEnteredMarkets } = read.value;
  const observed = { profile: PROFILE, observationOnly: true, caip2: BASE_CAIP2, account: account.caip10,
    snapshotBlock: read.boundary.blockNumber, snapshotBlockHash: read.boundary.blockHash,
    snapshotTimestamp: read.boundary.blockTimestamp, comptroller, oracle,
    protocolAccountLiquidity: { error: "0", liquidityMantissa: protocolLiquidityResult[1].toString(),
      shortfallMantissa: protocolLiquidityResult[2].toString() }, markets,
    readProvider: read.provider, readAttempts: read.attempts, readFailures: read.failures, rpcCallCount: read.callCount,
    signerMaterialAccepted: false, credentialAccess: false, transactionAssembly: false,
    signing: false, broadcast: false, chainMutation: false,
    limits: ["fixed-block-public-rpc-observation", "oracle-values-are-protocol-inputs-not-independent-prices",
      "future-supply-interest-ignored", "no-transaction-authority", "not-a-liquidation-warranty"] };
  if (noEnteredMarkets) return { ...observed,
    outcome: { type: "no-entered-markets", factual: true, enteredMarketCount: 0 },
    riskEvaluationPerformed: false };
  const evaluation = evaluateMoonwellAccountHealth({ markets,
    targetHealthFactorMantissa: request.targetHealthFactorMantissa,
    stresses: request.stresses ?? [], horizonsSeconds: request.horizonsSeconds ?? [] });
  return { ...observed, outcome: { type: "account-health-evaluated", factual: false,
    enteredMarketCount: markets.length }, riskEvaluationPerformed: true, evaluation };
}

export const MOONWELL_ACCOUNT_HEALTH_PROFILE = PROFILE;
export const MOONWELL_MARKET_EMISSION_CONFIG_PROFILE = MARKET_EMISSION_CONFIG_PROFILE;

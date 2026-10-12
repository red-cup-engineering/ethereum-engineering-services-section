import assert from "node:assert/strict";
import test from "node:test";

import { Interface } from "ethers";

import { evaluateMoonwellAccountHealth, MOONWELL_ACCOUNT_HEALTH_PROFILE,
  moonwellMath, observeMoonwellAccountHealth } from "../src/moonwell-account-health.mjs";

const WAD = "1000000000000000000";
const account = "0x224c08a8526751887a83e2711b167f890c6d078d";
const comptroller = "0xfbb21d0380bee3312b33c4353c8936a0f13ef26c";
const oracle = "0xec942be8a8114bfd0396a5052c36027f2ca6a9d0";
const mUsdc = "0xedc817a28e8b93b03976fbd4a3ddbc9f7d176c22";
const usdc = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";

function market(overrides = {}) {
  return { market: mUsdc, underlying: usdc, symbol: "mUSDC", underlyingDecimals: 6,
    suppliedUnderlyingRaw: "100000000", borrowedUnderlyingRaw: "0",
    underlyingPriceMantissa: "1000000000000000000000000000000",
    collateralFactorMantissa: "800000000000000000",
    borrowRatePerTimestampMantissa: "0", entered: true, ...overrides };
}

test("uses floor collateral, ceiling debt, and exact rational health", () => {
  const debtMarket = market({ market: "0x00000000000000000000000000000000000000b1", symbol: "mDEBT",
    suppliedUnderlyingRaw: "0", borrowedUnderlyingRaw: "50000000", collateralFactorMantissa: "0" });
  const result = evaluateMoonwellAccountHealth({ markets: [market(), debtMarket],
    targetHealthFactorMantissa: "1250000000000000000" });
  assert.equal(result.current.collateralValueMantissa, "80000000000000000000");
  assert.equal(result.current.debtValueMantissa, "50000000000000000000");
  assert.equal(result.current.healthFactor.mantissa, "1600000000000000000");
  assert.equal(result.guard.withdrawalOrLeverageExpansionAdmitted, true);
  assert.equal(result.withdrawalLimits[0].maximumUnderlyingRaw, "21875000");
});

test("returns minimum raw repayment and collateral-addition remedies", () => {
  const debtMarket = market({ market: "0x00000000000000000000000000000000000000b1", symbol: "mDEBT",
    suppliedUnderlyingRaw: "0", borrowedUnderlyingRaw: "80000000", collateralFactorMantissa: "0" });
  const result = evaluateMoonwellAccountHealth({ markets: [market(), debtMarket],
    targetHealthFactorMantissa: "1250000000000000000" });
  assert.equal(result.current.targetSatisfied, false);
  assert.equal(result.repaymentOptions[0].minimumUnderlyingRaw, "16000000");
  assert.equal(result.repaymentOptions[0].sufficientAlone, true);
  assert.equal(result.collateralAdditions[0].minimumUnderlyingRaw, "25000000");
  assert.equal(result.withdrawalLimits[0].maximumUnderlyingRaw, "0");
  assert.equal(result.guard.remedyRequired, true);
});

test("models wrapper divergence and debt accrual monotonically", () => {
  const debtMarket = market({ market: "0x00000000000000000000000000000000000000b1", symbol: "mDEBT",
    suppliedUnderlyingRaw: "0", borrowedUnderlyingRaw: "50000000", collateralFactorMantissa: "0",
    borrowRatePerTimestampMantissa: "1000000000000" });
  const result = evaluateMoonwellAccountHealth({ markets: [market(), debtMarket],
    targetHealthFactorMantissa: "1500000000000000000", horizonsSeconds: ["1", "100"], stresses: [{ id: "basis-down",
      collateralPriceMultipliers: { [mUsdc]: "900000000000000000" }, debtPriceMultipliers: {} }] });
  assert.ok(BigInt(result.stresses[0].current?.liquidityMantissa ?? result.stresses[0].liquidityMantissa)
    < BigInt(result.current.liquidityMantissa));
  assert.ok(BigInt(result.horizons[1].debtValueMantissa) >= BigInt(result.horizons[0].debtValueMantissa));
  assert.equal(result.guard.withdrawalOrLeverageExpansionAdmitted, false);
  assert.equal(result.guard.remedyRequired, true);
  assert.ok(BigInt(result.withdrawalLimits[0].maximumUnderlyingRaw)
    < BigInt(result.withdrawalLimits[0].currentMaximumUnderlyingRaw));
  assert.ok(BigInt(result.repaymentOptions[0].minimumUnderlyingRaw)
    >= BigInt(result.repaymentOptions[0].currentMinimumUnderlyingRaw));
});

test("zero debt has unbounded health and no repayment requirement", () => {
  const result = evaluateMoonwellAccountHealth({ markets: [market()], targetHealthFactorMantissa: WAD });
  assert.deepEqual(result.current.healthFactor, { kind: "unbounded", numerator: "80000000000000000000", denominator: "0" });
  assert.equal(result.current.repaymentValueToTargetMantissa, "0");
  assert.equal(result.withdrawalLimits[0].maximumUnderlyingRaw, "100000000");
});

test("fixed-point helpers round in the declared conservative direction", () => {
  assert.equal(moonwellMath.mulDivFloor(10n, 10n, 6n), 16n);
  assert.equal(moonwellMath.mulDivCeil(10n, 10n, 6n), 17n);
  assert.equal(moonwellMath.powWadCeil(1000000000000000001n, 2n), 1000000000000000003n);
});

test("refuses duplicate markets, floating point inputs, and unbounded scenarios", () => {
  assert.throws(() => evaluateMoonwellAccountHealth({ markets: [market(), market()], targetHealthFactorMantissa: WAD }), /unique/);
  assert.throws(() => evaluateMoonwellAccountHealth({ markets: [market({ suppliedUnderlyingRaw: 1 })],
    targetHealthFactorMantissa: WAD }), /unsigned decimal/);
  assert.throws(() => evaluateMoonwellAccountHealth({ markets: [market()], targetHealthFactorMantissa: WAD,
    horizonsSeconds: [String(366 * 86400)] }), /one year/);
});

test("observes one fixed Base block without signer or transaction capabilities", async () => {
  const c = new Interface([
    "function getAssetsIn(address) view returns (address[])",
    "function getAccountLiquidity(address) view returns (uint256,uint256,uint256)",
    "function oracle() view returns (address)",
    "function markets(address) view returns (bool,uint256)",
  ]);
  const m = new Interface([
    "function symbol() view returns (string)", "function decimals() view returns (uint8)",
    "function underlying() view returns (address)",
    "function getAccountSnapshot(address) view returns (uint256,uint256,uint256,uint256)",
    "function balanceOfUnderlying(address) returns (uint256)",
    "function borrowBalanceCurrent(address) returns (uint256)",
    "function borrowRatePerTimestamp() view returns (uint256)",
  ]);
  const e = new Interface(["function decimals() view returns (uint8)"]);
  const o = new Interface(["function getUnderlyingPrice(address) view returns (uint256)"]);
  const encoded = (iface, name, values) => iface.encodeFunctionResult(name, values);
  const rpc = async (_url, method, params) => {
    if (method === "eth_chainId") return "0x2105";
    if (method === "eth_blockNumber") return "0x64";
    if (method === "eth_getBlockByNumber") { assert.equal(params[0], "0x64"); return { timestamp: "0xc8" }; }
    if (method !== "eth_call") throw new Error(`unexpected ${method}`);
    assert.equal(params[1], "0x64");
    const { to, data } = params[0];
    if (to.toLowerCase() === comptroller) {
      if (data.startsWith(c.getFunction("getAssetsIn").selector)) return encoded(c, "getAssetsIn", [[mUsdc]]);
      if (data.startsWith(c.getFunction("oracle").selector)) return encoded(c, "oracle", [oracle]);
      if (data.startsWith(c.getFunction("getAccountLiquidity").selector)) return encoded(c, "getAccountLiquidity", [0n, 30n, 0n]);
      return encoded(c, "markets", [true, 800000000000000000n]);
    }
    if (to.toLowerCase() === oracle) return encoded(o, "getUnderlyingPrice", [1000000000000000000000000000000n]);
    if (to.toLowerCase() === usdc) return encoded(e, "decimals", [6]);
    if (data.startsWith(m.getFunction("symbol").selector)) return encoded(m, "symbol", ["mUSDC"]);
    if (data.startsWith(m.getFunction("decimals").selector)) return encoded(m, "decimals", [8]);
    if (data.startsWith(m.getFunction("underlying").selector)) return encoded(m, "underlying", [usdc]);
    if (data.startsWith(m.getFunction("getAccountSnapshot").selector)) return encoded(m, "getAccountSnapshot", [0n, 100n, 0n, 10000000000000000n]);
    if (data.startsWith(m.getFunction("balanceOfUnderlying").selector)) return encoded(m, "balanceOfUnderlying", [100000000n]);
    if (data.startsWith(m.getFunction("borrowBalanceCurrent").selector)) return encoded(m, "borrowBalanceCurrent", [0n]);
    return encoded(m, "borrowRatePerTimestamp", [0n]);
  };
  const observation = await observeMoonwellAccountHealth({ profile: MOONWELL_ACCOUNT_HEALTH_PROFILE,
    account: `eip155:8453:${account}`, rpcUrl: "https://base-rpc.publicnode.com", comptroller,
    targetHealthFactorMantissa: WAD, horizonsSeconds: [], stresses: [] }, { rpc });
  assert.equal(observation.snapshotBlock, "100");
  assert.equal(observation.snapshotTimestamp, "200");
  assert.equal(observation.markets[0].suppliedUnderlyingRaw, "100000000");
  assert.equal(observation.evaluation.current.healthFactor.kind, "unbounded");
  assert.equal(observation.signerMaterialAccepted, false);
  assert.equal(observation.transactionAssembly, false);
  assert.equal(observation.chainMutation, false);
});

test("observer refuses credential-bearing RPC URLs and the wrong chain", async () => {
  const base = { profile: MOONWELL_ACCOUNT_HEALTH_PROFILE, account: `eip155:8453:${account}`,
    rpcUrl: "https://user:secret@example.test/rpc", comptroller, targetHealthFactorMantissa: WAD };
  await assert.rejects(() => observeMoonwellAccountHealth(base), /credential-free/);
  await assert.rejects(() => observeMoonwellAccountHealth({ ...base, rpcUrl: "https://base-rpc.publicnode.com" },
    { rpc: async (_url, method) => method === "eth_chainId" ? "0x1" : null }), /chain 8453/);
  await assert.rejects(() => observeMoonwellAccountHealth({ ...base, rpcUrl: "https://rpc.example/base" }), /allowlisted/);
});

// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface BeefyRecoveryVm {
    function envOr(string calldata name, bool defaultValue) external returns (bool value);
    function envOr(string calldata name, uint256 defaultValue) external returns (uint256 value);
    function createSelectFork(string calldata urlOrAlias, uint256 blockNumber)
        external
        returns (uint256 forkId);
    function startPrank(address caller) external;
    function stopPrank() external;
}

interface IERC20RecoveryView {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address recipient, uint256 amount) external returns (bool);
}

interface IBeefyVaultRecovery is IERC20RecoveryView {
    function want() external view returns (address);
    function withdrawAll() external;
}

interface IBeefyRewardPoolRecovery is IERC20RecoveryView {
    function withdraw(uint256 amount) external;
}

interface IAerodromePoolRecovery is IERC20RecoveryView {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function poolFees() external view returns (address);
    function stable() external view returns (bool);
    function getAmountOut(uint256 amountIn, address tokenIn) external view returns (uint256);
    function burn(address recipient) external returns (uint256 amount0, uint256 amount1);
    function swap(uint256 amount0Out, uint256 amount1Out, address recipient, bytes calldata data)
        external;
}

interface IBaseGasPriceOracleRecovery {
    function getL1FeeUpperBound(uint256 unsignedTxSize) external view returns (uint256);
    function getOperatorFee(uint256 gasUsed) external view returns (uint256);
}

interface IMoonwellCbBtcRecovery {
    function borrowBalanceStored(address account) external view returns (uint256);
    function borrowBalanceCurrent(address account) external returns (uint256);
    function repayBorrow(uint256 repayAmount) external returns (uint256);
}

interface IMoonwellComptrollerRecovery {
    function getAssetsIn(address account) external view returns (address[] memory);
    function markets(address market)
        external
        view
        returns (bool listed, uint256 collateralFactorMantissa);
    function oracle() external view returns (address);
}

interface IMoonwellMarketHealthRecovery {
    function balanceOfUnderlying(address account) external returns (uint256);
    function borrowBalanceCurrent(address account) external returns (uint256);
}

interface IMoonwellOracleRecovery {
    function getUnderlyingPrice(address market) external view returns (uint256);
}

interface IERC20RecoveryMutation is IERC20RecoveryView {
    function approve(address spender, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
}

/// @notice Published fixed-fork evidence harness only. It impersonates a public account on an
/// ephemeral local fork and never possesses a key, signs, broadcasts, or mutates Base.
contract BeefyLegacyRecoveryForkTest {
    BeefyRecoveryVm private constant vm =
        BeefyRecoveryVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant YANAGI = 0x224C08A8526751887a83e2711B167f890c6D078d;
    uint256 private constant DEFAULT_EVIDENCE_BLOCK = 48_971_240;
    uint256 private constant TRANSACTION_COUNT = 3;
    uint256 private constant UNSIGNED_TX_SIZE_CEIL = 256;
    uint256 private constant ROUTE_GAS_SAFETY_BPS = 12_000;
    uint256 private constant INTRINSIC_AND_CALLDATA_GAS_CEIL = 64_728;
    IBaseGasPriceOracleRecovery private constant GAS_PRICE_ORACLE =
        IBaseGasPriceOracleRecovery(0x420000000000000000000000000000000000000F);

    event FixedForkRecoveryObserved(
        string candidateId,
        uint256 blockNumber,
        address vault,
        address lpToken,
        uint256 sharesBurned,
        uint256 lpBurned,
        address token0,
        uint256 amount0,
        address token1,
        uint256 amount1,
        uint256 gasUsed,
        uint256 gasUnitsCeil,
        uint256 baseFeePerGas,
        uint256 l1DataFeeWeiCeil,
        uint256 operatorFeeWeiCeil,
        uint256 transactionCount,
        uint256 unsignedTxSizeCeil
    );

    /// @dev Fixed-fork receipt only. The harness calls the assayed contracts on an
    /// ephemeral fork but never constructs calldata for a signer or live chain.
    event FixedForkSigmundTbtcCbBtcExitObserved(
        uint256 blockNumber,
        address source,
        address rewardPool,
        address vault,
        address lpToken,
        uint256 stakedVaultSharesExited,
        uint256 directVaultSharesBurned,
        uint256 lpBurned,
        address tbtc,
        uint256 tbtcReceived,
        address cbbtc,
        uint256 cbbtcReceived,
        uint256 gasUsed
    );

    event FixedForkSigmundTbtcCbBtcSwapObserved(
        uint256 blockNumber,
        address pool,
        uint256 tbtcInput,
        uint256 cbbtcQuoted,
        uint256 cbbtcReceived,
        uint256 tbtcResidual,
        uint256 sourceCbBtcAfter,
        uint256 gasUsed
    );

    event FixedForkSigmundCbBtcRepaymentObserved(
        uint256 blockNumber,
        address source,
        address target,
        address market,
        uint256 repaymentSats,
        uint256 debtBeforeSats,
        uint256 debtAfterSats,
        uint256 sourceCbBtcResidualSats,
        uint256 targetCbBtcAllowanceSats
    );

    event FixedForkSigmundHealthObserved(
        uint256 blockNumber,
        address target,
        uint256 targetHealthFactorWad,
        uint256 currentHealthFactorWad,
        uint256 lbtcHaircut10HealthFactorWad,
        uint256 lbtcDown5CbBtcUp2HealthFactorWad,
        bool allScenariosMeetTarget
    );

    function testSigmundTbtcCbBtcFixedForkExitPrefix() public {
        if (!vm.envOr("AGRODAO_BASE_RECOVERY_FORK", false)) return;
        uint256 evidenceBlock = vm.envOr("AGRODAO_BASE_RECOVERY_BLOCK", DEFAULT_EVIDENCE_BLOCK);
        vm.createSelectFork("https://mainnet.base.org/", evidenceBlock);

        address source = 0x32886F6F361C1d570255c2762967A2e41D0E9B1a;
        IBeefyRewardPoolRecovery rewardPool =
            IBeefyRewardPoolRecovery(0xCD241A97aC92C3415fEfbe6f3d61A27b2C30acE7);
        IBeefyVaultRecovery vault = IBeefyVaultRecovery(0x64AF54612646CcE0657374226e38B82B8001E674);

        uint256 stakedShares = rewardPool.balanceOf(source);
        uint256 directShares = vault.balanceOf(source);
        require(stakedShares > 0 && directShares > 0, "SIGMUND position absent at evidence block");

        IAerodromePoolRecovery pool = IAerodromePoolRecovery(vault.want());
        address token0 = pool.token0();
        address token1 = pool.token1();
        require(
            token0 == 0x236aa50979D5f3De3Bd1Eeb40E81137F22ab794b
                && token1 == 0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf,
            "tBTC-cbBTC pool topology drift"
        );
        uint256 lpBefore = pool.balanceOf(source);
        uint256 tbtcBefore = IERC20RecoveryView(token0).balanceOf(source);
        uint256 cbbtcBefore = IERC20RecoveryView(token1).balanceOf(source);

        vm.startPrank(source);
        uint256 gasBefore = gasleft();
        rewardPool.withdraw(stakedShares);
        require(
            vault.balanceOf(source) == directShares + stakedShares,
            "staked shares did not return to vault"
        );
        vault.withdrawAll();
        uint256 lpReceived = pool.balanceOf(source) - lpBefore;
        require(lpReceived > 0, "vault exit returned no LP token");
        require(pool.transfer(address(pool), lpReceived), "LP transfer refused");
        (uint256 tbtcReceived, uint256 cbbtcReceived) = pool.burn(source);
        uint256 gasUsed = gasBefore - gasleft();
        vm.stopPrank();

        require(vault.balanceOf(source) == 0, "vault shares remain after exit");
        require(pool.balanceOf(source) == lpBefore, "LP residue differs from pre-exit state");
        require(
            tbtcReceived == IERC20RecoveryView(token0).balanceOf(source) - tbtcBefore,
            "tBTC receipt differs from pool burn result"
        );
        require(
            cbbtcReceived == IERC20RecoveryView(token1).balanceOf(source) - cbbtcBefore,
            "cbBTC receipt differs from pool burn result"
        );
        require(tbtcReceived > 0 && cbbtcReceived > 0, "pool burn returned an empty side");

        emit FixedForkSigmundTbtcCbBtcExitObserved(
            evidenceBlock,
            source,
            address(rewardPool),
            address(vault),
            address(pool),
            stakedShares,
            directShares,
            lpReceived,
            token0,
            tbtcReceived,
            token1,
            cbbtcReceived,
            gasUsed
        );
    }

    /// @notice Executes the July-assayed pair-level route on an ephemeral fixed
    /// fork: exit, burn, swap all tBTC through the same stable pool, transfer all
    /// cbBTC output, repay Moonwell, and assay current plus declared basis stress.
    function testSigmundFullTbtcCbBtcRepayment() public {
        if (!vm.envOr("AGRODAO_BASE_RECOVERY_FORK", false)) return;
        uint256 evidenceBlock = vm.envOr("AGRODAO_BASE_RECOVERY_BLOCK", DEFAULT_EVIDENCE_BLOCK);
        this.testSigmundTbtcCbBtcFixedForkExitPrefix();

        address source = 0x32886F6F361C1d570255c2762967A2e41D0E9B1a;
        address target = 0x224C08A8526751887a83e2711B167f890c6D078d;
        IERC20RecoveryView tbtc = IERC20RecoveryView(0x236aa50979D5f3De3Bd1Eeb40E81137F22ab794b);
        IERC20RecoveryMutation cbbtc =
            IERC20RecoveryMutation(0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf);
        IAerodromePoolRecovery pool =
            IAerodromePoolRecovery(0x488d6ea6064eEE9352fdCDB7BC50d98A7fF3AD4E);
        IMoonwellCbBtcRecovery market =
            IMoonwellCbBtcRecovery(0xF877ACaFA28c19b96727966690b2f44d35aD5976);

        require(pool.stable(), "assayed Aerodrome pool is no longer stable");
        uint256 tbtcInput = tbtc.balanceOf(source);
        uint256 poolTbtcBefore = tbtc.balanceOf(address(pool));
        address poolFees = pool.poolFees();
        uint256 poolFeesTbtcBefore = tbtc.balanceOf(poolFees);
        uint256 sourceCbBtcBeforeSwap = cbbtc.balanceOf(source);
        uint256 cbbtcQuoted = pool.getAmountOut(tbtcInput, address(tbtc));
        require(tbtcInput > 0 && cbbtcQuoted > 0, "full conversion route is unavailable");
        vm.startPrank(source);
        uint256 swapGasBefore = gasleft();
        require(tbtc.transfer(address(pool), tbtcInput), "tBTC transfer to pool refused");
        pool.swap(0, cbbtcQuoted, source, bytes(""));
        uint256 swapGasUsed = swapGasBefore - gasleft();
        vm.stopPrank();
        uint256 sourceCbBtcAfterSwap = cbbtc.balanceOf(source);
        require(tbtc.balanceOf(source) == 0, "tBTC remains after full conversion");
        uint256 poolTbtcDelta = tbtc.balanceOf(address(pool)) - poolTbtcBefore;
        uint256 poolFeesTbtcDelta = tbtc.balanceOf(poolFees) - poolFeesTbtcBefore;
        require(
            poolTbtcDelta + poolFeesTbtcDelta == tbtcInput,
            "pool plus fee tBTC input is not conserved"
        );
        require(
            sourceCbBtcAfterSwap - sourceCbBtcBeforeSwap == cbbtcQuoted,
            "swap output differs from quote"
        );
        emit FixedForkSigmundTbtcCbBtcSwapObserved(
            evidenceBlock,
            address(pool),
            tbtcInput,
            cbbtcQuoted,
            sourceCbBtcAfterSwap - sourceCbBtcBeforeSwap,
            tbtc.balanceOf(source),
            sourceCbBtcAfterSwap,
            swapGasUsed
        );

        uint256 repaymentSats = sourceCbBtcAfterSwap;
        uint256 targetBefore = cbbtc.balanceOf(target);
        uint256 debtBefore = market.borrowBalanceCurrent(target);
        require(
            repaymentSats > 0 && debtBefore >= repaymentSats, "full-output repayment is unavailable"
        );

        vm.startPrank(source);
        require(cbbtc.transfer(target, repaymentSats), "direct cbBTC transfer refused");
        vm.stopPrank();
        vm.startPrank(target);
        require(cbbtc.approve(address(market), repaymentSats), "exact cbBTC approval refused");
        require(market.repayBorrow(repaymentSats) == 0, "Moonwell repayment refused");
        vm.stopPrank();

        uint256 debtAfter = market.borrowBalanceStored(target);
        uint256 sourceAfter = cbbtc.balanceOf(source);
        require(debtBefore - debtAfter == repaymentSats, "Moonwell debt delta differs from repair");
        require(sourceAfter == 0, "source cbBTC remains after full-output repayment");
        require(
            cbbtc.balanceOf(target) == targetBefore,
            "target cbBTC did not return to its initial balance"
        );
        require(cbbtc.allowance(target, address(market)) == 0, "repayment allowance remains");
        emit FixedForkSigmundCbBtcRepaymentObserved(
            evidenceBlock,
            source,
            target,
            address(market),
            repaymentSats,
            debtBefore,
            debtAfter,
            sourceAfter,
            cbbtc.allowance(target, address(market))
        );

        (uint256 currentHealth, uint256 haircutHealth, uint256 basisHealth) =
            _moonwellHealthFactors(target);
        uint256 targetHealth = 1_200_000_000_000_000_000;
        bool allScenariosMeetTarget = currentHealth >= targetHealth && haircutHealth >= targetHealth
            && basisHealth >= targetHealth;
        require(allScenariosMeetTarget, "post-repayment health is below the declared 1.2 target");
        emit FixedForkSigmundHealthObserved(
            evidenceBlock,
            target,
            targetHealth,
            currentHealth,
            haircutHealth,
            basisHealth,
            allScenariosMeetTarget
        );
    }

    function _moonwellHealthFactors(address account)
        private
        returns (uint256 currentHealth, uint256 haircutHealth, uint256 basisHealth)
    {
        IMoonwellComptrollerRecovery comptroller =
            IMoonwellComptrollerRecovery(0xfBb21d0380beE3312B33c4353c8936a0F13EF26C);
        IMoonwellOracleRecovery oracle = IMoonwellOracleRecovery(comptroller.oracle());
        address[] memory assets = comptroller.getAssetsIn(account);
        uint256 collateral;
        uint256 debt;
        uint256 haircutCollateral;
        uint256 basisCollateral;
        uint256 basisDebt;
        address lbtcMarket = 0x10fF57877b79e9bd949B3815220eC87B9fc5D2ee;
        address cbbtcMarket = 0xF877ACaFA28c19b96727966690b2f44d35aD5976;
        for (uint256 index = 0; index < assets.length; index++) {
            address asset = assets[index];
            (bool listed, uint256 collateralFactor) = comptroller.markets(asset);
            require(listed, "entered Moonwell market is not listed");
            uint256 price = oracle.getUnderlyingPrice(asset);
            uint256 supplied = IMoonwellMarketHealthRecovery(asset).balanceOfUnderlying(account);
            uint256 borrowed = IMoonwellMarketHealthRecovery(asset).borrowBalanceCurrent(account);
            uint256 collateralValue = supplied * price / 1e18 * collateralFactor / 1e18;
            uint256 debtValue = _mulDivCeil(borrowed, price, 1e18);
            collateral += collateralValue;
            debt += debtValue;
            haircutCollateral += asset == lbtcMarket ? collateralValue * 90 / 100 : collateralValue;
            basisCollateral += asset == lbtcMarket ? collateralValue * 95 / 100 : collateralValue;
            basisDebt += asset == cbbtcMarket ? _mulDivCeil(debtValue, 102, 100) : debtValue;
        }
        require(debt > 0 && basisDebt > 0, "Moonwell debt disappeared from health assay");
        currentHealth = collateral * 1e18 / debt;
        haircutHealth = haircutCollateral * 1e18 / debt;
        basisHealth = basisCollateral * 1e18 / basisDebt;
    }

    function _mulDivCeil(uint256 value, uint256 multiplier, uint256 denominator)
        private
        pure
        returns (uint256)
    {
        uint256 product = value * multiplier;
        return product == 0 ? 0 : ((product - 1) / denominator) + 1;
    }

    function testYanagiBeefyWeethWethFixedForkExit() public {
        if (!vm.envOr("AGRODAO_BASE_RECOVERY_FORK", false)) return;
        uint256 evidenceBlock = vm.envOr("AGRODAO_BASE_RECOVERY_BLOCK", DEFAULT_EVIDENCE_BLOCK);
        vm.createSelectFork("https://mainnet.base.org/", evidenceBlock);
        _observe(
            "yanagi-beefy-weeth-weth",
            IBeefyVaultRecovery(0x47579C50c7AeDeA788D18927aed4c827Fe34996A),
            evidenceBlock
        );
    }

    function testYanagiBeefySfrxethWstethFixedForkExit() public {
        if (!vm.envOr("AGRODAO_BASE_RECOVERY_FORK", false)) return;
        uint256 evidenceBlock = vm.envOr("AGRODAO_BASE_RECOVERY_BLOCK", DEFAULT_EVIDENCE_BLOCK);
        vm.createSelectFork("https://mainnet.base.org/", evidenceBlock);
        _observe(
            "yanagi-beefy-sfrxeth-wsteth",
            IBeefyVaultRecovery(0xdeE327BF6b0182a1727caEC9C6344a0D27D6da99),
            evidenceBlock
        );
    }

    function _observe(string memory candidateId, IBeefyVaultRecovery vault, uint256 evidenceBlock)
        private
    {
        uint256 shares = vault.balanceOf(YANAGI);
        require(shares > 0, "position is not present at evidence block");
        IAerodromePoolRecovery pool = IAerodromePoolRecovery(vault.want());
        address token0 = pool.token0();
        address token1 = pool.token1();
        uint256 lpBefore = pool.balanceOf(YANAGI);
        uint256 token0Before = IERC20RecoveryView(token0).balanceOf(YANAGI);
        uint256 token1Before = IERC20RecoveryView(token1).balanceOf(YANAGI);

        vm.startPrank(YANAGI);
        uint256 gasBefore = gasleft();
        vault.withdrawAll();
        uint256 lpReceived = pool.balanceOf(YANAGI) - lpBefore;
        require(lpReceived > 0, "vault exit returned no LP token");
        require(pool.transfer(address(pool), lpReceived), "LP transfer refused");
        (uint256 amount0, uint256 amount1) = pool.burn(YANAGI);
        uint256 gasUsed = gasBefore - gasleft();
        vm.stopPrank();

        require(vault.balanceOf(YANAGI) == 0, "vault shares remain after withdrawAll");
        require(
            pool.balanceOf(YANAGI) == lpBefore, "fixed-fork LP residue differs from pre-exit state"
        );
        require(
            amount0 == IERC20RecoveryView(token0).balanceOf(YANAGI) - token0Before,
            "token0 receipt differs from pool burn result"
        );
        require(
            amount1 == IERC20RecoveryView(token1).balanceOf(YANAGI) - token1Before,
            "token1 receipt differs from pool burn result"
        );
        require(amount0 > 0 && amount1 > 0, "pool burn returned an empty side");

        uint256 gasUnitsCeil =
            (gasUsed * ROUTE_GAS_SAFETY_BPS + 9_999) / 10_000 + INTRINSIC_AND_CALLDATA_GAS_CEIL;
        uint256 l1DataFeeWeiCeil =
            GAS_PRICE_ORACLE.getL1FeeUpperBound(UNSIGNED_TX_SIZE_CEIL) * TRANSACTION_COUNT;
        uint256 operatorFeeWeiCeil = GAS_PRICE_ORACLE.getOperatorFee(gasUnitsCeil)
            + GAS_PRICE_ORACLE.getOperatorFee(0) * (TRANSACTION_COUNT - 1);

        emit FixedForkRecoveryObserved(
            candidateId,
            evidenceBlock,
            address(vault),
            address(pool),
            shares,
            lpReceived,
            token0,
            amount0,
            token1,
            amount1,
            gasUsed,
            gasUnitsCeil,
            block.basefee,
            l1DataFeeWeiCeil,
            operatorFeeWeiCeil,
            TRANSACTION_COUNT,
            UNSIGNED_TX_SIZE_CEIL
        );
    }
}

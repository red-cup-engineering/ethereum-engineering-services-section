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

interface IAerodromePoolRecovery is IERC20RecoveryView {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function burn(address recipient) external returns (uint256 amount0, uint256 amount1);
}

interface IBaseGasPriceOracleRecovery {
    function getL1FeeUpperBound(uint256 unsignedTxSize) external view returns (uint256);
    function getOperatorFee(uint256 gasUsed) external view returns (uint256);
}

/// @notice Fixed-fork evidence harness only. It impersonates a public account on an
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

// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IMoonwellHealthComptroller {
    function getAssetsIn(address account) external view returns (address[] memory);

    function markets(address market)
        external
        view
        returns (bool listed, uint256 collateralFactorMantissa);

    function oracle() external view returns (address);
}

interface IMoonwellHealthOracle {
    function getUnderlyingPrice(address market) external view returns (uint256);
}

interface IMoonwellHealthMarket {
    function balanceOfUnderlying(address account) external returns (uint256);

    function borrowBalanceCurrent(address account) external returns (uint256);
}

/// @notice Test-only Moonwell health assay copied from the published fixed-fork harness.
/// It does not select forks, impersonate accounts, or submit transactions.
contract MoonwellHealthAssertions {
    uint256 public constant MINIMUM_HEALTH_FACTOR_WAD = 1_200_000_000_000_000_000;

    function moonwellHealthFactors(
        address account,
        address comptrollerAddress,
        address lbtcMarket,
        address cbbtcMarket
    ) public returns (uint256 currentHealth, uint256 lbtcHaircut10Health, uint256 lbtcDown5CbBtcUp2Health) {
        IMoonwellHealthComptroller comptroller = IMoonwellHealthComptroller(comptrollerAddress);
        IMoonwellHealthOracle oracle = IMoonwellHealthOracle(comptroller.oracle());
        address[] memory assets = comptroller.getAssetsIn(account);
        uint256 collateral;
        uint256 debt;
        uint256 haircutCollateral;
        uint256 basisCollateral;
        uint256 basisDebt;

        for (uint256 index = 0; index < assets.length; index++) {
            address asset = assets[index];
            (bool listed, uint256 collateralFactor) = comptroller.markets(asset);
            require(listed, "entered Moonwell market is not listed");
            uint256 price = oracle.getUnderlyingPrice(asset);
            uint256 supplied = IMoonwellHealthMarket(asset).balanceOfUnderlying(account);
            uint256 borrowed = IMoonwellHealthMarket(asset).borrowBalanceCurrent(account);
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
        lbtcHaircut10Health = haircutCollateral * 1e18 / debt;
        lbtcDown5CbBtcUp2Health = basisCollateral * 1e18 / basisDebt;
    }

    function assertMoonwellHealthFactors(
        address account,
        address comptrollerAddress,
        address lbtcMarket,
        address cbbtcMarket
    ) public returns (uint256 currentHealth, uint256 lbtcHaircut10Health, uint256 lbtcDown5CbBtcUp2Health) {
        (currentHealth, lbtcHaircut10Health, lbtcDown5CbBtcUp2Health) = moonwellHealthFactors(
            account, comptrollerAddress, lbtcMarket, cbbtcMarket
        );
        require(currentHealth >= MINIMUM_HEALTH_FACTOR_WAD, "current health is below 1.2");
        require(lbtcHaircut10Health >= MINIMUM_HEALTH_FACTOR_WAD, "LBTC -10% health is below 1.2");
        require(
            lbtcDown5CbBtcUp2Health >= MINIMUM_HEALTH_FACTOR_WAD,
            "LBTC -5%/cbBTC +2% health is below 1.2"
        );
    }

    function _mulDivCeil(uint256 value, uint256 multiplier, uint256 denominator)
        private
        pure
        returns (uint256)
    {
        uint256 product = value * multiplier;
        return product == 0 ? 0 : ((product - 1) / denominator) + 1;
    }
}

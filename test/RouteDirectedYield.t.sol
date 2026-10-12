// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {
    RouteDirectedYield
} from "@red-cup-engineering/route-directed-yield-service/lib/contracts/route-directed-yield.sol";

interface RouteDirectedYieldVm {
    function expectRevert(bytes4 reason) external;
    function prank(address caller) external;
}

/// @dev A minimal ERC-20 the mock vault mints redeemed assets into -- just enough surface for
/// RouteDirectedYield's `asset()`/`transfer` calls, no allowance bookkeeping needed.
contract MockAsset {
    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/// @dev A minimal ERC-4626-shaped vault: redeem() mints assets to the receiver at a fixed
/// exchange rate, matching this section's own JS fixtures (1 share = 1.05 asset units).
contract MockVault {
    MockAsset public immutable assetToken;

    constructor(MockAsset asset_) {
        assetToken = asset_;
    }

    function asset() external view returns (address) {
        return address(assetToken);
    }

    function redeem(
        uint256 shares,
        address receiver,
        address /* owner */
    )
        external
        returns (uint256 assets)
    {
        assets = (shares * 105) / 100;
        assetToken.mint(receiver, assets);
    }
}

contract RouteDirectedYieldTest {
    RouteDirectedYieldVm private constant vm =
        RouteDirectedYieldVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    RouteDirectedYield internal helper;
    MockAsset internal assetToken;
    MockVault internal vault;

    address internal constant MEMBER = address(0xA11CE);
    address internal constant POOL = address(0xB0B1);

    function setUp() public {
        helper = new RouteDirectedYield();
        assetToken = new MockAsset();
        vault = new MockVault(assetToken);
    }

    function testRedeemAndForwardSendsAssetsDirectlyToPoolNeverToTheHelper() public {
        vm.prank(MEMBER);
        uint256 assets = helper.redeemAndForward(address(vault), 1000, POOL);
        require(assets == 1050, "unexpected assets amount");
        require(assetToken.balanceOf(POOL) == 1050, "pool did not receive the redeemed assets");
        require(
            assetToken.balanceOf(address(helper)) == 0, "helper must hold no balance between calls"
        );
    }

    function testRedeemAndForwardRevertsOnZeroShares() public {
        vm.expectRevert(RouteDirectedYield.ZeroShares.selector);
        helper.redeemAndForward(address(vault), 0, POOL);
    }

    function testRedeemAndForwardRevertsOnZeroPoolAddress() public {
        vm.expectRevert(RouteDirectedYield.ZeroPoolAddress.selector);
        helper.redeemAndForward(address(vault), 1000, address(0));
    }
}

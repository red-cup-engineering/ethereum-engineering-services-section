// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {
    WitnessedKilowattHour
} from "@red-cup-engineering/settle-energy-exchange-service/lib/contracts/settle-energy-exchange.sol";

interface WitnessedKilowattHourVm {
    function expectRevert(bytes4 selector) external;
    function expectRevert(bytes calldata reason) external;
}

contract WitnessedKilowattHourTest {
    WitnessedKilowattHourVm private constant vm =
        WitnessedKilowattHourVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    WitnessedKilowattHour internal ledger;

    address internal constant PRODUCER = address(0xA11CE);

    // The exact digests `@red-cup-engineering/settle-energy-exchange-service@0.1.0`'s own README
    // example emits for its settled-KWH-record fixture: the record's ni: id decoded to its
    // 32-byte digest, and the two agreeing witness sub-records' own digests, the same
    // construction. This is the off-chain/on-chain digest-identity test the fabrication
    // requires: these bytes are not invented here.
    bytes32 internal constant RECORD_DIGEST =
        0x8704bc6103cca7196db50a1ab8fd6ffa5b891e6ab59c234dc19d2d9b2e73bd50;
    bytes32 internal constant WITNESS_A_DIGEST =
        0x1f5a3e864abe16da1beb603b95f860f07cb2e8cf1b66ab27357d0f9d8250ab63;
    bytes32 internal constant WITNESS_B_DIGEST =
        0x91acdfca05b31ddc8a46414fcc93225b3ca068aae7410de4c8f296b6d3304003;
    uint256 internal constant MILLI_KWH = 412500;

    function setUp() public {
        ledger = new WitnessedKilowattHour();
    }

    function testMintCreditsBalanceAndTotalSupplyFromTheSettleEnergyExchangeDigests() public {
        ledger.mint(RECORD_DIGEST, WITNESS_A_DIGEST, WITNESS_B_DIGEST, MILLI_KWH, PRODUCER);
        require(ledger.balanceOf(PRODUCER) == MILLI_KWH, "balance not credited");
        require(ledger.totalSupply() == MILLI_KWH, "total supply not credited");
        require(ledger.mintedOf(RECORD_DIGEST) == MILLI_KWH, "mintedOf not seated");
    }

    function testSecondMintOfTheSameRecordReverts() public {
        ledger.mint(RECORD_DIGEST, WITNESS_A_DIGEST, WITNESS_B_DIGEST, MILLI_KWH, PRODUCER);
        vm.expectRevert(
            abi.encodeWithSelector(
                WitnessedKilowattHour.RecordAlreadyMinted.selector, RECORD_DIGEST
            )
        );
        ledger.mint(RECORD_DIGEST, WITNESS_A_DIGEST, WITNESS_B_DIGEST, MILLI_KWH, PRODUCER);
    }

    function testIdenticalWitnessesRevert() public {
        vm.expectRevert(WitnessedKilowattHour.WitnessesNotDistinct.selector);
        ledger.mint(RECORD_DIGEST, WITNESS_A_DIGEST, WITNESS_A_DIGEST, MILLI_KWH, PRODUCER);
    }

    function testZeroQuantityReverts() public {
        vm.expectRevert(WitnessedKilowattHour.ZeroQuantity.selector);
        ledger.mint(RECORD_DIGEST, WITNESS_A_DIGEST, WITNESS_B_DIGEST, 0, PRODUCER);
    }
}

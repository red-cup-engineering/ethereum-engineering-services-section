// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { SemioticExchange } from "../services/semiotic-exchange-chain-services-section/lib/legacy/SemioticExchange.sol";

interface ExchangeVm {
    function expectRevert() external;
    function expectRevert(bytes calldata reason) external;
    function expectRevert(bytes4 reason) external;
    function prank(address caller) external;
}

contract SemioticExchangeTest {
    ExchangeVm private constant vm =
        ExchangeVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    SemioticExchange internal exchange;

    address internal constant NODE = address(0xA11CE);
    address internal constant OTHER = address(0xB0B);

    // Precomputed in setUp, never inline: `sha256` compiles to a CALL to
    // precompile 0x02, so evaluating it in an argument position would consume
    // the pending `vm.prank` and the call would run as this contract.
    bytes32 internal LAW;
    bytes32 internal GROUNDING;
    bytes32 internal RESULT;
    bytes32 internal SECOND;
    bytes32 internal FORGED;
    bytes32 internal nodeCell;
    bytes32 internal otherCell;

    function setUp() public {
        exchange = new SemioticExchange();
        LAW = sha256("capability-law/refactor-to-chain");
        GROUNDING = sha256("grounding-carrier");
        RESULT = sha256("result");
        SECOND = sha256("second");
        FORGED = sha256("forged");
        nodeCell = sha256(cellCarrier("node-cell"));
        otherCell = sha256(cellCarrier("other-cell"));
    }

    /// @dev Stands in for the deterministic-CBOR carrier canonicalized offchain.
    /// Only its bytes matter here: the contract hashes what it is handed.
    function cellCarrier(string memory semanticKey) internal pure returns (bytes memory) {
        return abi.encodePacked("CapabilityCellIdentity/v1/", semanticKey);
    }

    function demandCarrier(string memory key) internal pure returns (bytes memory) {
        return abi.encodePacked("Demand/v1/", key);
    }

    function offerCarrier(string memory key) internal pure returns (bytes memory) {
        return abi.encodePacked("InferenceOffer/v2/", key);
    }

    function seat(address accountLocus) internal returns (bytes32 cell) {
        string memory semanticKey = accountLocus == NODE ? "node-cell" : "other-cell";
        vm.prank(accountLocus);
        cell = exchange.seatCell(cellCarrier(semanticKey), LAW);
    }

    function raise(address raiser, string memory key) internal returns (bytes32 demand) {
        vm.prank(raiser);
        demand = exchange.raiseDemand(demandCarrier(key), GROUNDING, LAW);
    }

    function offer(address controller, bytes32 demand, bytes32 cell, string memory key)
        internal
        returns (bytes32 offerId)
    {
        vm.prank(controller);
        offerId = exchange.offerDemand(demand, cell, offerCarrier(key));
    }

    function purchase(address raiser, bytes32 demand, bytes32 offerId) internal {
        vm.prank(raiser);
        exchange.purchaseMove(demand, offerId);
    }

    function testCellSemanticCoordinateIsTheSha256OfItsCarrier() public {
        bytes32 cell = seat(NODE);
        require(cell == nodeCell, "cell is not its carrier's content address");
        require(
            cell == exchange.contentAddress(cellCarrier("node-cell")),
            "contentAddress disagrees with the seated semantic coordinate"
        );
        require(nodeCell != otherCell, "distinct RMN carriers must seat distinct semantic cells");
        (address controller,, bool retired) = exchange.cells(cell);
        require(controller == NODE, "account locus is not the seating caller");
        require(!retired, "a freshly seated cell is not retired");
    }

    function testTheSameCarrierCannotBeSeatedTwice() public {
        bytes32 cell = seat(NODE);
        bytes memory expected =
            abi.encodeWithSelector(SemioticExchange.CellAlreadySeated.selector, cell);
        vm.expectRevert(expected);
        vm.prank(NODE);
        exchange.seatCell(cellCarrier("node-cell"), LAW);
    }

    function testDemandIsClaimedAndSettledByItsClaimant() public {
        bytes32 cell = seat(NODE);
        bytes32 demand = raise(OTHER, "one");
        bytes32 offerId = offer(NODE, demand, cell, "one");
        purchase(OTHER, demand, offerId);
        vm.prank(NODE);
        exchange.settleDemand(demand, "result");
        (,,, bytes32 claimant, bytes32 result) = exchange.demands(demand);
        require(claimant == cell, "claimant was not seated on the demand");
        require(result == RESULT, "result digest was not settled");
    }

    function testAClaimedDemandCannotBeTakenTwice() public {
        bytes32 cell = seat(NODE);
        bytes32 demand = raise(OTHER, "one");
        bytes32 first = offer(NODE, demand, cell, "first");
        bytes32 rival = seat(OTHER);
        bytes32 second = offer(OTHER, demand, rival, "second");
        purchase(OTHER, demand, second);
        bytes memory expected =
            abi.encodeWithSelector(SemioticExchange.DemandAlreadyClaimed.selector, demand, rival);
        vm.expectRevert(expected);
        vm.prank(OTHER);
        exchange.purchaseMove(demand, first);
    }

    function testOnlyTheClaimantsControllerCanSettle() public {
        bytes32 cell = seat(NODE);
        bytes32 demand = raise(OTHER, "one");
        bytes32 offerId = offer(NODE, demand, cell, "one");
        purchase(OTHER, demand, offerId);
        bytes memory expected =
            abi.encodeWithSelector(SemioticExchange.NotClaimant.selector, demand, cell);
        vm.expectRevert(expected);
        vm.prank(OTHER);
        exchange.settleDemand(demand, "forged");
    }

    function testAnUnclaimedDemandCannotBeSettled() public {
        bytes32 demand = raise(OTHER, "one");
        bytes memory expected =
            abi.encodeWithSelector(SemioticExchange.DemandNotClaimed.selector, demand);
        vm.expectRevert(expected);
        vm.prank(NODE);
        exchange.settleDemand(demand, "result");
    }

    function testASettledDemandIsClosedToFurtherSettlement() public {
        bytes32 cell = seat(NODE);
        bytes32 demand = raise(OTHER, "one");
        bytes32 offerId = offer(NODE, demand, cell, "one");
        purchase(OTHER, demand, offerId);
        vm.prank(NODE);
        exchange.settleDemand(demand, "result");
        bytes memory expected =
            abi.encodeWithSelector(SemioticExchange.DemandAlreadySettled.selector, demand);
        vm.expectRevert(expected);
        vm.prank(NODE);
        exchange.settleDemand(demand, "second");
    }

    function testARetiredCellTakesNoFurtherDemand() public {
        bytes32 cell = seat(NODE);
        vm.prank(NODE);
        exchange.retireCell(cell);
        bytes32 demand = raise(OTHER, "one");
        bytes memory expected =
            abi.encodeWithSelector(SemioticExchange.CellNotSeated.selector, cell);
        vm.expectRevert(expected);
        vm.prank(NODE);
        exchange.offerDemand(demand, cell, offerCarrier("retired"));
    }

    function testOnlyTheDemandRaiserCanPurchaseAnOffer() public {
        bytes32 cell = seat(NODE);
        bytes32 demand = raise(OTHER, "one");
        bytes32 offerId = offer(NODE, demand, cell, "one");
        bytes memory expected =
            abi.encodeWithSelector(SemioticExchange.NotDemandRaiser.selector, demand);
        vm.expectRevert(expected);
        vm.prank(NODE);
        exchange.purchaseMove(demand, offerId);
    }

    function testOfferAndResultAreCanonicalCarrierAddresses() public {
        bytes32 cell = seat(NODE);
        bytes32 demand = raise(OTHER, "one");
        bytes32 offerId = offer(NODE, demand, cell, "one");
        require(offerId == sha256(offerCarrier("one")), "offer is not content addressed");
        purchase(OTHER, demand, offerId);
        vm.prank(NODE);
        exchange.settleDemand(demand, "result");
        (,,,, bytes32 result) = exchange.demands(demand);
        require(result == sha256("result"), "result is not content addressed");
    }

    function testAnEmptyCarrierIsRefused() public {
        vm.expectRevert(SemioticExchange.UntypedCell.selector);
        vm.prank(NODE);
        exchange.seatCell("", LAW);

        vm.expectRevert(SemioticExchange.UngroundedDemand.selector);
        vm.prank(NODE);
        exchange.raiseDemand("", GROUNDING, LAW);
    }
}

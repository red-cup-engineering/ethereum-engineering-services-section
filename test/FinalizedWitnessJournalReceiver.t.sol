// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { EntryPoint } from "@account-abstraction/contracts/core/EntryPoint.sol";
import { IERC7786Recipient } from "@openzeppelin/contracts/interfaces/draft-IERC7786.sol";
import { FinalizedWitnessJournalReceiver } from "../src/FinalizedWitnessJournalReceiver.sol";
import { EnterpriseAccount, EnterpriseAccountFactory } from "../src/EnterpriseAccount.sol";

contract Mock7786Gateway {
    function deliver(
        address receiver,
        bytes32 receiveId,
        bytes calldata sender,
        bytes calldata payload
    ) external returns (bytes4) {
        return IERC7786Recipient(receiver).receiveMessage(receiveId, sender, payload);
    }
}

interface FinalityVm {
    function expectRevert() external;
    function expectRevert(bytes calldata reason) external;
    function expectRevert(bytes4 reason) external;
    function deal(address target, uint256 balance) external;
    function prank(address caller) external;
}

contract FinalizedWitnessJournalReceiverTest {
    FinalityVm private constant vm =
        FinalityVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    Mock7786Gateway internal gateway;
    EnterpriseAccount internal settlement;
    FinalizedWitnessJournalReceiver internal receiver;

    function setUp() public {
        gateway = new Mock7786Gateway();
        EnterpriseAccountFactory factory = new EnterpriseAccountFactory(new EntryPoint());
        settlement = factory.deploy(keccak256("settlement"), address(this), keccak256("salt"));
        receiver = new FinalizedWitnessJournalReceiver(address(gateway), address(settlement));
    }

    function payload() internal pure returns (bytes memory) {
        return abi.encode(keccak256("rmn-act"), keccak256("evidence"), keccak256("receipt"));
    }

    function testKnownGatewayImportsOneTypedReceiptAndReturnsStandardSelector() public {
        bytes32 receiveId = keccak256("receive-id");
        bytes memory sender = hex"000100000101140000000000000000000000000000000000000001";
        bytes4 result = gateway.deliver(address(receiver), receiveId, sender, payload());
        require(result == IERC7786Recipient.receiveMessage.selector, "wrong ERC-7786 selector");
        require(receiver.received(receiveId), "receipt was not marked received");
    }

    function testUnknownGatewayCannotWriteTheSettlementSeam() public {
        vm.expectRevert();
        receiver.receiveMessage(keccak256("receive-id"), hex"01", payload());
    }

    function testReceiptCannotReplayEvenIfGatewayViolatesItsOwnDuty() public {
        bytes32 receiveId = keccak256("receive-id");
        gateway.deliver(address(receiver), receiveId, hex"01", payload());
        vm.expectRevert(
            abi.encodeWithSelector(FinalizedWitnessJournalReceiver.ReplayedReceipt.selector, receiveId)
        );
        gateway.deliver(address(receiver), receiveId, hex"01", payload());
    }

    function testUntypedOrValueBearingDeliveryIsRefused() public {
        vm.expectRevert(FinalizedWitnessJournalReceiver.UntypedReceipt.selector);
        gateway.deliver(
            address(receiver),
            keccak256("empty"),
            hex"01",
            abi.encode(bytes32(0), bytes32(0), bytes32(0))
        );
        vm.deal(address(gateway), 1 ether);
        vm.prank(address(gateway));
        vm.expectRevert(FinalizedWitnessJournalReceiver.NativeValueForbidden.selector);
        receiver.receiveMessage{ value: 1 }(keccak256("value"), hex"01", payload());
    }
}

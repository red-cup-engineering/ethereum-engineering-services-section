// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { EntryPoint } from "@account-abstraction/contracts/core/EntryPoint.sol";
import { EnterpriseAccount } from "../src/EnterpriseAccount.sol";
import { TypedCommitmentProjection } from "../src/TypedCommitmentProjection.sol";

interface TypedCommitmentVm {
    function addr(uint256 privateKey) external returns (address);
    function expectRevert(bytes calldata revertData) external;
    function prank(address caller) external;
}

contract TypedCommitmentProjectionTest {
    TypedCommitmentVm private constant vm =
        TypedCommitmentVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    TypedCommitmentProjection private projection;
    EnterpriseAccount private account;

    bytes32 private constant ACT = bytes32(uint256(1));
    bytes32 private constant PREDICATE = bytes32(uint256(2));
    bytes32 private constant SUBJECT = bytes32(uint256(3));
    bytes32 private constant OBJECT = bytes32(uint256(4));
    bytes32 private constant EVIDENCE = bytes32(uint256(5));

    function setUp() public {
        EntryPoint entryPoint = new EntryPoint();
        account = new EnterpriseAccount(sha256("urn:ame:publisher"), entryPoint, vm.addr(0xA11CE));
        projection = new TypedCommitmentProjection();
    }

    function testSettlementAccountProjectsExactTypedCommitmentWithoutInteriorStorage() public {
        bytes32 expected =
            projection.commitmentId(ACT, address(account), PREDICATE, SUBJECT, OBJECT, EVIDENCE);
        vm.prank(address(account));
        bytes32 observed = projection.commit(ACT, PREDICATE, SUBJECT, OBJECT, EVIDENCE);
        require(observed == expected, "typed commitment identity drift");
    }

    function testEoaCannotProjectSettlementCommitment() public {
        address eoa = vm.addr(0xB0B);
        vm.expectRevert(
            abi.encodeWithSelector(
                TypedCommitmentProjection.SettlementAccountRequired.selector, eoa
            )
        );
        vm.prank(eoa);
        projection.commit(ACT, PREDICATE, SUBJECT, OBJECT, EVIDENCE);
    }

    function testNoFieldCanDisappearAtConsensusBoundary() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                TypedCommitmentProjection.MissingCommitmentField.selector, bytes32("object")
            )
        );
        vm.prank(address(account));
        projection.commit(ACT, PREDICATE, SUBJECT, bytes32(0), EVIDENCE);
    }
}

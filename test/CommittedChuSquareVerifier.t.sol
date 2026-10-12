// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { EntryPoint } from "@account-abstraction/contracts/core/EntryPoint.sol";
import { EnterpriseAccount } from "../src/EnterpriseAccount.sol";
import { CommittedChuSquareVerifier } from "../src/CommittedChuSquareVerifier.sol";

interface Vm {
    function addr(uint256 privateKey) external returns (address);
    function sign(uint256 privateKey, bytes32 digest)
        external
        returns (uint8 v, bytes32 r, bytes32 s);
    function expectRevert(bytes calldata revertData) external;
}

contract CommittedChuSquareVerifierTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 private constant POINT_KEY = 0xA11CE;
    uint256 private constant STATE_KEY = 0xB0B;

    CommittedChuSquareVerifier private verifier;
    EnterpriseAccount private pointAccount;
    EnterpriseAccount private stateAccount;

    event GasObserved(string indexed operation, uint256 gasUsed);
    event BytesObserved(string indexed carrier, uint256 byteLength);

    function setUp() public {
        EntryPoint entryPoint = new EntryPoint();
        pointAccount = new EnterpriseAccount(
            keccak256("urn:ame:point-owner"), entryPoint, vm.addr(POINT_KEY)
        );
        stateAccount = new EnterpriseAccount(
            keccak256("urn:ame:state-owner"), entryPoint, vm.addr(STATE_KEY)
        );
        verifier = new CommittedChuSquareVerifier();
    }

    function testValidCommittedSquareClosesAndStoresOnlyReplayMarker() public {
        (
            CommittedChuSquareVerifier.Square memory square,
            CommittedChuSquareVerifier.Witness memory witness,
            bytes memory pointSignature,
            bytes memory stateSignature
        ) = _fixture(1, 1);

        (CommittedChuSquareVerifier.RefusalCode code, bytes32 expectedId) =
            verifier.assay(square, witness, pointSignature, stateSignature);
        require(code == CommittedChuSquareVerifier.RefusalCode.None, "valid square refused");

        bytes memory closeCalldata = abi.encodeCall(
            verifier.closeSquare, (square, witness, pointSignature, stateSignature)
        );
        emit BytesObserved("close-valid-square-calldata", closeCalldata.length);

        uint256 gasBefore = gasleft();
        bytes32 actualId = verifier.closeSquare(square, witness, pointSignature, stateSignature);
        emit GasObserved("close-valid-square", gasBefore - gasleft());

        require(actualId == expectedId, "square id drift");
        require(verifier.isClosed(actualId), "closure flag absent");
        require(verifier.closedAtBlock(actualId) == block.number, "replay marker absent");
    }

    function testMismatchedCommitmentIsTypedRefusal() public {
        (
            CommittedChuSquareVerifier.Square memory square,
            CommittedChuSquareVerifier.Witness memory witness,
            bytes memory pointSignature,
            bytes memory stateSignature
        ) = _fixture(1, 1);
        witness.sourceCharge = 3;

        (CommittedChuSquareVerifier.RefusalCode code, bytes32 id) =
            verifier.assay(square, witness, pointSignature, stateSignature);
        require(
            code == CommittedChuSquareVerifier.RefusalCode.InvalidSourceProof,
            "wrong commitment refusal"
        );

        vm.expectRevert(
            abi.encodeWithSelector(
                CommittedChuSquareVerifier.SquareRefused.selector,
                CommittedChuSquareVerifier.RefusalCode.InvalidSourceProof,
                id
            )
        );
        verifier.closeSquare(square, witness, pointSignature, stateSignature);
    }

    function testNoncommutingTransitionIsTypedRefusal() public {
        (
            CommittedChuSquareVerifier.Square memory square,
            CommittedChuSquareVerifier.Witness memory witness,
            bytes memory pointSignature,
            bytes memory stateSignature
        ) = _fixture(1, 2);

        (CommittedChuSquareVerifier.RefusalCode code, bytes32 id) =
            verifier.assay(square, witness, pointSignature, stateSignature);
        require(
            code == CommittedChuSquareVerifier.RefusalCode.NonCommuting,
            "noncommuting transition admitted"
        );

        vm.expectRevert(
            abi.encodeWithSelector(
                CommittedChuSquareVerifier.SquareRefused.selector,
                CommittedChuSquareVerifier.RefusalCode.NonCommuting,
                id
            )
        );
        verifier.closeSquare(square, witness, pointSignature, stateSignature);
    }

    function testClosedSquareCannotReplay() public {
        (
            CommittedChuSquareVerifier.Square memory square,
            CommittedChuSquareVerifier.Witness memory witness,
            bytes memory pointSignature,
            bytes memory stateSignature
        ) = _fixture(2, 2);
        bytes32 id = verifier.closeSquare(square, witness, pointSignature, stateSignature);

        (CommittedChuSquareVerifier.RefusalCode code, bytes32 replayId) =
            verifier.assay(square, witness, pointSignature, stateSignature);
        require(code == CommittedChuSquareVerifier.RefusalCode.Replay, "replay admitted");
        require(replayId == id, "replay identity drift");
    }

    function testOneOwnerCannotSignBothVarianceHalves() public {
        (
            CommittedChuSquareVerifier.Square memory square,
            CommittedChuSquareVerifier.Witness memory witness,
            bytes memory ignoredPointSignature,
            bytes memory ignoredStateSignature
        ) = _fixture(1, 1);
        require(
            ignoredPointSignature.length == 65 && ignoredStateSignature.length == 65,
            "fixture signatures absent"
        );
        square.stateOwner = square.pointOwner;
        bytes memory pointSignature = _sign(POINT_KEY, verifier.pointHalfTypedDataHash(square));
        bytes memory stateSignature = _sign(POINT_KEY, verifier.stateHalfTypedDataHash(square));

        (CommittedChuSquareVerifier.RefusalCode code,) =
            verifier.assay(square, witness, pointSignature, stateSignature);
        require(code == CommittedChuSquareVerifier.RefusalCode.SameOwner, "one-owner seam admitted");
    }

    function _fixture(uint8 sourceCharge, uint8 targetCharge)
        private
        returns (
            CommittedChuSquareVerifier.Square memory square,
            CommittedChuSquareVerifier.Witness memory witness,
            bytes memory pointSignature,
            bytes memory stateSignature
        )
    {
        bytes32 sourcePoint = keccak256("source-capability");
        bytes32 targetPoint = keccak256("target-capability");
        bytes32 sourceState = keccak256("source-obligation");
        bytes32 targetState = keccak256("target-obligation");

        bytes32 sourceLeaf =
            verifier.leafHash(verifier.PROFILE(), sourcePoint, sourceState, sourceCharge);
        bytes32 sourceSibling = verifier.leafHash(
            verifier.PROFILE(), keccak256("source-other-point"), keccak256("source-other-state"), 0
        );
        bytes32 targetLeaf =
            verifier.leafHash(verifier.PROFILE(), targetPoint, targetState, targetCharge);
        bytes32 targetSibling = verifier.leafHash(
            verifier.PROFILE(), keccak256("target-other-point"), keccak256("target-other-state"), 3
        );

        square = CommittedChuSquareVerifier.Square({
            sourceRoot: _hashPair(sourceLeaf, sourceSibling),
            targetRoot: _hashPair(targetLeaf, targetSibling),
            sourcePoint: sourcePoint,
            targetPoint: targetPoint,
            targetState: targetState,
            sourceState: sourceState,
            pointOwner: address(pointAccount),
            stateOwner: address(stateAccount),
            nonce: uint256(sourceCharge) * 10 + targetCharge,
            deadline: block.timestamp + 1 days,
            profile: verifier.PROFILE()
        });

        bytes32[] memory sourceProof = new bytes32[](1);
        sourceProof[0] = sourceSibling;
        bytes32[] memory targetProof = new bytes32[](1);
        targetProof[0] = targetSibling;
        witness = CommittedChuSquareVerifier.Witness({
            sourceCharge: sourceCharge,
            targetCharge: targetCharge,
            sourceProof: sourceProof,
            targetProof: targetProof
        });

        pointSignature = _sign(POINT_KEY, verifier.pointHalfTypedDataHash(square));
        stateSignature = _sign(STATE_KEY, verifier.stateHalfTypedDataHash(square));
    }

    function _sign(uint256 privateKey, bytes32 digest) private returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function _hashPair(bytes32 a, bytes32 b) private pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }
}

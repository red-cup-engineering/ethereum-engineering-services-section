// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { ICrossSystemTimeWitnessRegistryV1 } from "./GlassSpongeInterfaces.sol";

/// @title CrossSystemTimeWitnessRegistryV1
/// @notice Exact Git, federation, and EVM position joins without timestamp inference.
/// @dev A witness is the recorder's immutable declaration of coordinates. This
///      registry does not infer equality from coincident wall-clock timestamps
///      and does not claim that Git or federation evidence was independently assayed.
contract CrossSystemTimeWitnessRegistryV1 is ICrossSystemTimeWitnessRegistryV1 {
    struct Witness {
        address recorder;
        bytes32 gitCommit;
        bytes32 federationPosition;
        uint256 evmBlockNumber;
        bytes32 evmBlockHash;
        bytes32 evmTransactionHash;
        uint64 evmLogIndex;
        bytes32 carrierDigest;
        uint64 recordedAtBlock;
    }

    mapping(bytes32 witness => Witness record) public witnesses;

    error EmptyWitnessField(bytes32 field);
    error WitnessAlreadyRecorded(bytes32 witness);

    event CrossSystemTimeWitnessRecorded(
        bytes32 indexed witness,
        address indexed recorder,
        bytes32 indexed gitCommit,
        bytes32 federationPosition,
        uint256 evmBlockNumber,
        bytes32 evmBlockHash,
        bytes32 evmTransactionHash,
        uint64 evmLogIndex,
        bytes32 carrierDigest,
        uint64 recordedAtBlock
    );

    function domainSeparator() public view returns (bytes32) {
        return
            keccak256(abi.encode("CrossSystemTimeWitnessRegistryV1", block.chainid, address(this)));
    }

    function witnessId(
        address recorder,
        bytes32 gitCommit,
        bytes32 federationPosition,
        uint256 evmBlockNumber,
        bytes32 evmBlockHash,
        bytes32 evmTransactionHash,
        uint64 evmLogIndex,
        bytes32 carrierDigest
    ) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                domainSeparator(),
                recorder,
                gitCommit,
                federationPosition,
                evmBlockNumber,
                evmBlockHash,
                evmTransactionHash,
                evmLogIndex,
                carrierDigest
            )
        );
    }

    function recordWitness(
        bytes32 gitCommit,
        bytes32 federationPosition,
        uint256 evmBlockNumber,
        bytes32 evmBlockHash,
        bytes32 evmTransactionHash,
        uint64 evmLogIndex,
        bytes32 carrierDigest
    ) external returns (bytes32 id) {
        if (gitCommit == bytes32(0)) revert EmptyWitnessField("gitCommit");
        if (federationPosition == bytes32(0)) {
            revert EmptyWitnessField("federationPosition");
        }
        if (evmBlockHash == bytes32(0)) revert EmptyWitnessField("evmBlockHash");
        if (evmTransactionHash == bytes32(0)) {
            revert EmptyWitnessField("evmTransactionHash");
        }
        if (carrierDigest == bytes32(0)) revert EmptyWitnessField("carrierDigest");
        id = witnessId(
            msg.sender,
            gitCommit,
            federationPosition,
            evmBlockNumber,
            evmBlockHash,
            evmTransactionHash,
            evmLogIndex,
            carrierDigest
        );
        if (witnesses[id].recorder != address(0)) revert WitnessAlreadyRecorded(id);
        uint64 recordedAtBlock = uint64(block.number);
        witnesses[id] = Witness({
            recorder: msg.sender,
            gitCommit: gitCommit,
            federationPosition: federationPosition,
            evmBlockNumber: evmBlockNumber,
            evmBlockHash: evmBlockHash,
            evmTransactionHash: evmTransactionHash,
            evmLogIndex: evmLogIndex,
            carrierDigest: carrierDigest,
            recordedAtBlock: recordedAtBlock
        });
        emit CrossSystemTimeWitnessRecorded(
            id,
            msg.sender,
            gitCommit,
            federationPosition,
            evmBlockNumber,
            evmBlockHash,
            evmTransactionHash,
            evmLogIndex,
            carrierDigest,
            recordedAtBlock
        );
    }

    function witnessExists(bytes32 id) external view returns (bool) {
        return witnesses[id].recorder != address(0);
    }
}

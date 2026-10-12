// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { IERC1271 } from "@openzeppelin/contracts/interfaces/IERC1271.sol";

/// @notice Append-only, ERC-1271-authorized heads for A2A task and coordination carriers.
/// @dev A carrier is represented only by its SHA-256 digest; the canonical RMN
/// body remains in immutable custody.  This ledger deliberately has no
/// SemioticExchange operation: task causality is not a demand or purchase.
contract A2aTaskTransitionLedgerV1 {
    bytes4 private constant ERC1271_MAGIC = 0x1626ba7e;

    struct Head {
        bytes32 carrierDigest;
        uint64 sequence;
        bool exists;
    }

    mapping(bytes32 coordinate => Head) public taskHeads;
    mapping(bytes32 coordinate => Head) public coordinationHeads;

    error InvalidEnterpriseAccount(address account);
    error InvalidCarrierDigest();
    error InvalidSignature(address account);
    error PriorHeadMismatch(bytes32 coordinate, bytes32 expected, bytes32 supplied);

    event A2aTaskTransition(
        bytes32 indexed coordinate,
        address indexed enterprise,
        bytes32 indexed tenant,
        bytes32 task,
        bytes32 priorCarrierDigest,
        bytes32 carrierDigest,
        uint64 sequence
    );
    event A2aCoordinationTransition(
        bytes32 indexed coordinate,
        address indexed enterprise,
        bytes32 indexed namespace,
        bytes32 tenant,
        bytes32 key,
        bytes32 priorCarrierDigest,
        bytes32 carrierDigest,
        bool removed,
        uint64 sequence
    );

    function domainSeparator() public view returns (bytes32) {
        return sha256(abi.encode("A2aTaskTransitionLedgerV1", block.chainid, address(this)));
    }

    function taskCoordinate(address enterprise, bytes32 tenant, bytes32 task) public view returns (bytes32) {
        return sha256(abi.encode(domainSeparator(), "task", enterprise, tenant, task));
    }

    function coordinationCoordinate(address enterprise, bytes32 namespace, bytes32 tenant, bytes32 key)
        public view returns (bytes32)
    {
        return sha256(abi.encode(domainSeparator(), "coordination", enterprise, namespace, tenant, key));
    }

    function taskTransitionDigest(
        address enterprise, bytes32 tenant, bytes32 task, bytes32 prior, bytes32 carrier
    ) public view returns (bytes32) {
        return sha256(abi.encode(domainSeparator(), "task-transition", enterprise, tenant, task, prior, carrier));
    }

    function coordinationTransitionDigest(
        address enterprise, bytes32 namespace, bytes32 tenant, bytes32 key, bytes32 prior, bytes32 carrier, bool removed
    ) public view returns (bytes32) {
        return sha256(abi.encode(domainSeparator(), "coordination-transition", enterprise, namespace, tenant, key, prior, carrier, removed));
    }

    function appendTaskTransition(bytes32 tenant, bytes32 task, bytes32 prior, bytes32 carrier, bytes calldata signature) external {
        bytes32 coordinate = taskCoordinate(msg.sender, tenant, task);
        _append(taskHeads[coordinate], coordinate, msg.sender, prior, carrier, taskTransitionDigest(msg.sender, tenant, task, prior, carrier), signature);
        emit A2aTaskTransition(coordinate, msg.sender, tenant, task, prior, carrier, taskHeads[coordinate].sequence);
    }

    function appendCoordinationTransition(bytes32 namespace, bytes32 tenant, bytes32 key, bytes32 prior, bytes32 carrier, bool removed, bytes calldata signature) external {
        bytes32 coordinate = coordinationCoordinate(msg.sender, namespace, tenant, key);
        _append(coordinationHeads[coordinate], coordinate, msg.sender, prior, carrier, coordinationTransitionDigest(msg.sender, namespace, tenant, key, prior, carrier, removed), signature);
        emit A2aCoordinationTransition(coordinate, msg.sender, namespace, tenant, key, prior, carrier, removed, coordinationHeads[coordinate].sequence);
    }

    function _append(Head storage head, bytes32 coordinate, address enterprise, bytes32 prior, bytes32 carrier, bytes32 digest, bytes calldata signature) private {
        if (enterprise.code.length == 0) revert InvalidEnterpriseAccount(enterprise);
        if (carrier == bytes32(0)) revert InvalidCarrierDigest();
        bytes32 current = head.exists ? head.carrierDigest : bytes32(0);
        if (current != prior) revert PriorHeadMismatch(coordinate, current, prior);
        try IERC1271(enterprise).isValidSignature(digest, signature) returns (bytes4 magic) {
            if (magic != ERC1271_MAGIC) revert InvalidSignature(enterprise);
        } catch { revert InvalidSignature(enterprise); }
        head.carrierDigest = carrier;
        head.sequence += 1;
        head.exists = true;
    }
}

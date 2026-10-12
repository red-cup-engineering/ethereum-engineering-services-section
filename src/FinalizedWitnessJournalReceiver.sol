// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import { ERC7786Recipient } from "@openzeppelin/contracts/crosschain/ERC7786Recipient.sol";

/// @notice Minimal ERC-7786 consensus projection for one sovereign settlement.
/// @dev Stores replay markers only; typed RMN/witness-journal interiors remain offchain.
contract FinalizedWitnessJournalReceiver is ERC7786Recipient {
    error InvalidReceiverConfiguration();
    error NativeValueForbidden();
    error EmptyReceiveId();
    error ReplayedReceipt(bytes32 receiveId);
    error UntypedReceipt();

    address public immutable gateway;
    address public immutable accountableSettlement;
    mapping(bytes32 receiveId => bool received) public received;

    event FinalizedWitnessJournalReceipt(
        bytes32 indexed receiveId,
        address indexed accountableSettlement,
        bytes32 indexed rmnAct,
        bytes32 evidenceRoot,
        bytes32 receiptDigest,
        bytes sender
    );

    constructor(address gateway_, address accountableSettlement_) {
        if (gateway_ == address(0) || accountableSettlement_.code.length == 0) {
            revert InvalidReceiverConfiguration();
        }
        gateway = gateway_;
        accountableSettlement = accountableSettlement_;
    }

    function _isAuthorizedGateway(address candidate, bytes calldata)
        internal
        view
        override
        returns (bool)
    {
        return candidate == gateway;
    }

    function _processMessage(
        address,
        bytes32 receiveId,
        bytes calldata sender,
        bytes calldata payload
    ) internal override {
        if (msg.value != 0) revert NativeValueForbidden();
        if (receiveId == bytes32(0)) revert EmptyReceiveId();
        if (received[receiveId]) revert ReplayedReceipt(receiveId);
        (bytes32 rmnAct, bytes32 evidenceRoot, bytes32 receiptDigest) =
            abi.decode(payload, (bytes32, bytes32, bytes32));
        if (rmnAct == bytes32(0) || evidenceRoot == bytes32(0) || receiptDigest == bytes32(0)) {
            revert UntypedReceipt();
        }
        received[receiveId] = true;
        emit FinalizedWitnessJournalReceipt(
            receiveId, accountableSettlement, rmnAct, evidenceRoot, receiptDigest, sender
        );
    }
}

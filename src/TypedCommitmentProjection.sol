// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { IERC1271 } from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import { IERC165 } from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @title TypedCommitmentProjection
/// @notice A storage-free EVM projection of one typed RMN commitment.
/// @dev The accountable settlement is msg.sender and MUST be a standard smart
///      account. Interior testimony is never accepted. Account replay and
///      authority remain the concern of the account's ERC-4337 EntryPoint.
contract TypedCommitmentProjection {
    error MissingCommitmentField(bytes32 field);
    error SettlementAccountRequired(address caller);

    event TypedCommitment(
        bytes32 indexed rmnAct,
        address indexed accountableSettlement,
        bytes32 indexed predicate,
        bytes32 subject,
        bytes32 object,
        bytes32 evidenceRoot,
        bytes32 commitmentId
    );

    function commitmentId(
        bytes32 rmnAct,
        address accountableSettlement,
        bytes32 predicate,
        bytes32 subject,
        bytes32 object,
        bytes32 evidenceRoot
    ) public pure returns (bytes32) {
        return sha256(
            abi.encode(rmnAct, accountableSettlement, predicate, subject, object, evidenceRoot)
        );
    }

    function commit(
        bytes32 rmnAct,
        bytes32 predicate,
        bytes32 subject,
        bytes32 object,
        bytes32 evidenceRoot
    ) external returns (bytes32 id) {
        if (rmnAct == bytes32(0)) revert MissingCommitmentField("rmnAct");
        if (predicate == bytes32(0)) revert MissingCommitmentField("predicate");
        if (subject == bytes32(0)) revert MissingCommitmentField("subject");
        if (object == bytes32(0)) revert MissingCommitmentField("object");
        if (evidenceRoot == bytes32(0)) revert MissingCommitmentField("evidenceRoot");
        if (!_isSettlementAccount(msg.sender)) revert SettlementAccountRequired(msg.sender);
        id = commitmentId(rmnAct, msg.sender, predicate, subject, object, evidenceRoot);
        emit TypedCommitment(rmnAct, msg.sender, predicate, subject, object, evidenceRoot, id);
    }

    function _isSettlementAccount(address candidate) private view returns (bool) {
        if (candidate.code.length == 0) return false;
        try IERC165(candidate).supportsInterface(type(IERC1271).interfaceId) returns (
            bool supported
        ) {
            return supported;
        } catch {
            return false;
        }
    }
}

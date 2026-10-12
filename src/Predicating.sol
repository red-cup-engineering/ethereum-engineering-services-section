// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { ArticulationCell } from "articulate/ArticulationCell.sol";

/// @title Predicating
/// @notice The morphism out of the potential cell. Its object is the
///         predication phi = (subject, predicate, object): three articulated
///         cells put into a directed relation. Potential is the only corner
///         predicating leaves from — an active, stable, or absurd cell has
///         already moved and is not a domain for this arrow.
/// @dev Realizes Obsmetrologia.Predicating. No free data: every one of the
///      three positions must be a cell seated by the rung below, so a
///      predication can only be generated from articulation and never imported
///      from external predicate logic. The id is the sha256 fold of the ordered
///      triple, matching the fold discipline of Utterance and Articulating.
contract Predicating {
    error CellNotSeated(bytes32 utteranceId);
    error SubjectNotPotential(bytes32 utteranceId, ArticulationCell.Corner corner);
    error PredicationAlreadyGenerated(bytes32 predication);
    error PredicationNotGenerated(bytes32 predication);

    event Predicated(
        bytes32 indexed predication,
        bytes32 indexed subject,
        bytes32 indexed predicate,
        bytes32 object,
        address predicator
    );

    /// The three positions of a predication, recovered by position exactly as
    /// an utterance recovers token and claim.
    enum Position {
        Subject,
        Predicate,
        Object
    }

    struct Phi {
        bytes32 subject;
        bytes32 predicate;
        bytes32 object;
        bool generated;
    }

    ArticulationCell public immutable cell;
    mapping(bytes32 => Phi) private phis;

    constructor(ArticulationCell domain) {
        cell = domain;
    }

    function predicationId(bytes32 subject, bytes32 predicate, bytes32 object)
        public
        pure
        returns (bytes32)
    {
        return sha256(abi.encode(subject, predicate, object));
    }

    /// Generate phi = (subject, predicate, object) out of a potential subject.
    function predicate_(bytes32 subject, bytes32 predicate, bytes32 object)
        external
        returns (bytes32 id)
    {
        _seated(subject);
        _seated(predicate);
        _seated(object);
        ArticulationCell.Corner subjectCorner = cell.corner(subject);
        if (subjectCorner != ArticulationCell.Corner.Potential) {
            revert SubjectNotPotential(subject, subjectCorner);
        }
        id = predicationId(subject, predicate, object);
        if (phis[id].generated) revert PredicationAlreadyGenerated(id);
        phis[id] = Phi({ subject: subject, predicate: predicate, object: object, generated: true });
        emit Predicated(id, subject, predicate, object, msg.sender);
    }

    function generated(bytes32 id) external view returns (bool) {
        return phis[id].generated;
    }

    /// Read off the cell sitting at a given position of the predication.
    function at_(bytes32 id, Position position) external view returns (bytes32) {
        Phi storage phi = _phi(id);
        if (position == Position.Subject) return phi.subject;
        if (position == Position.Predicate) return phi.predicate;
        return phi.object;
    }

    function subject(bytes32 id) external view returns (bytes32) {
        return _phi(id).subject;
    }

    function predicate(bytes32 id) external view returns (bytes32) {
        return _phi(id).predicate;
    }

    function object(bytes32 id) external view returns (bytes32) {
        return _phi(id).object;
    }

    function _seated(bytes32 utteranceId) private view {
        if (!cell.seated(utteranceId)) revert CellNotSeated(utteranceId);
    }

    function _phi(bytes32 id) private view returns (Phi storage phi) {
        phi = phis[id];
        if (!phi.generated) revert PredicationNotGenerated(id);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Utterance } from "./ArticulatingUtterance.sol";

/// @title ArticulationCell
/// @notice Articulating's codomain: an utterance plus two independent
///         articulation statuses (token, claim). One-way — a status moves
///         false to true and never back.
/// @dev Realizes Obsmetrologia.Articulating.Cell. corner is derived from
///      the two stored statuses via Corner.ofStatus, never itself stored.
///      Cells are keyed by utteranceId directly; there is no separate id fold.
contract ArticulationCell {
    error UtteranceNotFormed(bytes32 utteranceId);
    error CellNotSeated(bytes32 utteranceId);
    error CellAlreadySeated(bytes32 utteranceId);
    error TokenAlreadyArticulated(bytes32 utteranceId);
    error ClaimAlreadyArticulated(bytes32 utteranceId);

    event CellSeated(bytes32 indexed utteranceId, address seater);
    event TokenArticulated(bytes32 indexed utteranceId, address articulator);
    event ClaimArticulated(bytes32 indexed utteranceId, address articulator);

    /// The four corners of the partition, in Lean declaration order.
    enum Corner {
        Absurd,
        Potential,
        Active,
        Stable
    }

    struct Cell {
        bool tokenArticulated;
        bool claimArticulated;
        bool seated;
    }

    Utterance public immutable utterance;
    mapping(bytes32 => Cell) private cells;

    constructor(Utterance domain) {
        utterance = domain;
    }

    /// The cell over `utteranceId`, neither side articulated yet.
    function seat(bytes32 utteranceId) external {
        if (!utterance.formed(utteranceId)) revert UtteranceNotFormed(utteranceId);
        if (cells[utteranceId].seated) revert CellAlreadySeated(utteranceId);
        cells[utteranceId] = Cell({ tokenArticulated: false, claimArticulated: false, seated: true });
        emit CellSeated(utteranceId, msg.sender);
    }

    function seated(bytes32 utteranceId) external view returns (bool) {
        return cells[utteranceId].seated;
    }

    function tokenArticulated(bytes32 utteranceId) external view returns (bool) {
        return _cell(utteranceId).tokenArticulated;
    }

    function claimArticulated(bytes32 utteranceId) external view returns (bool) {
        return _cell(utteranceId).claimArticulated;
    }

    /// Move the token side false to true.
    function articulateToken(bytes32 utteranceId) external {
        Cell storage c = _cell(utteranceId);
        if (c.tokenArticulated) revert TokenAlreadyArticulated(utteranceId);
        c.tokenArticulated = true;
        emit TokenArticulated(utteranceId, msg.sender);
    }

    /// Move the claim side false to true.
    function articulateClaim(bytes32 utteranceId) external {
        Cell storage c = _cell(utteranceId);
        if (c.claimArticulated) revert ClaimAlreadyArticulated(utteranceId);
        c.claimArticulated = true;
        emit ClaimArticulated(utteranceId, msg.sender);
    }

    /// The corner a cell sits in, read off its two stored statuses.
    function corner(bytes32 utteranceId) external view returns (Corner) {
        Cell storage c = _cell(utteranceId);
        return _ofStatus(c.tokenArticulated, c.claimArticulated);
    }

    function _ofStatus(bool token, bool claim) private pure returns (Corner) {
        if (!token && !claim) return Corner.Absurd;
        if (token && !claim) return Corner.Potential;
        if (!token && claim) return Corner.Active;
        return Corner.Stable;
    }

    function _cell(bytes32 utteranceId) private view returns (Cell storage c) {
        c = cells[utteranceId];
        if (!c.seated) revert CellNotSeated(utteranceId);
    }
}

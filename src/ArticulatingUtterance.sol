// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Mark } from "./ArticulatingMark.sol";

/// @title Utterance
/// @notice The ordered pair of a token-side mark and a claim-side mark —
///         articulating's domain. Token first, claim second; the order is
///         load-bearing. An utterance is not an act: it articulates nothing.
/// @dev Realizes Obsmetrologia.Utterance. No free data: both sides must be
///      admitted marks, and nothing else enters. The pair components are the
///      stored state so that at_ (read by position) and downstream composition
///      stay on-chain; the id is the sha256 fold of the ordered pair.
contract Utterance {
    error MarkNotAdmitted(bytes32 mark);
    error UtteranceAlreadyFormed(bytes32 utterance);
    error UtteranceNotFormed(bytes32 utterance);

    event UtteranceFormed(
        bytes32 indexed utterance,
        bytes32 indexed token,
        bytes32 indexed claim,
        address utterer
    );

    /// Kind is positional: the two kinds of a mark, recovered by position.
    enum Kind {
        Token,
        Claim
    }

    struct Pair {
        bytes32 token;
        bytes32 claim;
        bool formed;
    }

    Mark public immutable mark;
    mapping(bytes32 => Pair) private pairs;

    constructor(Mark admission) {
        mark = admission;
    }

    function utteranceId(bytes32 token, bytes32 claim) public pure returns (bytes32) {
        return sha256(abi.encode(token, claim));
    }

    function form(bytes32 token, bytes32 claim) external returns (bytes32 id) {
        if (!mark.admitted(token)) revert MarkNotAdmitted(token);
        if (!mark.admitted(claim)) revert MarkNotAdmitted(claim);
        id = utteranceId(token, claim);
        if (pairs[id].formed) revert UtteranceAlreadyFormed(id);
        pairs[id] = Pair({ token: token, claim: claim, formed: true });
        emit UtteranceFormed(id, token, claim, msg.sender);
    }

    function formed(bytes32 id) external view returns (bool) {
        return pairs[id].formed;
    }

    /// Read off the mark sitting at a given kind/position of the utterance.
    function at_(bytes32 id, Kind kind) external view returns (bytes32) {
        Pair storage pair = pairs[id];
        if (!pair.formed) revert UtteranceNotFormed(id);
        return kind == Kind.Token ? pair.token : pair.claim;
    }
}

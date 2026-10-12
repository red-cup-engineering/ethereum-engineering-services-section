// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Utterance } from "./ArticulatingUtterance.sol";

/// @title Articulating
/// @notice The base morphism: recursively the pair [utterance, articulating],
///         bottoming out at an innermost utterance of admitted marks. One-way —
///         no arrow returns to a pre-relational state; a node, once witnessed,
///         is never unmade. This is the second and last place free acts enter:
///         below Articulating, nothing is free.
/// @dev Realizes Obsmetrologia.Articulating (utter | pair) as content-addressed
///      nodes: utter ids fold (0, utterance); pair ids fold (1, utterance, child).
///      head and moved are stored readouts; depth is stored so pair formation is
///      O(1); floor walks the one-way chain to the primitive floor.
contract Articulating {
    error UtteranceNotFormed(bytes32 utterance);
    error ArticulatingNotFound(bytes32 articulating);
    error ArticulatingAlreadyFormed(bytes32 articulating);

    event Uttered(bytes32 indexed articulating, bytes32 indexed head, address articulator);
    event Paired(
        bytes32 indexed articulating,
        bytes32 indexed head,
        bytes32 indexed child,
        address articulator
    );

    struct Node {
        bytes32 head;
        bytes32 child;
        uint64 depth;
        bool isPair;
        bool formed;
    }

    Utterance public immutable utterance;
    mapping(bytes32 => Node) private nodes;

    constructor(Utterance domain) {
        utterance = domain;
    }

    function utterId(bytes32 headUtterance) public pure returns (bytes32) {
        return sha256(abi.encode(uint8(0), headUtterance));
    }

    function pairId(bytes32 headUtterance, bytes32 childArticulating) public pure returns (bytes32) {
        return sha256(abi.encode(uint8(1), headUtterance, childArticulating));
    }

    /// The innermost articulation: a bare utterance — the recursion's floor.
    function utter(bytes32 headUtterance) external returns (bytes32 id) {
        if (!utterance.formed(headUtterance)) revert UtteranceNotFormed(headUtterance);
        id = utterId(headUtterance);
        if (nodes[id].formed) revert ArticulatingAlreadyFormed(id);
        nodes[id] = Node({ head: headUtterance, child: bytes32(0), depth: 0, isPair: false, formed: true });
        emit Uttered(id, headUtterance, msg.sender);
    }

    /// [utterance, articulating]: an utterance articulated over a further one.
    function pair(bytes32 headUtterance, bytes32 childArticulating) external returns (bytes32 id) {
        if (!utterance.formed(headUtterance)) revert UtteranceNotFormed(headUtterance);
        Node storage below = nodes[childArticulating];
        if (!below.formed) revert ArticulatingNotFound(childArticulating);
        id = pairId(headUtterance, childArticulating);
        if (nodes[id].formed) revert ArticulatingAlreadyFormed(id);
        nodes[id] = Node({ head: headUtterance, child: childArticulating, depth: below.depth + 1, isPair: true, formed: true });
        emit Paired(id, headUtterance, childArticulating, msg.sender);
    }

    function formed(bytes32 id) external view returns (bool) {
        return nodes[id].formed;
    }

    /// The utterance articulated at the head — articulating's domain projection.
    function head(bytes32 id) external view returns (bytes32) {
        Node storage node = _node(id);
        return node.head;
    }

    /// How many nested articulatings before the primitive floor.
    function depth(bytes32 id) external view returns (uint64) {
        Node storage node = _node(id);
        return node.depth;
    }

    /// Whether articulation has continued past the current head.
    function moved(bytes32 id) external view returns (bool) {
        Node storage node = _node(id);
        return node.isPair;
    }

    /// Every articulating bottoms out: walk the one-way chain to the innermost
    /// utterance. Total because depth is finite by construction.
    function floor(bytes32 id) external view returns (bytes32) {
        Node storage node = _node(id);
        while (node.isPair) {
            node = nodes[node.child];
        }
        return node.head;
    }

    function _node(bytes32 id) private view returns (Node storage node) {
        node = nodes[id];
        if (!node.formed) revert ArticulatingNotFound(id);
    }
}

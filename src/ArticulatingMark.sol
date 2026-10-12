// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title Mark
/// @notice The primitive admission of the Semiotic Exchange Chain. A mark is
///         its surface and nothing else: nullary, chargeless, unowned, and
///         unkinded. Kind (token | claim) is positional and belongs to the
///         utterance that positions the mark, never to the mark itself.
/// @dev The event log is the append-only admission spine (the truth order);
///      storage holds one bit per mark so that a second admission is refused
///      rather than double-witnessed, keeping state the exact fold of the log.
///      Admission is ungated: charge, authority, and payment are relational
///      data and enter only at later rungs — past Mark and Articulating,
///      nothing is free.
contract Mark {
    error EmptySurface();
    error MarkAlreadyAdmitted(bytes32 mark);

    event MarkAdmitted(bytes32 indexed mark, address indexed admitter, bytes surface);

    mapping(bytes32 => bool) public admitted;

    function markId(bytes calldata surface) public pure returns (bytes32) {
        return sha256(surface);
    }

    function admit(bytes calldata surface) external returns (bytes32 id) {
        if (surface.length == 0) revert EmptySurface();
        id = sha256(surface);
        if (admitted[id]) revert MarkAlreadyAdmitted(id);
        admitted[id] = true;
        emit MarkAdmitted(id, msg.sender, surface);
    }
}

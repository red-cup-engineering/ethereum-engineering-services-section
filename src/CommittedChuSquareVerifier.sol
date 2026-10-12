// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IERC1271SquareOwner {
    function isValidSignature(bytes32 hash, bytes calldata signature)
        external
        view
        returns (bytes4 magicValue);
}

/// @title CommittedChuSquareVerifier
/// @notice Verifies one strict FOUR-valued Chu commuting square without storing
///         either enterprise's matrix interior.
/// @dev Merkle leaves, proofs, half-maps, and signatures arrive as calldata and
///      therefore remain consensus-visible EVM history. This profile proves a
///      committed seam; it is not a private or residue-only proof system.
contract CommittedChuSquareVerifier {
    enum RefusalCode {
        None,
        Expired,
        SameOwner,
        NonContractOwner,
        InvalidProfile,
        InvalidCharge,
        InvalidPointSignature,
        InvalidStateSignature,
        InvalidSourceProof,
        InvalidTargetProof,
        NonCommuting,
        Replay
    }

    struct Square {
        bytes32 sourceRoot;
        bytes32 targetRoot;
        bytes32 sourcePoint;
        bytes32 targetPoint;
        bytes32 targetState;
        bytes32 sourceState;
        address pointOwner;
        address stateOwner;
        uint256 nonce;
        uint256 deadline;
        bytes32 profile;
    }

    struct Witness {
        uint8 sourceCharge;
        uint8 targetCharge;
        bytes32[] sourceProof;
        bytes32[] targetProof;
    }

    error SquareRefused(RefusalCode code, bytes32 squareId);

    event SquareClosed(
        bytes32 indexed squareId,
        bytes32 indexed sourceRoot,
        bytes32 indexed targetRoot,
        bytes32 pointHalfDigest,
        bytes32 stateHalfDigest,
        bytes32 profile,
        uint8 circuitResidue,
        uint256 closedAtBlock
    );

    bytes32 public constant PROFILE = keccak256("org.emsenn.chu.four.strict-square.v1");

    bytes32 private constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 private constant POINT_HALF_TYPEHASH = keccak256(
        "PointHalf(bytes32 sourceRoot,bytes32 targetRoot,bytes32 sourcePoint,bytes32 targetPoint,uint256 nonce,uint256 deadline,bytes32 profile)"
    );
    bytes32 private constant STATE_HALF_TYPEHASH = keccak256(
        "StateHalf(bytes32 sourceRoot,bytes32 targetRoot,bytes32 targetState,bytes32 sourceState,uint256 nonce,uint256 deadline,bytes32 profile)"
    );
    bytes32 private constant NAME_HASH = keccak256("CommittedChuSquareVerifier");
    bytes32 private constant VERSION_HASH = keccak256("1");
    bytes4 private constant ERC1271_MAGIC_VALUE = 0x1626ba7e;

    mapping(bytes32 squareId => uint256 blockNumberPlusOne) private _closedAtBlockPlusOne;

    function closedAtBlock(bytes32 id) public view returns (uint256) {
        uint256 encoded = _closedAtBlockPlusOne[id];
        if (encoded == 0) return 0;
        return encoded - 1;
    }

    function isClosed(bytes32 id) public view returns (bool) {
        return _closedAtBlockPlusOne[id] != 0;
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(
            abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this))
        );
    }

    function leafHash(bytes32 profile, bytes32 point, bytes32 state, uint8 charge)
        public
        pure
        returns (bytes32)
    {
        return keccak256(bytes.concat(keccak256(abi.encode(profile, point, state, charge))));
    }

    function squareId(Square calldata square) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                square.sourceRoot,
                square.targetRoot,
                square.sourcePoint,
                square.targetPoint,
                square.targetState,
                square.sourceState,
                square.pointOwner,
                square.stateOwner,
                square.nonce,
                square.deadline,
                square.profile
            )
        );
    }

    function pointHalfTypedDataHash(Square calldata square) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                POINT_HALF_TYPEHASH,
                square.sourceRoot,
                square.targetRoot,
                square.sourcePoint,
                square.targetPoint,
                square.nonce,
                square.deadline,
                square.profile
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }

    function stateHalfTypedDataHash(Square calldata square) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                STATE_HALF_TYPEHASH,
                square.sourceRoot,
                square.targetRoot,
                square.targetState,
                square.sourceState,
                square.nonce,
                square.deadline,
                square.profile
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }

    function assay(
        Square calldata square,
        Witness calldata witness,
        bytes calldata pointSignature,
        bytes calldata stateSignature
    ) external view returns (RefusalCode code, bytes32 id) {
        return _assay(square, witness, pointSignature, stateSignature);
    }

    function closeSquare(
        Square calldata square,
        Witness calldata witness,
        bytes calldata pointSignature,
        bytes calldata stateSignature
    ) external returns (bytes32 id) {
        RefusalCode code;
        (code, id) = _assay(square, witness, pointSignature, stateSignature);
        if (code != RefusalCode.None) revert SquareRefused(code, id);

        _closedAtBlockPlusOne[id] = block.number + 1;
        emit SquareClosed(
            id,
            square.sourceRoot,
            square.targetRoot,
            pointHalfTypedDataHash(square),
            stateHalfTypedDataHash(square),
            square.profile,
            0,
            block.number
        );
    }

    function _assay(
        Square calldata square,
        Witness calldata witness,
        bytes calldata pointSignature,
        bytes calldata stateSignature
    ) internal view returns (RefusalCode code, bytes32 id) {
        id = squareId(square);
        if (_closedAtBlockPlusOne[id] != 0) return (RefusalCode.Replay, id);
        if (square.deadline < block.timestamp) return (RefusalCode.Expired, id);
        if (square.pointOwner == address(0) || square.pointOwner == square.stateOwner) {
            return (RefusalCode.SameOwner, id);
        }
        if (square.pointOwner.code.length == 0 || square.stateOwner.code.length == 0) {
            return (RefusalCode.NonContractOwner, id);
        }
        if (square.profile != PROFILE) return (RefusalCode.InvalidProfile, id);
        if (witness.sourceCharge > 3 || witness.targetCharge > 3) {
            return (RefusalCode.InvalidCharge, id);
        }
        if (!_validOwnerSignature(
                square.pointOwner, pointHalfTypedDataHash(square), pointSignature
            )) {
            return (RefusalCode.InvalidPointSignature, id);
        }
        if (!_validOwnerSignature(
                square.stateOwner, stateHalfTypedDataHash(square), stateSignature
            )) {
            return (RefusalCode.InvalidStateSignature, id);
        }

        bytes32 sourceLeaf = leafHash(
            square.profile, square.sourcePoint, square.sourceState, witness.sourceCharge
        );
        if (!_verify(witness.sourceProof, square.sourceRoot, sourceLeaf)) {
            return (RefusalCode.InvalidSourceProof, id);
        }
        bytes32 targetLeaf = leafHash(
            square.profile, square.targetPoint, square.targetState, witness.targetCharge
        );
        if (!_verify(witness.targetProof, square.targetRoot, targetLeaf)) {
            return (RefusalCode.InvalidTargetProof, id);
        }
        if (witness.sourceCharge != witness.targetCharge) {
            return (RefusalCode.NonCommuting, id);
        }
        return (RefusalCode.None, id);
    }

    function _verify(bytes32[] calldata proof, bytes32 root, bytes32 leaf)
        internal
        pure
        returns (bool)
    {
        bytes32 computed = leaf;
        for (uint256 i = 0; i < proof.length; ++i) {
            computed = _hashPair(computed, proof[i]);
        }
        return computed == root;
    }

    function _hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    function _validOwnerSignature(address owner, bytes32 digest, bytes calldata signature)
        internal
        view
        returns (bool)
    {
        if (owner.code.length == 0) return false;
        (bool success, bytes memory result) = owner.staticcall(
            abi.encodeCall(IERC1271SquareOwner.isValidSignature, (digest, signature))
        );
        return success && result.length >= 32 && abi.decode(result, (bytes4)) == ERC1271_MAGIC_VALUE;
    }
}

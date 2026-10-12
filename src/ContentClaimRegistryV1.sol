// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {
    ICanonicalUtteranceV1,
    ICrossSystemTimeWitnessRegistryV1
} from "./GlassSpongeInterfaces.sol";

/// @title ContentClaimRegistryV1
/// @notice Versioned provenance and dependency roots for canonical Utterances.
/// @dev The primitive is the ordered Utterance(token Mark, claim Mark), never an
///      undifferentiated claim. Token and claim must be distinct marks already
///      formed by the canonical Articulating Utterance contract. A registration
///      is the controller's durable declaration, not an assay. Events support an
///      ActivityPub knowledge-order projection, but an event alone does not
///      claim that such a projection or federation publication occurred.
contract ContentClaimRegistryV1 {
    struct Claim {
        address controller;
        bytes32 utterance;
        bytes32 tokenMark;
        bytes32 claimMark;
        bytes32 provenanceRoot;
        bytes32 dependencyRoot;
        bytes32 carrierDigest;
        bytes32 timeWitness;
        bytes32 previousClaim;
        uint64 version;
        uint64 registeredAtBlock;
        uint64 revokedAtBlock;
        bool revoked;
    }

    ICanonicalUtteranceV1 public immutable utterances;
    ICrossSystemTimeWitnessRegistryV1 public immutable timeWitnesses;
    mapping(bytes32 claim => Claim record) public claims;
    mapping(address controller => mapping(bytes32 utterance => bytes32 claim)) public latestClaim;

    error InvalidUtteranceRegistry(address registry);
    error InvalidTimeWitnessRegistry(address registry);
    error TimeWitnessNotRecorded(bytes32 witness);
    error EmptyClaimField(bytes32 field);
    error UtteranceNotFormed(bytes32 utterance);
    error DegenerateUtterance(bytes32 utterance);
    error ClaimAlreadyRegistered(bytes32 claim);
    error ClaimNotRegistered(bytes32 claim);
    error NotClaimController(bytes32 claim, address caller);
    error PreviousClaimMismatch(bytes32 expected, bytes32 supplied);
    error PreviousClaimActive(bytes32 claim);
    error ClaimAlreadyRevoked(bytes32 claim);

    event ContentClaimRegistered(
        bytes32 indexed claim,
        address indexed controller,
        bytes32 indexed utterance,
        bytes32 tokenMark,
        bytes32 claimMark,
        bytes32 provenanceRoot,
        bytes32 dependencyRoot,
        bytes32 carrierDigest,
        bytes32 timeWitness,
        bytes32 previousClaim,
        uint64 version,
        uint64 registeredAtBlock
    );

    event ContentClaimRevoked(
        bytes32 indexed claim,
        address indexed controller,
        bytes32 indexed utterance,
        bytes32 tokenMark,
        bytes32 claimMark,
        bytes32 provenanceRoot,
        bytes32 dependencyRoot,
        bytes32 carrierDigest,
        bytes32 timeWitness,
        bytes32 previousClaim,
        uint64 version,
        uint64 registeredAtBlock,
        uint64 revokedAtBlock
    );

    constructor(
        ICanonicalUtteranceV1 utterances_,
        ICrossSystemTimeWitnessRegistryV1 timeWitnesses_
    ) {
        if (address(utterances_).code.length == 0) {
            revert InvalidUtteranceRegistry(address(utterances_));
        }
        if (address(timeWitnesses_).code.length == 0) {
            revert InvalidTimeWitnessRegistry(address(timeWitnesses_));
        }
        utterances = utterances_;
        timeWitnesses = timeWitnesses_;
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode("ContentClaimRegistryV1", block.chainid, address(this)));
    }

    function claimId(
        address controller,
        bytes32 utterance,
        bytes32 tokenMark,
        bytes32 claimMark,
        bytes32 provenanceRoot,
        bytes32 dependencyRoot,
        bytes32 carrierDigest,
        bytes32 timeWitness,
        bytes32 previousClaim,
        uint64 version
    ) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                domainSeparator(),
                controller,
                utterance,
                tokenMark,
                claimMark,
                provenanceRoot,
                dependencyRoot,
                carrierDigest,
                timeWitness,
                previousClaim,
                version
            )
        );
    }

    function registerClaim(
        bytes32 utterance,
        bytes32 provenanceRoot,
        bytes32 dependencyRoot,
        bytes32 carrierDigest,
        bytes32 timeWitness,
        bytes32 previousClaim
    ) external returns (bytes32 id) {
        if (!utterances.formed(utterance)) {
            revert UtteranceNotFormed(utterance);
        }
        bytes32 tokenMark = utterances.at_(utterance, 0);
        bytes32 claimMark = utterances.at_(utterance, 1);
        if (tokenMark == claimMark) revert DegenerateUtterance(utterance);
        if (provenanceRoot == bytes32(0)) revert EmptyClaimField("provenanceRoot");
        if (dependencyRoot == bytes32(0)) revert EmptyClaimField("dependencyRoot");
        if (carrierDigest == bytes32(0)) revert EmptyClaimField("carrierDigest");
        if (!timeWitnesses.witnessExists(timeWitness)) {
            revert TimeWitnessNotRecorded(timeWitness);
        }

        bytes32 expected = latestClaim[msg.sender][utterance];
        if (previousClaim != expected) revert PreviousClaimMismatch(expected, previousClaim);
        uint64 version = 1;
        if (expected != bytes32(0)) {
            Claim storage previous = claims[expected];
            if (!previous.revoked) revert PreviousClaimActive(expected);
            version = previous.version + 1;
        }
        id = claimId(
            msg.sender,
            utterance,
            tokenMark,
            claimMark,
            provenanceRoot,
            dependencyRoot,
            carrierDigest,
            timeWitness,
            previousClaim,
            version
        );
        if (claims[id].controller != address(0)) revert ClaimAlreadyRegistered(id);
        uint64 registeredAtBlock = uint64(block.number);
        claims[id] = Claim({
            controller: msg.sender,
            utterance: utterance,
            tokenMark: tokenMark,
            claimMark: claimMark,
            provenanceRoot: provenanceRoot,
            dependencyRoot: dependencyRoot,
            carrierDigest: carrierDigest,
            timeWitness: timeWitness,
            previousClaim: previousClaim,
            version: version,
            registeredAtBlock: registeredAtBlock,
            revokedAtBlock: 0,
            revoked: false
        });
        latestClaim[msg.sender][utterance] = id;
        emit ContentClaimRegistered(
            id,
            msg.sender,
            utterance,
            tokenMark,
            claimMark,
            provenanceRoot,
            dependencyRoot,
            carrierDigest,
            timeWitness,
            previousClaim,
            version,
            registeredAtBlock
        );
    }

    function revokeClaim(bytes32 id) external {
        Claim storage claim = claims[id];
        if (claim.controller == address(0)) revert ClaimNotRegistered(id);
        if (claim.controller != msg.sender) revert NotClaimController(id, msg.sender);
        if (claim.revoked) revert ClaimAlreadyRevoked(id);
        claim.revoked = true;
        claim.revokedAtBlock = uint64(block.number);
        emit ContentClaimRevoked(
            id,
            claim.controller,
            claim.utterance,
            claim.tokenMark,
            claim.claimMark,
            claim.provenanceRoot,
            claim.dependencyRoot,
            claim.carrierDigest,
            claim.timeWitness,
            claim.previousClaim,
            claim.version,
            claim.registeredAtBlock,
            claim.revokedAtBlock
        );
    }

    function isActive(bytes32 id) external view returns (bool) {
        return claims[id].controller != address(0) && !claims[id].revoked;
    }
}

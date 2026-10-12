// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {
    IConsiderationEvidenceRegistryV1,
    IConsiderationVerifierV1,
    ICrossSystemTimeWitnessRegistryV1,
    ISemioticExchangeV1
} from "./GlassSpongeInterfaces.sol";

/// @title ConsiderationEvidenceRegistryV1
/// @notice Immutable border-quote and consideration evidence joined to one
///         purchased SemioticExchange v1 offer.
/// @dev Side, exact lot, asset/amount/payee, validity, issuer-bound authority,
///      payment digest, and an explicit cross-system witness remain separate.
///      There is no global scalar price. Quoted, authorized, incurred, and
///      settled are distinct phases. An unverified entry is only a counterparty
///      declaration. Named-verifier evidence attributes its result only to that
///      verifier and does not make this registry a payment oracle.
contract ConsiderationEvidenceRegistryV1 is IConsiderationEvidenceRegistryV1 {
    enum Side {
        Buy,
        Sell
    }

    enum Phase {
        Quoted,
        Authorized,
        Incurred,
        Settled
    }

    struct Input {
        bytes32 demand;
        bytes32 offer;
        Side side;
        bytes32 lot;
        bytes32 asset;
        uint256 amount;
        address payee;
        bytes32 paymentDigest;
        uint64 validAfter;
        uint64 validBefore;
        bytes32 authorityDigest;
        bytes32 timeWitness;
        Phase phase;
    }

    struct Evidence {
        address declarant;
        bytes32 demand;
        bytes32 offer;
        Side side;
        bytes32 lot;
        bytes32 asset;
        uint256 amount;
        address payee;
        bytes32 paymentDigest;
        uint64 validAfter;
        uint64 validBefore;
        bytes32 authorityDigest;
        bytes32 timeWitness;
        Phase phase;
        address verifier;
        bytes32 verificationDigest;
        uint64 recordedAtBlock;
    }

    ISemioticExchangeV1 public immutable exchange;
    ICrossSystemTimeWitnessRegistryV1 public immutable timeWitnesses;
    mapping(bytes32 evidence => Evidence record) public evidences;

    error InvalidExchange(address exchange);
    error InvalidTimeWitnessRegistry(address registry);
    error TimeWitnessNotRecorded(bytes32 witness);
    error EmptyConsiderationField(bytes32 field);
    error InvalidAmount();
    error InvalidValidity(uint64 validAfter, uint64 validBefore);
    error PurchaseJoinMissing(bytes32 demand, bytes32 offer);
    error NotConsiderationCounterparty(address caller);
    error EvidenceAlreadyRecorded(bytes32 evidence);
    error InvalidVerifier(address verifier);
    error ConsiderationNotVerified(address verifier);

    event ConsiderationEvidenceRecorded(
        bytes32 indexed evidence,
        bytes32 indexed demand,
        bytes32 indexed offer,
        address declarant,
        Side side,
        bytes32 lot,
        bytes32 asset,
        uint256 amount,
        address payee,
        bytes32 paymentDigest,
        uint64 validAfter,
        uint64 validBefore,
        bytes32 authorityDigest,
        bytes32 timeWitness,
        Phase phase,
        address verifier,
        bytes32 verificationDigest,
        uint64 recordedAtBlock
    );

    constructor(ISemioticExchangeV1 exchange_, ICrossSystemTimeWitnessRegistryV1 timeWitnesses_) {
        if (address(exchange_).code.length == 0) revert InvalidExchange(address(exchange_));
        if (address(timeWitnesses_).code.length == 0) {
            revert InvalidTimeWitnessRegistry(address(timeWitnesses_));
        }
        exchange = exchange_;
        timeWitnesses = timeWitnesses_;
    }

    function domainSeparator() public view returns (bytes32) {
        return
            keccak256(abi.encode("ConsiderationEvidenceRegistryV1", block.chainid, address(this)));
    }

    function evidencePayloadDigest(address declarant, Input calldata input)
        public
        view
        returns (bytes32)
    {
        return keccak256(abi.encode(domainSeparator(), declarant, input));
    }

    function evidenceId(
        address declarant,
        Input calldata input,
        address verifier,
        bytes32 verificationDigest
    ) public view returns (bytes32) {
        return keccak256(
            abi.encode(evidencePayloadDigest(declarant, input), verifier, verificationDigest)
        );
    }

    function recordDeclared(Input calldata input) external returns (bytes32 id) {
        _requireInput(input);
        _requirePurchasedCounterparty(input.demand, input.offer, msg.sender);
        id = _record(input, address(0), bytes32(0));
    }

    function recordVerified(
        Input calldata input,
        IConsiderationVerifierV1 verifier,
        bytes calldata proof
    ) external returns (bytes32 id) {
        _requireInput(input);
        _requirePurchasedCounterparty(input.demand, input.offer, msg.sender);
        if (address(verifier).code.length == 0) revert InvalidVerifier(address(verifier));
        (bool verified, bytes32 verificationDigest) = verifier.verifyConsideration(
            domainSeparator(), evidencePayloadDigest(msg.sender, input), proof
        );
        if (!verified || verificationDigest == bytes32(0)) {
            revert ConsiderationNotVerified(address(verifier));
        }
        id = _record(input, address(verifier), verificationDigest);
    }

    function evidenceJoin(bytes32 id)
        external
        view
        returns (bytes32 demand, bytes32 offer, bool exists)
    {
        Evidence storage evidence = evidences[id];
        return (evidence.demand, evidence.offer, evidence.declarant != address(0));
    }

    function isNamedVerifierEvidence(bytes32 id) external view returns (bool) {
        Evidence storage evidence = evidences[id];
        return evidence.declarant != address(0) && evidence.verifier != address(0);
    }

    function _record(Input calldata input, address verifier, bytes32 verificationDigest)
        private
        returns (bytes32 id)
    {
        id = evidenceId(msg.sender, input, verifier, verificationDigest);
        if (evidences[id].declarant != address(0)) revert EvidenceAlreadyRecorded(id);
        uint64 recordedAtBlock = uint64(block.number);
        evidences[id] = Evidence({
            declarant: msg.sender,
            demand: input.demand,
            offer: input.offer,
            side: input.side,
            lot: input.lot,
            asset: input.asset,
            amount: input.amount,
            payee: input.payee,
            paymentDigest: input.paymentDigest,
            validAfter: input.validAfter,
            validBefore: input.validBefore,
            authorityDigest: input.authorityDigest,
            timeWitness: input.timeWitness,
            phase: input.phase,
            verifier: verifier,
            verificationDigest: verificationDigest,
            recordedAtBlock: recordedAtBlock
        });
        emit ConsiderationEvidenceRecorded(
            id,
            input.demand,
            input.offer,
            msg.sender,
            input.side,
            input.lot,
            input.asset,
            input.amount,
            input.payee,
            input.paymentDigest,
            input.validAfter,
            input.validBefore,
            input.authorityDigest,
            input.timeWitness,
            input.phase,
            verifier,
            verificationDigest,
            recordedAtBlock
        );
    }

    function _requireInput(Input calldata input) private view {
        if (input.lot == bytes32(0)) revert EmptyConsiderationField("lot");
        if (input.asset == bytes32(0)) revert EmptyConsiderationField("asset");
        if (input.amount == 0) revert InvalidAmount();
        if (input.payee == address(0)) revert EmptyConsiderationField("payee");
        if (input.paymentDigest == bytes32(0)) {
            revert EmptyConsiderationField("paymentDigest");
        }
        if (input.authorityDigest == bytes32(0)) {
            revert EmptyConsiderationField("authorityDigest");
        }
        if (!timeWitnesses.witnessExists(input.timeWitness)) {
            revert TimeWitnessNotRecorded(input.timeWitness);
        }
        if (input.validBefore <= input.validAfter) {
            revert InvalidValidity(input.validAfter, input.validBefore);
        }
    }

    function _requirePurchasedCounterparty(bytes32 demand, bytes32 offer, address caller)
        private
        view
    {
        (address raiser,,, bytes32 claimant,) = exchange.demands(demand);
        (bytes32 offeredDemand, bytes32 cell) = exchange.offers(offer);
        (address controller,,) = exchange.cells(cell);
        if (
            raiser == address(0) || offeredDemand != demand || claimant == bytes32(0)
                || claimant != cell
        ) revert PurchaseJoinMissing(demand, offer);
        if (caller != raiser && caller != controller) revert NotConsiderationCounterparty(caller);
    }
}

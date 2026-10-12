// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Read-only joins exposed by the immutable SemioticExchange v1.
interface ISemioticExchangeV1 {
    function cells(bytes32 cell)
        external
        view
        returns (address controller, bytes32 law, bool retired);

    function demands(bytes32 demand)
        external
        view
        returns (
            address raiser,
            bytes32 grounding,
            bytes32 wantedLaw,
            bytes32 claimant,
            bytes32 result
        );

    function offers(bytes32 offer) external view returns (bytes32 demand, bytes32 cell);
}

/// @notice A named verifier's bounded proof face for consideration evidence.
/// @dev Returning true attributes verification only to this verifier. The caller
///      does not thereby become a payment authority for any other settlement.
interface IConsiderationVerifierV1 {
    function verifyConsideration(
        bytes32 registryDomain,
        bytes32 evidencePayloadDigest,
        bytes calldata proof
    ) external view returns (bool verified, bytes32 verificationDigest);
}

interface IActorOfficeBindingRegistryV1 {
    function isActiveControllerBinding(bytes32 binding, address controller)
        external
        view
        returns (bool);
}

/// @notice Read-only face of the canonical Articulating Utterance contract.
interface ICanonicalUtteranceV1 {
    function formed(bytes32 utterance) external view returns (bool);
    function at_(bytes32 utterance, uint8 kind) external view returns (bytes32 mark);
}

interface IConsiderationEvidenceRegistryV1 {
    function evidenceJoin(bytes32 evidence)
        external
        view
        returns (bytes32 demand, bytes32 offer, bool exists);
}

interface ICrossSystemTimeWitnessRegistryV1 {
    function witnessExists(bytes32 witness) external view returns (bool);
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {
    IActorOfficeBindingRegistryV1,
    ICrossSystemTimeWitnessRegistryV1
} from "./GlassSpongeInterfaces.sol";

/// @title GlassPoreRegistryV1
/// @notice GLASS-SPONGE capability-pore endpoint declarations and revocations.
/// @dev SEA — Semantics Energy Arena. SEA has MUD — Modeled Union Dimension —
///      and FOAM — Field of Articulating Models. GLASS-SPONGE — Genet-Language
///      Actuators Simulating Sentient Semiotic Pores Operating Nutrient-Game
///      Exchange — lives on MUD in symbiosis with SHRIMP — SPONGE
///      Holonomy-Repair Inference-Model Player. ECOLOGY is Excitation of
///      Colonies Organizing Language Ontology Game Yield.
///
/// A stable pore is derived from the SKU semantic product identity, capability
/// law, sovereign controller, chain, and registry domain. Endpoint and carrier
/// material are versioned registrations around that stable pore. Events carry
/// the complete truth-order transition needed by an independent ActivityPub
/// knowledge-order projector; an EVM event alone does not realize or publish
/// the ActivityPub face. Registration does not prove endpoint availability or
/// confer authority beyond the controller's declaration. Biomimetic and
/// thermodynamic interpretations remain hypotheses, never authorization law.
contract GlassPoreRegistryV1 {
    struct Pore {
        address controller;
        bytes32 sku;
        bytes32 capabilityLaw;
        bytes32 pore;
        bytes32 endpointDigest;
        bytes32 carrierDigest;
        bytes32 actorOfficeBinding;
        bytes32 timeWitness;
        bytes32 previousPore;
        uint64 version;
        uint64 registeredAtBlock;
        uint64 revokedAtBlock;
        bool revoked;
    }

    IActorOfficeBindingRegistryV1 public immutable identityBindings;
    ICrossSystemTimeWitnessRegistryV1 public immutable timeWitnesses;
    mapping(bytes32 poreRegistration => Pore record) public pores;
    mapping(bytes32 coordinate => bytes32 poreRegistration) public latestPore;

    error InvalidIdentityRegistry(address registry);
    error InvalidTimeWitnessRegistry(address registry);
    error TimeWitnessNotRecorded(bytes32 witness);
    error EmptyPoreField(bytes32 field);
    error InactiveActorOfficeBinding(bytes32 binding, address controller);
    error PoreAlreadyRegistered(bytes32 poreRegistration);
    error PoreNotRegistered(bytes32 poreRegistration);
    error NotPoreController(bytes32 poreRegistration, address caller);
    error PreviousPoreMismatch(bytes32 expected, bytes32 supplied);
    error PreviousPoreActive(bytes32 poreRegistration);
    error PoreAlreadyRevoked(bytes32 poreRegistration);

    event GlassPoreRegistered(
        bytes32 indexed poreRegistration,
        bytes32 indexed pore,
        address indexed controller,
        bytes32 sku,
        bytes32 capabilityLaw,
        bytes32 endpointDigest,
        bytes32 carrierDigest,
        bytes32 actorOfficeBinding,
        bytes32 timeWitness,
        bytes32 previousPore,
        uint64 version,
        uint64 registeredAtBlock
    );

    event GlassPoreRevoked(
        bytes32 indexed poreRegistration,
        bytes32 indexed pore,
        address indexed controller,
        bytes32 sku,
        bytes32 capabilityLaw,
        bytes32 endpointDigest,
        bytes32 carrierDigest,
        bytes32 actorOfficeBinding,
        bytes32 timeWitness,
        bytes32 previousPore,
        uint64 version,
        uint64 registeredAtBlock,
        uint64 revokedAtBlock
    );

    constructor(
        IActorOfficeBindingRegistryV1 identityBindings_,
        ICrossSystemTimeWitnessRegistryV1 timeWitnesses_
    ) {
        if (address(identityBindings_).code.length == 0) {
            revert InvalidIdentityRegistry(address(identityBindings_));
        }
        if (address(timeWitnesses_).code.length == 0) {
            revert InvalidTimeWitnessRegistry(address(timeWitnesses_));
        }
        identityBindings = identityBindings_;
        timeWitnesses = timeWitnesses_;
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode("GlassPoreRegistryV1", block.chainid, address(this)));
    }

    function poreIdentity(address controller, bytes32 sku, bytes32 capabilityLaw)
        public
        view
        returns (bytes32)
    {
        return sha256(
            abi.encode(
                "GlassPoreRegistryV1.pore",
                block.chainid,
                address(this),
                sku,
                capabilityLaw,
                controller
            )
        );
    }

    function poreRegistrationId(
        address controller,
        bytes32 sku,
        bytes32 capabilityLaw,
        bytes32 pore,
        bytes32 endpointDigest,
        bytes32 carrierDigest,
        bytes32 actorOfficeBinding,
        bytes32 timeWitness,
        bytes32 previousPore,
        uint64 version
    ) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                domainSeparator(),
                controller,
                sku,
                capabilityLaw,
                pore,
                endpointDigest,
                carrierDigest,
                actorOfficeBinding,
                timeWitness,
                previousPore,
                version
            )
        );
    }

    function registerPore(
        bytes32 capabilityLaw,
        bytes32 sku,
        bytes32 endpointDigest,
        bytes32 carrierDigest,
        bytes32 actorOfficeBinding,
        bytes32 timeWitness,
        bytes32 previousPore
    ) external returns (bytes32 id) {
        if (capabilityLaw == bytes32(0)) {
            revert EmptyPoreField("capabilityLaw");
        }
        if (sku == bytes32(0)) revert EmptyPoreField("sku");
        if (endpointDigest == bytes32(0)) revert EmptyPoreField("endpointDigest");
        if (carrierDigest == bytes32(0)) revert EmptyPoreField("carrierDigest");
        if (!identityBindings.isActiveControllerBinding(actorOfficeBinding, msg.sender)) {
            revert InactiveActorOfficeBinding(actorOfficeBinding, msg.sender);
        }
        if (!timeWitnesses.witnessExists(timeWitness)) {
            revert TimeWitnessNotRecorded(timeWitness);
        }
        bytes32 pore = poreIdentity(msg.sender, sku, capabilityLaw);
        bytes32 expected = latestPore[pore];
        if (previousPore != expected) revert PreviousPoreMismatch(expected, previousPore);
        uint64 version = 1;
        if (expected != bytes32(0)) {
            Pore storage previous = pores[expected];
            if (!previous.revoked) revert PreviousPoreActive(expected);
            version = previous.version + 1;
        }
        id = poreRegistrationId(
            msg.sender,
            sku,
            capabilityLaw,
            pore,
            endpointDigest,
            carrierDigest,
            actorOfficeBinding,
            timeWitness,
            previousPore,
            version
        );
        if (pores[id].controller != address(0)) revert PoreAlreadyRegistered(id);
        uint64 registeredAtBlock = uint64(block.number);
        pores[id] = Pore({
            controller: msg.sender,
            sku: sku,
            capabilityLaw: capabilityLaw,
            pore: pore,
            endpointDigest: endpointDigest,
            carrierDigest: carrierDigest,
            actorOfficeBinding: actorOfficeBinding,
            timeWitness: timeWitness,
            previousPore: previousPore,
            version: version,
            registeredAtBlock: registeredAtBlock,
            revokedAtBlock: 0,
            revoked: false
        });
        latestPore[pore] = id;
        emit GlassPoreRegistered(
            id,
            pore,
            msg.sender,
            sku,
            capabilityLaw,
            endpointDigest,
            carrierDigest,
            actorOfficeBinding,
            timeWitness,
            previousPore,
            version,
            registeredAtBlock
        );
    }

    function revokePore(bytes32 id) external {
        Pore storage pore = pores[id];
        if (pore.controller == address(0)) revert PoreNotRegistered(id);
        if (pore.controller != msg.sender) revert NotPoreController(id, msg.sender);
        if (pore.revoked) revert PoreAlreadyRevoked(id);
        pore.revoked = true;
        pore.revokedAtBlock = uint64(block.number);
        emit GlassPoreRevoked(
            id,
            pore.pore,
            pore.controller,
            pore.sku,
            pore.capabilityLaw,
            pore.endpointDigest,
            pore.carrierDigest,
            pore.actorOfficeBinding,
            pore.timeWitness,
            pore.previousPore,
            pore.version,
            pore.registeredAtBlock,
            pore.revokedAtBlock
        );
    }

    function isActive(bytes32 id) external view returns (bool) {
        return pores[id].controller != address(0) && !pores[id].revoked;
    }

    function poreOf(bytes32 registration) external view returns (bytes32) {
        return pores[registration].pore;
    }
}

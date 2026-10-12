// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { IActorOfficeBindingRegistryV1 } from "./GlassSpongeInterfaces.sol";

/// @title ActorOfficeBindingRegistryV1
/// @notice Versioned controller declarations joining actor and office identities.
/// @dev The controller is always msg.sender. A binding records what that EVM
///      account declared; it does not invent UCAN, employment, office, issuer,
///      or execution authority and consumers must admit those proofs separately.
contract ActorOfficeBindingRegistryV1 is IActorOfficeBindingRegistryV1 {
    struct Binding {
        address controller;
        bytes32 actor;
        bytes32 office;
        bytes32 carrierDigest;
        bytes32 previousBinding;
        uint64 version;
        uint64 registeredAtBlock;
        uint64 revokedAtBlock;
        bool revoked;
    }

    mapping(bytes32 binding => Binding record) public bindings;
    mapping(bytes32 coordinate => bytes32 binding) public latestBinding;

    error EmptyBindingField(bytes32 field);
    error BindingAlreadyRegistered(bytes32 binding);
    error BindingNotRegistered(bytes32 binding);
    error NotBindingController(bytes32 binding, address caller);
    error PreviousBindingMismatch(bytes32 expected, bytes32 supplied);
    error PreviousBindingActive(bytes32 binding);
    error BindingAlreadyRevoked(bytes32 binding);

    event ActorOfficeBindingRegistered(
        bytes32 indexed binding,
        address indexed controller,
        bytes32 indexed actor,
        bytes32 office,
        bytes32 carrierDigest,
        bytes32 previousBinding,
        uint64 version,
        uint64 registeredAtBlock
    );

    event ActorOfficeBindingRevoked(
        bytes32 indexed binding,
        address indexed controller,
        bytes32 indexed actor,
        bytes32 office,
        bytes32 carrierDigest,
        bytes32 previousBinding,
        uint64 version,
        uint64 registeredAtBlock,
        uint64 revokedAtBlock
    );

    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode("ActorOfficeBindingRegistryV1", block.chainid, address(this)));
    }

    function coordinate(address controller, bytes32 actor, bytes32 office)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(controller, actor, office));
    }

    function bindingId(
        address controller,
        bytes32 actor,
        bytes32 office,
        bytes32 carrierDigest,
        bytes32 previousBinding,
        uint64 version
    ) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                domainSeparator(),
                controller,
                actor,
                office,
                carrierDigest,
                previousBinding,
                version
            )
        );
    }

    function registerBinding(
        bytes32 actor,
        bytes32 office,
        bytes32 carrierDigest,
        bytes32 previousBinding
    ) external returns (bytes32 id) {
        if (actor == bytes32(0)) revert EmptyBindingField("actor");
        if (office == bytes32(0)) revert EmptyBindingField("office");
        if (carrierDigest == bytes32(0)) revert EmptyBindingField("carrierDigest");
        bytes32 key = coordinate(msg.sender, actor, office);
        bytes32 expected = latestBinding[key];
        if (previousBinding != expected) {
            revert PreviousBindingMismatch(expected, previousBinding);
        }
        uint64 version = 1;
        if (expected != bytes32(0)) {
            Binding storage previous = bindings[expected];
            if (!previous.revoked) revert PreviousBindingActive(expected);
            version = previous.version + 1;
        }
        id = bindingId(msg.sender, actor, office, carrierDigest, previousBinding, version);
        if (bindings[id].controller != address(0)) revert BindingAlreadyRegistered(id);
        uint64 registeredAtBlock = uint64(block.number);
        bindings[id] = Binding({
            controller: msg.sender,
            actor: actor,
            office: office,
            carrierDigest: carrierDigest,
            previousBinding: previousBinding,
            version: version,
            registeredAtBlock: registeredAtBlock,
            revokedAtBlock: 0,
            revoked: false
        });
        latestBinding[key] = id;
        emit ActorOfficeBindingRegistered(
            id,
            msg.sender,
            actor,
            office,
            carrierDigest,
            previousBinding,
            version,
            registeredAtBlock
        );
    }

    function revokeBinding(bytes32 id) external {
        Binding storage binding = bindings[id];
        if (binding.controller == address(0)) revert BindingNotRegistered(id);
        if (binding.controller != msg.sender) revert NotBindingController(id, msg.sender);
        if (binding.revoked) revert BindingAlreadyRevoked(id);
        binding.revoked = true;
        binding.revokedAtBlock = uint64(block.number);
        emit ActorOfficeBindingRevoked(
            id,
            binding.controller,
            binding.actor,
            binding.office,
            binding.carrierDigest,
            binding.previousBinding,
            binding.version,
            binding.registeredAtBlock,
            binding.revokedAtBlock
        );
    }

    function isActiveControllerBinding(bytes32 id, address controller)
        external
        view
        returns (bool)
    {
        Binding storage binding = bindings[id];
        return binding.controller == controller && !binding.revoked;
    }
}

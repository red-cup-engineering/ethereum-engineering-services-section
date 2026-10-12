// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { EntryPoint } from "@account-abstraction/contracts/core/EntryPoint.sol";

import { EnterpriseAccount, EnterpriseAccountFactory } from "../src/EnterpriseAccount.sol";
import { X402ExactSettlementAssetV2 } from "../src/X402ExactSettlementAssetV2.sol";

interface X402AssetVm {
    function addr(uint256 privateKey) external returns (address);
    function sign(uint256 privateKey, bytes32 digest)
        external
        returns (uint8 v, bytes32 r, bytes32 s);
    function prank(address caller) external;
    function warp(uint256 timestamp) external;
    function expectRevert(bytes calldata revertData) external;
    function expectEmit(
        bool checkTopic1,
        bool checkTopic2,
        bool checkTopic3,
        bool checkData,
        address emitter
    ) external;
}

contract X402ExactSettlementAssetV2Test {
    X402AssetVm private constant vm =
        X402AssetVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 private constant POLICY_KEY = 0xA11CE;
    uint256 private constant FOREIGN_KEY = 0xB0B;
    uint256 private constant SUPPLY = 1_000_000;

    EnterpriseAccount private payer;
    X402ExactSettlementAssetV2 private asset;
    address private payee = address(0xBEEF);
    address private facilitator = address(0xFAC1);

    event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce);
    event Transfer(address indexed from, address indexed to, uint256 value);
    event AuthorizationTransferExecuted(
        bytes32 indexed authorizationDigest,
        address indexed authorizer,
        address indexed recipient,
        bytes32 nonce,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        address submitter,
        bytes32 signatureHash
    );

    function setUp() public {
        vm.warp(1_000_000);
        EntryPoint entryPoint = new EntryPoint();
        EnterpriseAccountFactory factory = new EnterpriseAccountFactory(entryPoint);
        payer = factory.deploy(
            keccak256("urn:ame:x402-payer"), vm.addr(POLICY_KEY), bytes32("x402-v2")
        );
        asset = new X402ExactSettlementAssetV2(
            "Test Exact Asset", "TEA", "2", 6, address(payer), SUPPLY
        );
    }

    function testConstructorPublishesExplicitTermsAndFixedInitialSupply() public view {
        require(keccak256(bytes(asset.name())) == keccak256("Test Exact Asset"), "name drift");
        require(keccak256(bytes(asset.symbol())) == keccak256("TEA"), "symbol drift");
        require(keccak256(bytes(asset.version())) == keccak256("2"), "version drift");
        require(asset.decimals() == 6, "decimals drift");
        require(asset.totalSupply() == SUPPLY, "supply drift");
        require(asset.balanceOf(address(payer)) == SUPPLY, "initial holder drift");
    }

    function testExactV2BytesOverloadSettlesFromEnterpriseAccountViaErc1271() public {
        uint256 value = 12_345;
        uint256 validAfter = block.timestamp - 1;
        uint256 validBefore = block.timestamp + 60;
        bytes32 nonce = keccak256("bytes-overload");
        bytes32 digest = asset.authorizationDigest(
            address(payer), payee, value, validAfter, validBefore, nonce
        );
        bytes memory signature = _sign(POLICY_KEY, digest);

        vm.expectEmit(true, true, false, true, address(asset));
        emit AuthorizationUsed(address(payer), nonce);
        vm.expectEmit(true, true, false, true, address(asset));
        emit Transfer(address(payer), payee, value);
        vm.expectEmit(true, true, true, true, address(asset));
        emit AuthorizationTransferExecuted(
            digest,
            address(payer),
            payee,
            nonce,
            value,
            validAfter,
            validBefore,
            facilitator,
            keccak256(signature)
        );
        vm.prank(facilitator);
        asset.transferWithAuthorization(
            address(payer), payee, value, validAfter, validBefore, nonce, signature
        );

        require(asset.balanceOf(payee) == value, "payee did not receive direct settlement");
        require(asset.balanceOf(facilitator) == 0, "facilitator took custody");
        require(asset.authorizationState(address(payer), nonce), "nonce not consumed");
    }

    function testExactV2CanonicalOverloadAlsoSettlesForEnterpriseAccount() public {
        uint256 value = 7;
        uint256 validAfter = block.timestamp - 1;
        uint256 validBefore = block.timestamp + 60;
        bytes32 nonce = keccak256("canonical-overload");
        bytes32 digest = asset.authorizationDigest(
            address(payer), payee, value, validAfter, validBefore, nonce
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(POLICY_KEY, digest);

        vm.prank(facilitator);
        asset.transferWithAuthorization(
            address(payer), payee, value, validAfter, validBefore, nonce, v, r, s
        );
        require(asset.balanceOf(payee) == value, "canonical signature did not settle");
    }

    function testAuthorizationCannotReplay() public {
        uint256 validAfter = block.timestamp - 1;
        uint256 validBefore = block.timestamp + 60;
        bytes32 nonce = keccak256("single-use");
        bytes memory signature = _sign(
            POLICY_KEY,
            asset.authorizationDigest(address(payer), payee, 1, validAfter, validBefore, nonce)
        );
        asset.transferWithAuthorization(
            address(payer), payee, 1, validAfter, validBefore, nonce, signature
        );

        vm.expectRevert(
            abi.encodeWithSelector(
                X402ExactSettlementAssetV2.AuthorizationAlreadyUsed.selector, address(payer), nonce
            )
        );
        asset.transferWithAuthorization(
            address(payer), payee, 1, validAfter, validBefore, nonce, signature
        );
    }

    function testForeignPolicySignatureIsRefusedWithoutConsumingNonce() public {
        uint256 validAfter = block.timestamp - 1;
        uint256 validBefore = block.timestamp + 60;
        bytes32 nonce = keccak256("foreign-policy");
        bytes memory signature = _sign(
            FOREIGN_KEY,
            asset.authorizationDigest(address(payer), payee, 1, validAfter, validBefore, nonce)
        );

        vm.expectRevert(
            abi.encodeWithSelector(
                X402ExactSettlementAssetV2.InvalidAuthorizationSigner.selector, address(payer)
            )
        );
        asset.transferWithAuthorization(
            address(payer), payee, 1, validAfter, validBefore, nonce, signature
        );
        require(!asset.authorizationState(address(payer), nonce), "refusal consumed nonce");
    }

    function testValidityWindowIsEnforced() public {
        bytes32 futureNonce = keccak256("future");
        uint256 futureAfter = block.timestamp + 1;
        uint256 futureBefore = block.timestamp + 60;
        vm.expectRevert(
            abi.encodeWithSelector(
                X402ExactSettlementAssetV2.AuthorizationNotYetValid.selector, futureAfter
            )
        );
        asset.transferWithAuthorization(
            address(payer), payee, 1, futureAfter, futureBefore, futureNonce, bytes("ignored")
        );

        bytes32 expiredNonce = keccak256("expired");
        uint256 expiredBefore = block.timestamp;
        vm.expectRevert(
            abi.encodeWithSelector(
                X402ExactSettlementAssetV2.AuthorizationExpired.selector, expiredBefore
            )
        );
        asset.transferWithAuthorization(
            address(payer),
            payee,
            1,
            block.timestamp - 60,
            expiredBefore,
            expiredNonce,
            bytes("ignored")
        );
    }

    function testNoAdministrativeOrPostConstructionMintSurfaceExists() public {
        (bool ownerSuccess,) = address(asset).call(abi.encodeWithSignature("owner()"));
        (bool mintSuccess,) =
            address(asset).call(abi.encodeWithSignature("mint(address,uint256)", payee, 1));
        (bool upgradeSuccess,) = address(asset)
            .call(abi.encodeWithSignature("upgradeToAndCall(address,bytes)", payee, bytes("")));
        require(!ownerSuccess && !mintSuccess && !upgradeSuccess, "mutable authority surface found");
        require(asset.totalSupply() == SUPPLY, "fixed supply changed");
    }

    function _sign(uint256 privateKey, bytes32 digest) private returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }
}

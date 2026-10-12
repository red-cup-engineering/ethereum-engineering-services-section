// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { EntryPoint } from "@account-abstraction/contracts/core/EntryPoint.sol";
import {
    PackedUserOperation
} from "@account-abstraction/contracts/interfaces/PackedUserOperation.sol";

import {
    EnterpriseAccount,
    EnterpriseAccountFactory,
    IEnterpriseAccount
} from "../src/EnterpriseAccount.sol";
import { EnterpriseProvisioningPaymaster } from "../src/EnterpriseProvisioningPaymaster.sol";

interface ProvisioningPaymasterVm {
    function addr(uint256 privateKey) external returns (address);
    function sign(uint256 privateKey, bytes32 digest)
        external
        returns (uint8 v, bytes32 r, bytes32 s);
    function prank(address caller) external;
    function expectRevert(bytes4 selector) external;
}

contract EnterpriseProvisioningPaymasterTest {
    ProvisioningPaymasterVm private constant vm =
        ProvisioningPaymasterVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant SPONSOR_KEY = 0x51504f4e534f52;
    uint256 private constant NEW_POLICY_KEY = 0x4e4557504f4c494359;
    bytes32 private constant LAW = sha256("org.emsenn.evm.provision-enterprise-account.v1");

    EntryPoint private entryPoint;
    EnterpriseAccountFactory private factory;
    EnterpriseAccount private sponsor;
    EnterpriseProvisioningPaymaster private paymaster;

    function setUp() public {
        entryPoint = new EntryPoint();
        factory = new EnterpriseAccountFactory(entryPoint);
        sponsor = factory.deploy(
            keccak256("urn:ame:paymaster-service"), vm.addr(SPONSOR_KEY), bytes32("sponsor")
        );
        paymaster = new EnterpriseProvisioningPaymaster(entryPoint, factory, address(sponsor), LAW);
    }

    function testSponsorIsAnImmutableEnterpriseAccount() public view {
        require(paymaster.sponsorAccount() == address(sponsor), "sponsor account drift");
        require(address(paymaster.factory()) == address(factory), "factory drift");
        require(address(paymaster.entryPoint()) == address(entryPoint), "entry point drift");
        require(paymaster.provisioningLawDigest() == LAW, "law drift");
    }

    function testValidEnterpriseAccountSponsorshipReturnsSuccess() public {
        PackedUserOperation memory userOp = _operation(LAW);
        uint48 validUntil = uint48(block.timestamp + 300);
        uint48 validAfter = uint48(block.timestamp);
        bytes32 digest = paymaster.sponsorshipDigest(userOp, validUntil, validAfter);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SPONSOR_KEY, digest);
        userOp.paymasterAndData = abi.encodePacked(
            userOp.paymasterAndData, abi.encode(validUntil, validAfter, abi.encodePacked(r, s, v))
        );
        vm.prank(address(entryPoint));
        (, uint256 validationData) = paymaster.validatePaymasterUserOp(userOp, bytes32(0), 0);
        require(
            validationData == (uint256(validUntil) << 160) | (uint256(validAfter) << 208),
            "sponsorship failed"
        );
    }

    function testInvalidSponsorSignatureReturnsSignatureFailure() public {
        PackedUserOperation memory userOp = _operation(LAW);
        uint48 validUntil = uint48(block.timestamp + 300);
        uint48 validAfter = uint48(block.timestamp);
        bytes32 digest = paymaster.sponsorshipDigest(userOp, validUntil, validAfter);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(NEW_POLICY_KEY, digest);
        userOp.paymasterAndData = abi.encodePacked(
            userOp.paymasterAndData, abi.encode(validUntil, validAfter, abi.encodePacked(r, s, v))
        );
        vm.prank(address(entryPoint));
        (, uint256 validationData) = paymaster.validatePaymasterUserOp(userOp, bytes32(0), 0);
        require(uint160(validationData) == 1, "invalid signature was admitted");
    }

    function testDifferentLawCannotUseProvisioningSponsorship() public {
        PackedUserOperation memory userOp = _operation(bytes32(uint256(1)));
        vm.expectRevert(EnterpriseProvisioningPaymaster.NotProvisioningOperation.selector);
        vm.prank(address(entryPoint));
        paymaster.validatePaymasterUserOp(userOp, bytes32(0), 0);
    }

    function _operation(bytes32 law) private returns (PackedUserOperation memory userOp) {
        bytes32 enterpriseId = keccak256("urn:ame:new-settlement");
        bytes32 userSalt = keccak256("new-settlement-salt");
        address policySigner = vm.addr(NEW_POLICY_KEY);
        address sender = factory.accountAddress(enterpriseId, policySigner, userSalt);
        IEnterpriseAccount.Call[] memory calls = new IEnterpriseAccount.Call[](1);
        calls[0] = IEnterpriseAccount.Call({ target: address(factory), value: 0, data: hex"" });
        userOp = PackedUserOperation({
            sender: sender,
            nonce: 0,
            initCode: abi.encodePacked(
                address(factory),
                abi.encodeCall(factory.deploy, (enterpriseId, policySigner, userSalt))
            ),
            callData: abi.encodeCall(IEnterpriseAccount.executeRmn, (law, calls)),
            accountGasLimits: bytes32((uint256(400_000) << 128) | uint256(200_000)),
            preVerificationGas: 80_000,
            gasFees: bytes32((uint256(1 gwei) << 128) | uint256(2 gwei)),
            paymasterAndData: abi.encodePacked(address(paymaster), uint128(200_000), uint128(1)),
            signature: hex""
        });
    }
}

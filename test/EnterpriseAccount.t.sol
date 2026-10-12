// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { EntryPoint } from "@account-abstraction/contracts/core/EntryPoint.sol";
import { IAccount } from "@account-abstraction/contracts/interfaces/IAccount.sol";
import {
    PackedUserOperation
} from "@account-abstraction/contracts/interfaces/PackedUserOperation.sol";
import { IERC1271 } from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import { IERC5267 } from "@openzeppelin/contracts/interfaces/IERC5267.sol";
import { IERC1155Receiver } from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import { IERC721Receiver } from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import { IERC165 } from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

import {
    EnterpriseAccount,
    EnterpriseAccountFactory,
    IEnterpriseAccount
} from "../src/EnterpriseAccount.sol";
import { CommittedChuSquareVerifier } from "../src/CommittedChuSquareVerifier.sol";

interface EnterpriseAccountVm {
    function addr(uint256 privateKey) external returns (address);
    function sign(uint256 privateKey, bytes32 digest)
        external
        returns (uint8 v, bytes32 r, bytes32 s);
    function deal(address account, uint256 balance) external;
    function prank(address caller) external;
    function expectRevert() external;
    function expectRevert(bytes4 selector) external;
    function expectRevert(bytes calldata revertData) external;
}

contract EnterpriseCallReceiver {
    uint256 public observed;
    uint256 public observedValue;

    function observe(uint256 value) external payable returns (bytes32) {
        observed = value;
        observedValue = msg.value;
        return keccak256(abi.encode(value, msg.value));
    }
}

contract EnterpriseAccountTest {
    EnterpriseAccountVm private constant vm =
        EnterpriseAccountVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 private constant POLICY_KEY = 0xA11CE;
    uint256 private constant NEXT_POLICY_KEY = 0xB0B;
    uint256 private constant STATE_POLICY_KEY = 0xCAFE;
    bytes32 private constant EFFECT_DIGEST =
        0x46ebc4efa2fceda1111e090a732b3ab5672d409c8a86d05bca07a54d4888ba4e;

    EntryPoint private entryPoint;
    EnterpriseAccountFactory private factory;
    EnterpriseAccount private account;
    EnterpriseCallReceiver private receiver;

    function setUp() public {
        entryPoint = new EntryPoint();
        factory = new EnterpriseAccountFactory(entryPoint);
        account = factory.deploy(
            keccak256("urn:ame:test-enterprise"), vm.addr(POLICY_KEY), bytes32("genesis")
        );
        receiver = new EnterpriseCallReceiver();
    }

    function testFactoryDeploymentIsDeterministicAndRetainsNoAuthority() public {
        bytes32 enterpriseId = keccak256("urn:ame:second-enterprise");
        address signer = address(0xBEEF);
        bytes32 salt = keccak256("second-genesis");
        address predicted = factory.accountAddress(enterpriseId, signer, salt);
        require(predicted.code.length == 0, "counterfactual address already occupied");
        require(account.policySigner() == vm.addr(POLICY_KEY), "factory captured policy");
        require(account.policySigner() != address(factory), "factory is account authority");
        require(address(account.entryPoint()) == address(entryPoint), "EntryPoint binding drift");
    }

    function testAccountPublishesRequiredStandardInterfacesAndProfile() public view {
        require(account.supportsInterface(type(IERC165).interfaceId), "ERC-165 absent");
        require(account.supportsInterface(type(IERC1271).interfaceId), "ERC-1271 absent");
        require(account.supportsInterface(type(IERC5267).interfaceId), "ERC-5267 absent");
        require(account.supportsInterface(type(IERC721Receiver).interfaceId), "ERC-721 absent");
        require(account.supportsInterface(type(IERC1155Receiver).interfaceId), "ERC-1155 absent");
        require(account.supportsInterface(type(IAccount).interfaceId), "ERC-4337 IAccount absent");
        require(
            account.supportsInterface(type(IEnterpriseAccount).interfaceId),
            "enterprise interface absent"
        );
        require(!account.supportsInterface(0xffffffff), "invalid ERC-165 interface admitted");
        require(account.RMN_PROFILE_VERSION() == 3, "RMN profile version drift");
        require(
            account.RMN_PROFILE()
                == 0xeb53fc4f9e460198e87135b38393a1a3f3fa0ca40387c632ad0797905a6059bb,
            "RMN v3 profile digest drift"
        );

        (
            bytes1 fields,
            string memory name,
            string memory version,
            uint256 chainId,
            address verifyingContract,
            bytes32 salt,
            uint256[] memory extensions
        ) = account.eip712Domain();
        require(fields == hex"0f", "EIP-5267 field bitmap drift");
        require(
            keccak256(bytes(name)) == keccak256("Union Sovereign Enterprise Account"),
            "domain name drift"
        );
        require(keccak256(bytes(version)) == keccak256("3"), "domain version drift");
        require(
            chainId == block.chainid && verifyingContract == address(account),
            "domain binding drift"
        );
        require(salt == bytes32(0) && extensions.length == 0, "undeclared domain extension");
    }

    function testErc1271DelegatesSignatureAuthorityToPolicySigner() public {
        bytes32 digest = keccak256("settlement testimony");
        require(
            account.isValidSignature(digest, _sign(POLICY_KEY, digest)) == 0x1626ba7e,
            "valid signature refused"
        );
        require(
            account.isValidSignature(digest, _sign(NEXT_POLICY_KEY, digest)) == 0xffffffff,
            "foreign signature admitted"
        );
    }

    function testInvalidEstimationSignatureStillCompletesRequiredPrefundFlow() public {
        vm.deal(address(account), 1 ether);
        PackedUserOperation memory userOp;
        userOp.sender = address(account);
        userOp.signature = hex"00";
        uint256 beforeBalance = address(entryPoint).balance;
        vm.prank(address(entryPoint));
        uint256 validation = account.validateUserOp(userOp, keccak256("estimate"), 0.25 ether);
        require(validation == 1, "invalid estimation signature admitted");
        require(
            address(entryPoint).balance == beforeBalance + 0.25 ether, "required prefund skipped"
        );
    }

    function testOnlyEntryPointUserOperationCanExecuteRmnEffect() public {
        vm.deal(address(account), 2 ether);
        IEnterpriseAccount.Call[] memory calls = new IEnterpriseAccount.Call[](1);
        calls[0] = IEnterpriseAccount.Call({
            target: address(receiver),
            value: 0.25 ether,
            data: abi.encodeCall(receiver.observe, (42))
        });

        vm.prank(vm.addr(POLICY_KEY));
        vm.expectRevert(
            abi.encodeWithSelector(EnterpriseAccount.NotEntryPoint.selector, vm.addr(POLICY_KEY))
        );
        account.executeRmn(EFFECT_DIGEST, calls);

        PackedUserOperation memory userOp = _signedUserOp(POLICY_KEY, EFFECT_DIGEST, calls);
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = userOp;
        entryPoint.handleOps(ops, payable(address(0xBEEF)));

        require(receiver.observed() == 42, "target call absent");
        require(receiver.observedValue() == 0.25 ether, "value movement absent");
        require(entryPoint.getNonce(address(account), 0) == 1, "EntryPoint nonce absent");

        vm.expectRevert();
        entryPoint.handleOps(ops, payable(address(0xBEEF)));
    }

    function testPolicyRotationItselfRequiresEntryPointUserOperation() public {
        address nextSigner = vm.addr(NEXT_POLICY_KEY);
        vm.prank(vm.addr(POLICY_KEY));
        vm.expectRevert(
            abi.encodeWithSelector(EnterpriseAccount.NotSelf.selector, vm.addr(POLICY_KEY))
        );
        account.setPolicySigner(nextSigner);

        IEnterpriseAccount.Call[] memory calls = new IEnterpriseAccount.Call[](1);
        calls[0] = IEnterpriseAccount.Call({
            target: address(account),
            value: 0,
            data: abi.encodeCall(account.setPolicySigner, (nextSigner))
        });
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = _signedUserOp(POLICY_KEY, sha256("rotate-policy"), calls);
        vm.deal(address(account), 1 ether);
        entryPoint.handleOps(ops, payable(address(0xBEEF)));
        require(account.policySigner() == nextSigner, "policy rotation absent");
    }

    function testTwoEnterpriseAccountsCanCloseAChuSeamAsErc1271Owners() public {
        CommittedChuSquareVerifier verifier = new CommittedChuSquareVerifier();
        EnterpriseAccount stateAccount = factory.deploy(
            keccak256("urn:ame:state-enterprise"),
            vm.addr(STATE_POLICY_KEY),
            bytes32("state-genesis")
        );

        bytes32 sourcePoint = keccak256("source-capability");
        bytes32 targetPoint = keccak256("target-capability");
        bytes32 sourceState = keccak256("source-obligation");
        bytes32 targetState = keccak256("target-obligation");
        bytes32 sourceLeaf = verifier.leafHash(verifier.PROFILE(), sourcePoint, sourceState, 1);
        bytes32 targetLeaf = verifier.leafHash(verifier.PROFILE(), targetPoint, targetState, 1);

        CommittedChuSquareVerifier.Square memory square = CommittedChuSquareVerifier.Square({
            sourceRoot: sourceLeaf,
            targetRoot: targetLeaf,
            sourcePoint: sourcePoint,
            targetPoint: targetPoint,
            targetState: targetState,
            sourceState: sourceState,
            pointOwner: address(account),
            stateOwner: address(stateAccount),
            nonce: 1,
            deadline: block.timestamp + 1 days,
            profile: verifier.PROFILE()
        });
        CommittedChuSquareVerifier.Witness memory witness = CommittedChuSquareVerifier.Witness({
            sourceCharge: 1,
            targetCharge: 1,
            sourceProof: new bytes32[](0),
            targetProof: new bytes32[](0)
        });

        bytes32 id = verifier.closeSquare(
            square,
            witness,
            _sign(POLICY_KEY, verifier.pointHalfTypedDataHash(square)),
            _sign(STATE_POLICY_KEY, verifier.stateHalfTypedDataHash(square))
        );
        require(verifier.isClosed(id), "enterprise-owned Chu seam did not close");
    }

    function _signedUserOp(
        uint256 policyKey,
        bytes32 rmnSemanticDigest,
        IEnterpriseAccount.Call[] memory calls
    ) private returns (PackedUserOperation memory userOp) {
        userOp = PackedUserOperation({
            sender: address(account),
            nonce: entryPoint.getNonce(address(account), 0),
            initCode: bytes(""),
            callData: abi.encodeCall(account.executeRmn, (rmnSemanticDigest, calls)),
            accountGasLimits: bytes32((uint256(1_000_000) << 128) | uint256(1_000_000)),
            preVerificationGas: 100_000,
            gasFees: bytes32((uint256(1 gwei) << 128) | uint256(1 gwei)),
            paymasterAndData: bytes(""),
            signature: bytes("")
        });
        userOp.signature = _sign(policyKey, entryPoint.getUserOpHash(userOp));
    }

    function _sign(uint256 privateKey, bytes32 digest) private returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }
}

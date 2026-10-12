// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { IAccount } from "@account-abstraction/contracts/interfaces/IAccount.sol";
import { IEntryPoint } from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {
    PackedUserOperation
} from "@account-abstraction/contracts/interfaces/PackedUserOperation.sol";
import {
    SIG_VALIDATION_FAILED,
    SIG_VALIDATION_SUCCESS
} from "@account-abstraction/contracts/core/Helpers.sol";
import { IERC1271 } from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import { IERC5267 } from "@openzeppelin/contracts/interfaces/IERC5267.sol";
import { IERC1155Receiver } from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import { IERC721Receiver } from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { SignatureChecker } from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import { IERC165 } from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @notice The only settlement execution face admitted on EVM.
/// @dev A policy signer authorizes ERC-4337 UserOperations but can never execute directly.
interface IEnterpriseAccount is IAccount, IERC1271, IERC5267, IERC721Receiver, IERC1155Receiver {
    struct Call {
        address target;
        uint256 value;
        bytes data;
    }

    function enterpriseId() external view returns (bytes32);
    function policySigner() external view returns (address);
    function entryPoint() external view returns (IEntryPoint);
    function executeRmn(bytes32 rmnSemanticDigest, Call[] calldata calls)
        external
        returns (bytes[] memory results);
    function setPolicySigner(address nextSigner) external;
}

/// @title EnterpriseAccount
/// @notice A sovereign settlement's ERC-4337 account. Every operation enters through the
///         configured EntryPoint and carries the raw SHA-256 digest of its typed RMN effect.
/// @dev The account is deliberately non-upgradeable. Its factory retains no execution,
///      policy, registry, or recovery authority.
contract EnterpriseAccount is IEnterpriseAccount, EIP712 {
    bytes4 private constant ERC1271_MAGIC_VALUE = IERC1271.isValidSignature.selector;
    bytes4 private constant ERC1271_INVALID = 0xffffffff;

    /// @dev Raw SHA-256 commitment to org.emsenn.rmn.core.v3.cddl, represented by
    /// ni:///sha-256;61P8T55GAZjocTWzg5Oho_P6DKQDh8YyrQeXkFpgWbs.
    bytes32 public constant RMN_PROFILE =
        0xeb53fc4f9e460198e87135b38393a1a3f3fa0ca40387c632ad0797905a6059bb;
    uint256 public constant RMN_PROFILE_VERSION = 3;

    bytes32 public immutable enterpriseId;
    IEntryPoint private immutable _entryPoint;
    address public policySigner;

    uint256 private _executionLock = 1;

    error EmptyExecution();
    error InvalidEnterpriseId();
    error InvalidEntryPoint(address entryPoint);
    error InvalidPolicySigner(address signer);
    error MissingRmnSemanticDigest();
    error NotEntryPoint(address caller);
    error NotSelf(address caller);
    error ReentrantExecution();
    error CallFailed(uint256 index, address target, bytes reason);

    event EnterpriseCallExecuted(
        bytes32 indexed enterpriseId,
        bytes32 indexed rmnSemanticDigest,
        uint256 indexed index,
        address target,
        uint256 value,
        bytes32 calldataHash,
        bytes32 resultHash
    );
    event RmnExecutionCompleted(
        bytes32 indexed enterpriseId,
        bytes32 indexed rmnSemanticDigest,
        bytes32 indexed rmnProfile,
        bytes32 callsHash
    );
    event PolicySignerChanged(
        bytes32 indexed enterpriseId, address indexed previousSigner, address indexed nextSigner
    );
    event ValueReceived(bytes32 indexed enterpriseId, address indexed sender, uint256 value);

    modifier onlyEntryPoint() {
        if (msg.sender != address(_entryPoint)) revert NotEntryPoint(msg.sender);
        _;
    }

    modifier onlySelf() {
        if (msg.sender != address(this)) revert NotSelf(msg.sender);
        _;
    }

    constructor(bytes32 enterpriseId_, IEntryPoint entryPoint_, address policySigner_)
        payable
        EIP712("Union Sovereign Enterprise Account", "3")
    {
        if (enterpriseId_ == bytes32(0)) revert InvalidEnterpriseId();
        if (address(entryPoint_) == address(0) || address(entryPoint_).code.length == 0) {
            revert InvalidEntryPoint(address(entryPoint_));
        }
        _requireValidPolicySigner(policySigner_);
        enterpriseId = enterpriseId_;
        _entryPoint = entryPoint_;
        policySigner = policySigner_;
        if (msg.value != 0) emit ValueReceived(enterpriseId_, msg.sender, msg.value);
    }

    receive() external payable {
        emit ValueReceived(enterpriseId, msg.sender, msg.value);
    }

    function entryPoint() public view returns (IEntryPoint) {
        return _entryPoint;
    }

    function getNonce() external view returns (uint256) {
        return _entryPoint.getNonce(address(this), 0);
    }

    /// @inheritdoc IAccount
    function validateUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 missingAccountFunds
    ) external returns (uint256 validationData) {
        if (msg.sender != address(_entryPoint)) {
            revert NotEntryPoint(msg.sender);
        }
        bool signatureValid = userOp.sender == address(this)
            && SignatureChecker.isValidSignatureNow(policySigner, userOpHash, userOp.signature);
        if (missingAccountFunds != 0) {
            (bool paid,) = payable(msg.sender).call{ value: missingAccountFunds }("");
            (paid);
        }
        return signatureValid ? SIG_VALIDATION_SUCCESS : SIG_VALIDATION_FAILED;
    }

    /// @notice Execute one typed RMN effect through the settlement's ERC-4337 EntryPoint.
    /// @dev The UserOperation signature covers the digest and the complete call sequence.
    function executeRmn(bytes32 rmnSemanticDigest, Call[] calldata calls)
        external
        onlyEntryPoint
        returns (bytes[] memory results)
    {
        if (rmnSemanticDigest == bytes32(0)) revert MissingRmnSemanticDigest();
        if (calls.length == 0) revert EmptyExecution();
        if (_executionLock != 1) revert ReentrantExecution();
        _executionLock = 2;

        results = new bytes[](calls.length);
        for (uint256 index = 0; index < calls.length; ++index) {
            Call calldata call = calls[index];
            (bool success, bytes memory result) = call.target.call{ value: call.value }(call.data);
            if (!success) revert CallFailed(index, call.target, result);
            results[index] = result;
            emit EnterpriseCallExecuted(
                enterpriseId,
                rmnSemanticDigest,
                index,
                call.target,
                call.value,
                keccak256(call.data),
                keccak256(result)
            );
        }

        _executionLock = 1;
        emit RmnExecutionCompleted(enterpriseId, rmnSemanticDigest, RMN_PROFILE, _callsHash(calls));
    }

    /// @notice Rotate policy only as an account self-call inside an admitted UserOperation.
    function setPolicySigner(address nextSigner) external onlySelf {
        _requireValidPolicySigner(nextSigner);
        address previousSigner = policySigner;
        policySigner = nextSigner;
        emit PolicySignerChanged(enterpriseId, previousSigner, nextSigner);
    }

    function addDeposit() external payable {
        _entryPoint.depositTo{ value: msg.value }(address(this));
    }

    function withdrawDepositTo(address payable recipient, uint256 amount) external onlySelf {
        _entryPoint.withdrawTo(recipient, amount);
    }

    function getDeposit() external view returns (uint256) {
        return _entryPoint.balanceOf(address(this));
    }

    function isValidSignature(bytes32 hash, bytes calldata signature)
        external
        view
        returns (bytes4 magicValue)
    {
        return SignatureChecker.isValidSignatureNow(policySigner, hash, signature)
            ? ERC1271_MAGIC_VALUE
            : ERC1271_INVALID;
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId != 0xffffffff
            && (interfaceId == type(IERC165).interfaceId
                || interfaceId == type(IERC1271).interfaceId
                || interfaceId == type(IERC5267).interfaceId
                || interfaceId == type(IERC721Receiver).interfaceId
                || interfaceId == type(IERC1155Receiver).interfaceId
                || interfaceId == type(IAccount).interfaceId
                || interfaceId == type(IEnterpriseAccount).interfaceId);
    }

    function onERC721Received(address, address, uint256, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return IERC721Receiver.onERC721Received.selector;
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return IERC1155Receiver.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(
        address,
        address,
        uint256[] calldata,
        uint256[] calldata,
        bytes calldata
    ) external pure returns (bytes4) {
        return IERC1155Receiver.onERC1155BatchReceived.selector;
    }

    function _requireValidPolicySigner(address signer) private view {
        if (signer == address(0) || signer == address(this)) revert InvalidPolicySigner(signer);
    }

    function _callsHash(Call[] calldata calls) private pure returns (bytes32 digest) {
        bytes32[] memory callHashes = new bytes32[](calls.length);
        for (uint256 index = 0; index < calls.length; ++index) {
            callHashes[index] = keccak256(
                abi.encode(calls[index].target, calls[index].value, keccak256(calls[index].data))
            );
        }
        digest = keccak256(abi.encode(callHashes));
    }
}

/// @title EnterpriseAccountFactory
/// @notice Permissionless CREATE2 deployment for immutable ERC-4337 enterprise accounts.
contract EnterpriseAccountFactory {
    IEntryPoint public immutable entryPoint;

    event EnterpriseAccountDeployed(
        bytes32 indexed enterpriseId,
        address indexed account,
        address indexed policySigner,
        bytes32 userSalt
    );

    constructor(IEntryPoint entryPoint_) {
        if (address(entryPoint_) == address(0) || address(entryPoint_).code.length == 0) {
            revert EnterpriseAccount.InvalidEntryPoint(address(entryPoint_));
        }
        entryPoint = entryPoint_;
    }

    function deploymentSalt(bytes32 enterpriseId, address policySigner, bytes32 userSalt)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(enterpriseId, policySigner, userSalt));
    }

    function accountAddress(bytes32 enterpriseId, address policySigner, bytes32 userSalt)
        public
        view
        returns (address)
    {
        bytes32 salt = deploymentSalt(enterpriseId, policySigner, userSalt);
        bytes32 initCodeHash = keccak256(
            abi.encodePacked(
                type(EnterpriseAccount).creationCode,
                abi.encode(enterpriseId, entryPoint, policySigner)
            )
        );
        return address(
            uint160(
                uint256(keccak256(abi.encodePacked(hex"ff", address(this), salt, initCodeHash)))
            )
        );
    }

    function deploy(bytes32 enterpriseId, address policySigner, bytes32 userSalt)
        external
        payable
        returns (EnterpriseAccount account)
    {
        address expected = accountAddress(enterpriseId, policySigner, userSalt);
        if (expected.code.length != 0) return EnterpriseAccount(payable(expected));
        account = new EnterpriseAccount{
            salt: deploymentSalt(enterpriseId, policySigner, userSalt), value: msg.value
        }(
            enterpriseId, entryPoint, policySigner
        );
        assert(address(account) == expected);
        emit EnterpriseAccountDeployed(enterpriseId, expected, policySigner, userSalt);
    }
}

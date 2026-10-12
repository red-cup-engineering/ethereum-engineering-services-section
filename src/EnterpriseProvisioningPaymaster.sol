// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {
    PackedUserOperation
} from "@account-abstraction/contracts/interfaces/PackedUserOperation.sol";
import { IEntryPoint } from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import { IPaymaster } from "@account-abstraction/contracts/interfaces/IPaymaster.sol";
import { UserOperationLib } from "@account-abstraction/contracts/core/UserOperationLib.sol";
import {
    _packValidationData,
    SIG_VALIDATION_FAILED
} from "@account-abstraction/contracts/core/Helpers.sol";
import { IERC1271 } from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import { IERC165 } from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { SignatureChecker } from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

import { EnterpriseAccountFactory, IEnterpriseAccount } from "./EnterpriseAccount.sol";

/// @title EnterpriseProvisioningPaymaster
/// @notice Sponsors only counterfactual EnterpriseAccount deployment operations authorized
///         through one immutable ERC-1271 sponsor settlement.
/// @dev The contract has no owner, registry, mutable policy, withdrawal authority, or EOA face.
contract EnterpriseProvisioningPaymaster is IPaymaster, EIP712 {
    using UserOperationLib for PackedUserOperation;

    uint256 private constant PAYMASTER_DATA_OFFSET = 52;
    bytes32 public constant SPONSORSHIP_TYPEHASH = keccak256(
        "EnterpriseProvisioningSponsorship(address sender,uint256 nonce,bytes32 initCodeHash,bytes32 callDataHash,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes32 paymasterStaticHash,uint48 validUntil,uint48 validAfter)"
    );

    IEntryPoint public immutable entryPoint;
    EnterpriseAccountFactory public immutable factory;
    address public immutable sponsorAccount;
    bytes32 public immutable provisioningLawDigest;

    error InvalidEntryPoint(address entryPoint);
    error InvalidFactory(address factory);
    error InvalidSponsorAccount(address sponsorAccount);
    error InvalidPaymasterEnvelope();
    error NotEntryPoint(address caller);
    error NotProvisioningOperation();
    error PostOperationForbidden();

    constructor(
        IEntryPoint entryPoint_,
        EnterpriseAccountFactory factory_,
        address sponsorAccount_,
        bytes32 provisioningLawDigest_
    ) EIP712("Union Enterprise Provisioning Paymaster", "1") {
        if (address(entryPoint_) == address(0) || address(entryPoint_).code.length == 0) {
            revert InvalidEntryPoint(address(entryPoint_));
        }
        if (address(factory_) == address(0) || address(factory_).code.length == 0) {
            revert InvalidFactory(address(factory_));
        }
        if (
            sponsorAccount_ == address(0) || sponsorAccount_.code.length == 0
                || !IERC165(sponsorAccount_).supportsInterface(type(IERC1271).interfaceId)
        ) revert InvalidSponsorAccount(sponsorAccount_);
        if (provisioningLawDigest_ == bytes32(0)) revert NotProvisioningOperation();
        entryPoint = entryPoint_;
        factory = factory_;
        sponsorAccount = sponsorAccount_;
        provisioningLawDigest = provisioningLawDigest_;
    }

    function sponsorshipDigest(
        PackedUserOperation calldata userOp,
        uint48 validUntil,
        uint48 validAfter
    ) public view returns (bytes32) {
        if (userOp.paymasterAndData.length < PAYMASTER_DATA_OFFSET) {
            revert InvalidPaymasterEnvelope();
        }
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    SPONSORSHIP_TYPEHASH,
                    userOp.sender,
                    userOp.nonce,
                    keccak256(userOp.initCode),
                    keccak256(userOp.callData),
                    userOp.accountGasLimits,
                    userOp.preVerificationGas,
                    userOp.gasFees,
                    keccak256(userOp.paymasterAndData[:PAYMASTER_DATA_OFFSET]),
                    validUntil,
                    validAfter
                )
            )
        );
    }

    function validatePaymasterUserOp(PackedUserOperation calldata userOp, bytes32, uint256)
        external
        view
        returns (bytes memory context, uint256 validationData)
    {
        if (msg.sender != address(entryPoint)) revert NotEntryPoint(msg.sender);
        if (userOp.paymasterAndData.length < PAYMASTER_DATA_OFFSET) {
            revert InvalidPaymasterEnvelope();
        }
        (address requestedPaymaster,,) =
            UserOperationLib.unpackPaymasterStaticFields(userOp.paymasterAndData);
        if (requestedPaymaster != address(this)) revert InvalidPaymasterEnvelope();
        _requireProvisioningOperation(userOp);
        (uint48 validUntil, uint48 validAfter, bytes memory signature) =
            abi.decode(userOp.paymasterAndData[PAYMASTER_DATA_OFFSET:], (uint48, uint48, bytes));
        bool valid = SignatureChecker.isValidSignatureNow(
            sponsorAccount, sponsorshipDigest(userOp, validUntil, validAfter), signature
        );
        return ("", _packValidationData(!valid, validUntil, validAfter));
    }

    function postOp(PostOpMode, bytes calldata, uint256, uint256) external view {
        if (msg.sender != address(entryPoint)) revert NotEntryPoint(msg.sender);
        revert PostOperationForbidden();
    }

    /// @notice Irrevocably supply gas custody to the EntryPoint for this paymaster.
    function deposit() external payable {
        entryPoint.depositTo{ value: msg.value }(address(this));
    }

    /// @notice Irrevocably stake this immutable paymaster for ERC-7562 validation access.
    function addStake(uint32 unstakeDelaySec) external payable {
        entryPoint.addStake{ value: msg.value }(unstakeDelaySec);
    }

    function getDeposit() external view returns (uint256) {
        return entryPoint.balanceOf(address(this));
    }

    function _requireProvisioningOperation(PackedUserOperation calldata userOp) private view {
        if (
            userOp.initCode.length < 24
                || address(bytes20(userOp.initCode[:20])) != address(factory)
        ) {
            revert NotProvisioningOperation();
        }
        bytes calldata factoryData = userOp.initCode[20:];
        if (bytes4(factoryData[:4]) != EnterpriseAccountFactory.deploy.selector) {
            revert NotProvisioningOperation();
        }
        (bytes32 enterpriseId, address policySigner, bytes32 userSalt) =
            abi.decode(factoryData[4:], (bytes32, address, bytes32));
        if (factory.accountAddress(enterpriseId, policySigner, userSalt) != userOp.sender) {
            revert NotProvisioningOperation();
        }
        if (
            userOp.callData.length < 4
                || bytes4(userOp.callData[:4]) != IEnterpriseAccount.executeRmn.selector
        ) {
            revert NotProvisioningOperation();
        }
        (bytes32 lawDigest, IEnterpriseAccount.Call[] memory calls) =
            abi.decode(userOp.callData[4:], (bytes32, IEnterpriseAccount.Call[]));
        if (lawDigest != provisioningLawDigest || calls.length == 0) {
            revert NotProvisioningOperation();
        }
    }
}

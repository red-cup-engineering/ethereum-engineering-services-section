// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { SignatureChecker } from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

/// @title x402 Exact Settlement Asset V2
/// @notice Deployment-neutral, fixed-supply EIP-3009 asset candidate for x402 exact-v2.
/// @dev Supply is created once for the initial holder. The contract has no administrator,
///      post-construction mint, upgrade, pause, seizure, or facilitator custody surface.
///      SignatureChecker admits both EOAs and deployed ERC-1271 accounts, including the
///      sovereign EnterpriseAccount whose policy authority remains behind its EntryPoint.
contract X402ExactSettlementAssetV2 is ERC20, EIP712 {
    bytes32 public constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    uint8 private immutable _assetDecimals;
    string private _assetVersion;
    mapping(address authorizer => mapping(bytes32 nonce => bool used)) private _authorizations;

    error EmptyAssetName();
    error EmptyAssetSymbol();
    error EmptyAssetVersion();
    error EmptyInitialSupply();
    error AuthorizationAlreadyUsed(address authorizer, bytes32 nonce);
    error AuthorizationNotYetValid(uint256 validAfter);
    error AuthorizationExpired(uint256 validBefore);
    error InvalidAuthorizationSigner(address expected);

    /// @notice Standard EIP-3009 replay evidence, indexed by authorizer and nonce.
    event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce);

    /// @notice Complete authorization execution evidence without publishing signature bytes.
    /// @dev The digest binds chain, contract, asset name/version, and every authorization term.
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

    constructor(
        string memory name_,
        string memory symbol_,
        string memory version_,
        uint8 decimals_,
        address initialHolder_,
        uint256 initialSupply_
    ) ERC20(name_, symbol_) EIP712(name_, version_) {
        if (bytes(name_).length == 0) revert EmptyAssetName();
        if (bytes(symbol_).length == 0) revert EmptyAssetSymbol();
        if (bytes(version_).length == 0) revert EmptyAssetVersion();
        if (initialSupply_ == 0) revert EmptyInitialSupply();
        _assetVersion = version_;
        _assetDecimals = decimals_;
        _mint(initialHolder_, initialSupply_);
    }

    function decimals() public view override returns (uint8) {
        return _assetDecimals;
    }

    /// @notice EIP-712 domain version consumed by the x402 exact-v2 facilitator.
    function version() external view returns (string memory) {
        return _assetVersion;
    }

    /// @notice Whether an authorization nonce has already settled for an authorizer.
    function authorizationState(address authorizer, bytes32 nonce) external view returns (bool) {
        return _authorizations[authorizer][nonce];
    }

    /// @notice Derive the exact EIP-712 digest authorized by an x402 payer.
    function authorizationDigest(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce
    ) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
                    from,
                    to,
                    value,
                    validAfter,
                    validBefore,
                    nonce
                )
            )
        );
    }

    /// @notice Exact-v2 EIP-3009 entry point for canonical 65-byte signatures.
    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        _transferWithAuthorization(
            from, to, value, validAfter, validBefore, nonce, abi.encodePacked(r, s, v)
        );
    }

    /// @notice Exact-v2 EIP-3009 entry point for ERC-1271 and wrapped signatures.
    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature
    ) external {
        _transferWithAuthorization(from, to, value, validAfter, validBefore, nonce, signature);
    }

    function _transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes memory signature
    ) private {
        if (block.timestamp <= validAfter) {
            revert AuthorizationNotYetValid(validAfter);
        }
        if (block.timestamp >= validBefore) revert AuthorizationExpired(validBefore);
        if (_authorizations[from][nonce]) revert AuthorizationAlreadyUsed(from, nonce);

        bytes32 digest = authorizationDigest(from, to, value, validAfter, validBefore, nonce);
        if (!SignatureChecker.isValidSignatureNow(from, digest, signature)) {
            revert InvalidAuthorizationSigner(from);
        }

        _authorizations[from][nonce] = true;
        emit AuthorizationUsed(from, nonce);
        _transfer(from, to, value);
        emit AuthorizationTransferExecuted(
            digest,
            from,
            to,
            nonce,
            value,
            validAfter,
            validBefore,
            msg.sender,
            keccak256(signature)
        );
    }
}

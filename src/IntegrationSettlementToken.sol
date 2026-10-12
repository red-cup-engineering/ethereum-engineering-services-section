// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { SignatureChecker } from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

/// @title Union Integration Credit
/// @notice Explicitly non-production EIP-3009 settlement material for the settlement
///         trace chain (chain ID supplied at deployment via --network; see
///         bin/deploy-integration-settlement-token.mjs).
/// @dev There is no administrator after construction. The fixed initial supply is
///      minted once to the integration-chain inducer and no further mint exists.
contract IntegrationSettlementToken is ERC20, EIP712 {
    bytes32 public constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    mapping(address authorizer => mapping(bytes32 nonce => bool used)) private authorizations;

    error AuthorizationAlreadyUsed(address authorizer, bytes32 nonce);
    error AuthorizationNotYetValid(uint256 validAfter);
    error AuthorizationExpired(uint256 validBefore);
    error InvalidAuthorizationSigner(address expected);

    event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce);

    constructor(address initialHolder, uint256 initialSupply)
        ERC20("Union Integration Credit", "UIC")
        EIP712("Union Integration Credit", "1")
    {
        _mint(initialHolder, initialSupply);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function version() external pure returns (string memory) {
        return "1";
    }

    function authorizationState(address authorizer, bytes32 nonce) external view returns (bool) {
        return authorizations[authorizer][nonce];
    }

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
        if (authorizations[from][nonce]) revert AuthorizationAlreadyUsed(from, nonce);
        bytes32 digest = _hashTypedDataV4(
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
        if (!SignatureChecker.isValidSignatureNow(from, digest, signature)) {
            revert InvalidAuthorizationSigner(from);
        }
        authorizations[from][nonce] = true;
        emit AuthorizationUsed(from, nonce);
        _transfer(from, to, value);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice A post-execution invariant checker for one private strategy vault.
interface IPrivateStrategyRiskGuard {
    function validate(address vault, bytes32 planDigest, bytes calldata evidence)
        external
        view
        returns (bool);
}

/// @notice A pre-execution argument checker for one allowed target and selector.
interface IPrivateStrategyCallValidator {
    function validate(address vault, address target, uint256 value, bytes calldata data)
        external
        view
        returns (bool);
}

/// @title PrivateStrategyVault
/// @notice Owner-custodied capital with a separately replaceable, tightly bounded operator.
/// @dev This contract has no shares, public deposit accounting, or third-party redemption face.
///      Accidental third-party transfers confer no claim and can only be recovered to the owner.
contract PrivateStrategyVault is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Action {
        address target;
        uint256 value;
        bytes data;
    }

    struct CallRule {
        uint96 maxValuePerCall;
        uint48 activeAt;
        bool enabled;
        IPrivateStrategyCallValidator validator;
    }

    uint256 public immutable policyDelay;
    uint256 public immutable maxActionsPerExecution;
    uint256 public immutable maxNativeValuePerExecution;
    IPrivateStrategyRiskGuard public immutable riskGuard;

    address public operator;
    address public guardian;
    uint256 public nextExecutionNonce;

    mapping(bytes32 ruleId => CallRule rule) public callRules;

    error ActionCallFailed(uint256 index, address target, bytes reason);
    error ActionLimitExceeded(uint256 supplied, uint256 maximum);
    error CalldataTooShort(uint256 index);
    error CallValidatorRejected(bytes32 ruleId);
    error EmptyExecution();
    error InvalidAddress(address value);
    error InvalidConfiguration();
    error InvalidExecutionNonce(uint256 supplied, uint256 expected);
    error InvalidPlanDigest();
    error NativeValueLimitExceeded(uint256 supplied, uint256 maximum);
    error NotGuardianOrOwner(address caller);
    error NotOperator(address caller);
    error PolicyDelayNotElapsed(bytes32 ruleId, uint256 activeAt);
    error RuleNotAllowed(bytes32 ruleId);
    error RiskGuardRejected();
    error VaultMustBePaused();

    event CallRuleActivated(
        bytes32 indexed ruleId, address indexed target, bytes4 indexed selector
    );
    event CallRuleRevoked(bytes32 indexed ruleId, address indexed caller);
    event CallRuleScheduled(
        bytes32 indexed ruleId,
        address indexed target,
        bytes4 indexed selector,
        uint96 maxValuePerCall,
        address validator,
        uint48 activeAt
    );
    event EmergencyErc20Recovered(address indexed token, address indexed owner, uint256 amount);
    event EmergencyNativeRecovered(address indexed owner, uint256 amount);
    event GuardianChanged(address indexed previousGuardian, address indexed nextGuardian);
    event OperatorChanged(address indexed previousOperator, address indexed nextOperator);
    event StrategyActionExecuted(
        bytes32 indexed planDigest,
        uint256 indexed index,
        address indexed target,
        uint256 value,
        bytes4 selector,
        bytes32 calldataHash,
        bytes32 resultHash
    );
    event StrategyExecutionCompleted(
        bytes32 indexed planDigest, address indexed operator, uint256 actionCount
    );

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator(msg.sender);
        _;
    }

    modifier onlyGuardianOrOwner() {
        if (msg.sender != guardian && msg.sender != owner()) {
            revert NotGuardianOrOwner(msg.sender);
        }
        _;
    }

    constructor(
        address initialOwner,
        address initialOperator,
        address initialGuardian,
        IPrivateStrategyRiskGuard riskGuard_,
        uint256 policyDelay_,
        uint256 maxActionsPerExecution_,
        uint256 maxNativeValuePerExecution_
    ) payable Ownable(initialOwner) {
        if (
            initialOwner == address(0) || initialOperator == address(0)
                || initialGuardian == address(0) || address(riskGuard_) == address(0)
        ) revert InvalidAddress(address(0));
        if (
            address(riskGuard_).code.length == 0 || policyDelay_ == 0
                || maxActionsPerExecution_ == 0
        ) revert InvalidConfiguration();

        operator = initialOperator;
        guardian = initialGuardian;
        riskGuard = riskGuard_;
        policyDelay = policyDelay_;
        maxActionsPerExecution = maxActionsPerExecution_;
        maxNativeValuePerExecution = maxNativeValuePerExecution_;
    }

    receive() external payable { }

    function ruleId(address target, bytes4 selector) public pure returns (bytes32) {
        return keccak256(abi.encode(target, selector));
    }

    function scheduleCallRule(
        address target,
        bytes4 selector,
        uint96 maxValuePerCall,
        IPrivateStrategyCallValidator validator
    ) external onlyOwner returns (bytes32 id, uint48 activeAt) {
        if (target == address(0) || target == address(this) || target.code.length == 0) {
            revert InvalidAddress(target);
        }
        if (address(validator) == address(0) || address(validator).code.length == 0) {
            revert InvalidAddress(address(validator));
        }
        if (policyDelay > type(uint48).max - block.timestamp) revert InvalidConfiguration();
        id = ruleId(target, selector);
        activeAt = uint48(block.timestamp + policyDelay);
        callRules[id] = CallRule({
            maxValuePerCall: maxValuePerCall,
            activeAt: activeAt,
            enabled: false,
            validator: validator
        });
        emit CallRuleScheduled(id, target, selector, maxValuePerCall, address(validator), activeAt);
    }

    function activateCallRule(address target, bytes4 selector) external onlyOwner {
        bytes32 id = ruleId(target, selector);
        CallRule storage rule = callRules[id];
        if (rule.activeAt == 0 || block.timestamp < rule.activeAt) {
            revert PolicyDelayNotElapsed(id, rule.activeAt);
        }
        rule.enabled = true;
        emit CallRuleActivated(id, target, selector);
    }

    function revokeCallRule(address target, bytes4 selector) external onlyGuardianOrOwner {
        bytes32 id = ruleId(target, selector);
        delete callRules[id];
        emit CallRuleRevoked(id, msg.sender);
    }

    function setOperator(address nextOperator) external onlyOwner {
        if (nextOperator == address(0) || nextOperator == address(this)) {
            revert InvalidAddress(nextOperator);
        }
        address previous = operator;
        operator = nextOperator;
        emit OperatorChanged(previous, nextOperator);
    }

    function setGuardian(address nextGuardian) external onlyOwner {
        if (nextGuardian == address(0) || nextGuardian == address(this)) {
            revert InvalidAddress(nextGuardian);
        }
        address previous = guardian;
        guardian = nextGuardian;
        emit GuardianChanged(previous, nextGuardian);
    }

    function pause() external onlyGuardianOrOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function hashPlan(uint256 executionNonce, Action[] calldata actions, bytes calldata evidence)
        public
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encode(block.chainid, address(this), executionNonce, actions, keccak256(evidence))
        );
    }

    function execute(
        bytes32 planDigest,
        uint256 executionNonce,
        Action[] calldata actions,
        bytes calldata evidence
    ) external onlyOperator whenNotPaused nonReentrant returns (bytes[] memory results) {
        if (actions.length == 0) revert EmptyExecution();
        if (actions.length > maxActionsPerExecution) {
            revert ActionLimitExceeded(actions.length, maxActionsPerExecution);
        }
        if (executionNonce != nextExecutionNonce) {
            revert InvalidExecutionNonce(executionNonce, nextExecutionNonce);
        }
        if (planDigest == bytes32(0) || planDigest != hashPlan(executionNonce, actions, evidence)) {
            revert InvalidPlanDigest();
        }
        nextExecutionNonce = executionNonce + 1;

        uint256 totalNativeValue;
        results = new bytes[](actions.length);
        for (uint256 index = 0; index < actions.length; ++index) {
            Action calldata action = actions[index];
            if (action.data.length < 4) revert CalldataTooShort(index);
            bytes4 selector = bytes4(action.data[:4]);
            bytes32 id = ruleId(action.target, selector);
            CallRule memory rule = callRules[id];
            if (!rule.enabled || action.value > rule.maxValuePerCall) revert RuleNotAllowed(id);
            if (!rule.validator.validate(address(this), action.target, action.value, action.data)) {
                revert CallValidatorRejected(id);
            }

            totalNativeValue += action.value;
            if (totalNativeValue > maxNativeValuePerExecution) {
                revert NativeValueLimitExceeded(totalNativeValue, maxNativeValuePerExecution);
            }

            (bool success, bytes memory result) =
                action.target.call{ value: action.value }(action.data);
            if (!success) revert ActionCallFailed(index, action.target, result);
            results[index] = result;
            emit StrategyActionExecuted(
                planDigest,
                index,
                action.target,
                action.value,
                selector,
                keccak256(action.data),
                keccak256(result)
            );
        }

        if (!riskGuard.validate(address(this), planDigest, evidence)) {
            revert RiskGuardRejected();
        }
        emit StrategyExecutionCompleted(planDigest, msg.sender, actions.length);
    }

    function emergencyRecoverErc20(IERC20 token, uint256 amount) external onlyOwner nonReentrant {
        if (!paused()) revert VaultMustBePaused();
        token.safeTransfer(owner(), amount);
        emit EmergencyErc20Recovered(address(token), owner(), amount);
    }

    function emergencyRecoverNative(uint256 amount) external onlyOwner nonReentrant {
        if (!paused()) revert VaultMustBePaused();
        address recipient = owner();
        (bool success, bytes memory reason) = payable(recipient).call{ value: amount }("");
        if (!success) revert ActionCallFailed(0, recipient, reason);
        emit EmergencyNativeRecovered(recipient, amount);
    }
}

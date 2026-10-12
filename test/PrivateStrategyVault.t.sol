// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import {
    IPrivateStrategyCallValidator,
    IPrivateStrategyRiskGuard,
    PrivateStrategyVault
} from "../src/PrivateStrategyVault.sol";

interface PrivateStrategyVaultVm {
    function deal(address account, uint256 balance) external;
    function expectRevert() external;
    function expectRevert(bytes4 selector) external;
    function expectRevert(bytes calldata revertData) external;
    function prank(address caller) external;
    function warp(uint256 timestamp) external;
}

contract StrategyTarget {
    uint256 public observed;
    uint256 public observedValue;

    function act(uint256 value) external payable returns (uint256) {
        observed = value;
        observedValue = msg.value;
        return value + 1;
    }
}

contract StrategyRiskGuard is IPrivateStrategyRiskGuard {
    bool public accepted = true;
    uint256 public requiredObserved;
    StrategyTarget public immutable target;

    constructor(StrategyTarget target_) {
        target = target_;
    }

    function configure(bool accepted_, uint256 requiredObserved_) external {
        accepted = accepted_;
        requiredObserved = requiredObserved_;
    }

    function validate(address, bytes32, bytes calldata) external view returns (bool) {
        return accepted && target.observed() == requiredObserved;
    }
}

contract StrategyCallValidator is IPrivateStrategyCallValidator {
    bool public accepted = true;
    uint256 public maximumArgument = type(uint256).max;

    function configure(bool accepted_, uint256 maximumArgument_) external {
        accepted = accepted_;
        maximumArgument = maximumArgument_;
    }

    function validate(address, address, uint256, bytes calldata data) external view returns (bool) {
        if (!accepted || data.length != 36) return false;
        return abi.decode(data[4:], (uint256)) <= maximumArgument;
    }
}

contract StrategyToken is ERC20 {
    constructor() ERC20("Strategy Token", "ST") { }

    function mint(address recipient, uint256 amount) external {
        _mint(recipient, amount);
    }
}

contract PrivateStrategyVaultTest {
    PrivateStrategyVaultVm private constant vm =
        PrivateStrategyVaultVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant OWNER = address(0xA11CE);
    address private constant OPERATOR = address(0xB0B);
    address private constant GUARDIAN = address(0xCAFE);
    address private constant FOREIGN = address(0xBAD);
    uint256 private constant POLICY_DELAY = 1 days;
    StrategyTarget private target;
    StrategyRiskGuard private guard;
    StrategyCallValidator private validator;
    PrivateStrategyVault private vault;
    StrategyToken private token;

    function setUp() public {
        target = new StrategyTarget();
        guard = new StrategyRiskGuard(target);
        validator = new StrategyCallValidator();
        vault = new PrivateStrategyVault(
            OWNER, OPERATOR, GUARDIAN, guard, POLICY_DELAY, 4, 0.5 ether
        );
        token = new StrategyToken();
    }

    function testOperatorCannotUseUnscheduledOrImmatureRule() public {
        PrivateStrategyVault.Action[] memory actions = _oneAction(7, 0);
        bytes32 id = vault.ruleId(address(target), target.act.selector);
        bytes32 digest = _plan(actions, "");
        vm.prank(OPERATOR);
        vm.expectRevert(abi.encodeWithSelector(PrivateStrategyVault.RuleNotAllowed.selector, id));
        vault.execute(digest, 0, actions, "");

        vm.prank(OWNER);
        (, uint48 activeAt) =
            vault.scheduleCallRule(address(target), target.act.selector, 0.25 ether, validator);

        vm.prank(OWNER);
        vm.expectRevert(
            abi.encodeWithSelector(
                PrivateStrategyVault.PolicyDelayNotElapsed.selector, id, activeAt
            )
        );
        vault.activateCallRule(address(target), target.act.selector);
    }

    function testActiveRuleAndRiskGuardAdmitBoundedExecution() public {
        _activateRule(0.25 ether);
        guard.configure(true, 42);
        vm.deal(address(vault), 1 ether);

        PrivateStrategyVault.Action[] memory actions = _oneAction(42, 0.2 ether);
        bytes memory evidence = abi.encode("basis-within-band");
        bytes32 digest = _plan(actions, evidence);
        vm.prank(OPERATOR);
        bytes[] memory results = vault.execute(digest, 0, actions, evidence);

        require(target.observed() == 42, "target action absent");
        require(target.observedValue() == 0.2 ether, "native value absent");
        require(abi.decode(results[0], (uint256)) == 43, "result absent");
    }

    function testRejectedPostConditionRevertsWholeExecution() public {
        _activateRule(0);
        guard.configure(false, 0);

        PrivateStrategyVault.Action[] memory actions = _oneAction(99, 0);
        bytes32 digest = _plan(actions, "");
        vm.prank(OPERATOR);
        vm.expectRevert(PrivateStrategyVault.RiskGuardRejected.selector);
        vault.execute(digest, 0, actions, "");

        require(target.observed() == 0, "unsafe action did not roll back");
    }

    function testGuardianCanImmediatelyRevokeAndPauseButCannotRecover() public {
        _activateRule(0);

        vm.prank(GUARDIAN);
        vault.revokeCallRule(address(target), target.act.selector);
        bytes32 id = vault.ruleId(address(target), target.act.selector);
        PrivateStrategyVault.Action[] memory actions = _oneAction(1, 0);
        bytes32 digest = _plan(actions, "");
        vm.prank(OPERATOR);
        vm.expectRevert(abi.encodeWithSelector(PrivateStrategyVault.RuleNotAllowed.selector, id));
        vault.execute(digest, 0, actions, "");

        vm.prank(GUARDIAN);
        vault.pause();
        vm.prank(GUARDIAN);
        vm.expectRevert();
        vault.emergencyRecoverNative(0);
    }

    function testEmergencyRecoveryReturnsOnlyToOwnerAndRequiresPause() public {
        token.mint(address(vault), 5 ether);

        vm.prank(OWNER);
        vm.expectRevert(PrivateStrategyVault.VaultMustBePaused.selector);
        vault.emergencyRecoverErc20(token, 5 ether);

        vm.prank(GUARDIAN);
        vault.pause();
        vm.prank(OWNER);
        vault.emergencyRecoverErc20(token, 5 ether);

        require(token.balanceOf(OWNER) == 5 ether, "owner did not receive recovery");
        require(token.balanceOf(FOREIGN) == 0, "foreign recovery occurred");
    }

    function testPerCallAndPerExecutionNativeCapsBothApply() public {
        _activateRule(0.3 ether);
        vm.deal(address(vault), 1 ether);
        guard.configure(true, 2);

        PrivateStrategyVault.Action[] memory actions = new PrivateStrategyVault.Action[](2);
        actions[0] = _action(1, 0.3 ether);
        actions[1] = _action(2, 0.3 ether);
        bytes32 batchDigest = _plan(actions, "");
        vm.prank(OPERATOR);
        vm.expectRevert(
            abi.encodeWithSelector(
                PrivateStrategyVault.NativeValueLimitExceeded.selector, 0.6 ether, 0.5 ether
            )
        );
        vault.execute(batchDigest, 0, actions, "");

        actions[0] = _action(1, 0.31 ether);
        PrivateStrategyVault.Action[] memory one = new PrivateStrategyVault.Action[](1);
        one[0] = actions[0];
        bytes32 id = vault.ruleId(address(target), target.act.selector);
        bytes32 oneDigest = _plan(one, "");
        vm.prank(OPERATOR);
        vm.expectRevert(abi.encodeWithSelector(PrivateStrategyVault.RuleNotAllowed.selector, id));
        vault.execute(oneDigest, 0, one, "");
    }

    function testOnlyOperatorExecutesAndOnlyOwnerChangesPolicy() public {
        PrivateStrategyVault.Action[] memory actions = _oneAction(1, 0);
        bytes32 digest = _plan(actions, "");
        vm.prank(FOREIGN);
        vm.expectRevert(abi.encodeWithSelector(PrivateStrategyVault.NotOperator.selector, FOREIGN));
        vault.execute(digest, 0, actions, "");

        vm.prank(FOREIGN);
        vm.expectRevert();
        vault.scheduleCallRule(address(target), target.act.selector, 0, validator);
    }

    function testValidatorRejectsUnsafeArgumentsBeforeCall() public {
        _activateRule(0);
        validator.configure(true, 10);
        PrivateStrategyVault.Action[] memory actions = _oneAction(11, 0);
        bytes32 id = vault.ruleId(address(target), target.act.selector);
        bytes32 digest = _plan(actions, "");

        vm.prank(OPERATOR);
        vm.expectRevert(
            abi.encodeWithSelector(PrivateStrategyVault.CallValidatorRejected.selector, id)
        );
        vault.execute(digest, 0, actions, "");

        require(target.observed() == 0, "rejected action executed");
    }

    function testPlanDigestBindsNonceActionsAndEvidenceAndCannotReplay() public {
        _activateRule(0);
        guard.configure(true, 5);
        PrivateStrategyVault.Action[] memory actions = _oneAction(5, 0);
        bytes memory evidence = abi.encode("headroom-proven");
        bytes32 digest = _plan(actions, evidence);

        vm.prank(OPERATOR);
        vault.execute(digest, 0, actions, evidence);

        vm.prank(OPERATOR);
        vm.expectRevert(
            abi.encodeWithSelector(PrivateStrategyVault.InvalidExecutionNonce.selector, 0, 1)
        );
        vault.execute(digest, 0, actions, evidence);

        vm.prank(OPERATOR);
        vm.expectRevert(PrivateStrategyVault.InvalidPlanDigest.selector);
        vault.execute(digest, 1, actions, evidence);
    }

    function _activateRule(uint96 maxValuePerCall) private {
        vm.prank(OWNER);
        (, uint48 activeAt) = vault.scheduleCallRule(
            address(target), target.act.selector, maxValuePerCall, validator
        );
        vm.warp(activeAt);
        vm.prank(OWNER);
        vault.activateCallRule(address(target), target.act.selector);
    }

    function _plan(PrivateStrategyVault.Action[] memory actions, bytes memory evidence)
        private
        view
        returns (bytes32)
    {
        return vault.hashPlan(vault.nextExecutionNonce(), actions, evidence);
    }

    function _oneAction(uint256 value, uint256 nativeValue)
        private
        view
        returns (PrivateStrategyVault.Action[] memory actions)
    {
        actions = new PrivateStrategyVault.Action[](1);
        actions[0] = _action(value, nativeValue);
    }

    function _action(uint256 value, uint256 nativeValue)
        private
        view
        returns (PrivateStrategyVault.Action memory)
    {
        return PrivateStrategyVault.Action({
            target: address(target), value: nativeValue, data: abi.encodeCall(target.act, (value))
        });
    }
}

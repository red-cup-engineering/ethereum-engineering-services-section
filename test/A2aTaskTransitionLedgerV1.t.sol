// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { IERC1271 } from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import { A2aTaskTransitionLedgerV1 } from "../src/A2aTaskTransitionLedgerV1.sol";

contract TestEnterprise1271 is IERC1271 {
    function isValidSignature(bytes32, bytes calldata signature) external pure returns (bytes4) {
        signature;
        return 0x1626ba7e;
    }
    function task(A2aTaskTransitionLedgerV1 ledger, bytes32 tenant, bytes32 taskId, bytes32 prior, bytes32 carrier) external {
        ledger.appendTaskTransition(tenant, taskId, prior, carrier, "accepted");
    }
    function coordination(A2aTaskTransitionLedgerV1 ledger, bytes32 namespace, bytes32 tenant, bytes32 key, bytes32 prior, bytes32 carrier, bool removed) external {
        ledger.appendCoordinationTransition(namespace, tenant, key, prior, carrier, removed, "accepted");
    }
}

contract A2aTaskTransitionLedgerV1Test {
    A2aTaskTransitionLedgerV1 private ledger;
    TestEnterprise1271 private enterprise;
    bytes32 private constant TENANT = keccak256("tenant");
    bytes32 private constant TASK = keccak256("task");
    bytes32 private constant FIRST = sha256("first canonical RMN carrier");
    bytes32 private constant SECOND = sha256("second canonical RMN carrier");

    function setUp() public { ledger = new A2aTaskTransitionLedgerV1(); enterprise = new TestEnterprise1271(); }

    function testTaskHeadsRequireEnterpriseSignatureAndPriorHeadCas() public {
        enterprise.task(ledger, TENANT, TASK, bytes32(0), FIRST);
        bytes32 coordinate = ledger.taskCoordinate(address(enterprise), TENANT, TASK);
        (bytes32 carrier, uint64 sequence, bool exists) = ledger.taskHeads(coordinate);
        require(carrier == FIRST && sequence == 1 && exists, "first task head missing");

        bool replayRefused;
        try enterprise.task(ledger, TENANT, TASK, bytes32(0), SECOND) { }
        catch { replayRefused = true; }
        require(replayRefused, "task transition ignored its prior head");

        enterprise.task(ledger, TENANT, TASK, FIRST, SECOND);
        (carrier, sequence,) = ledger.taskHeads(coordinate);
        require(carrier == SECOND && sequence == 2, "second task head missing");
    }

    function testCoordinationRemoveIsAnAppendOnlyTransition() public {
        bytes32 namespace = keccak256("dependencies");
        bytes32 key = keccak256("pending-input");
        enterprise.coordination(ledger, namespace, TENANT, key, bytes32(0), FIRST, false);
        enterprise.coordination(ledger, namespace, TENANT, key, FIRST, SECOND, true);
        (bytes32 carrier, uint64 sequence, bool exists) = ledger.coordinationHeads(ledger.coordinationCoordinate(address(enterprise), namespace, TENANT, key));
        require(carrier == SECOND && sequence == 2 && exists, "coordination head missing");
    }
}

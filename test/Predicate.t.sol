// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Mark } from "../src/ArticulatingMark.sol";
import { Utterance } from "../src/ArticulatingUtterance.sol";
import { ArticulationCell } from "../src/ArticulationCell.sol";
import { Predicating } from "../src/Predicating.sol";

interface LadderVm {
    function expectRevert(bytes calldata reason) external;
}

/// Exercises the predicating stage: the arrow admits only the previous rung's
/// codomain, leaves only from the potential corner, and every readout reproduces
/// its Lean lemma.
contract PredicateTest {
    LadderVm private constant vm =
        LadderVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    Mark internal mark;
    Utterance internal utterance;
    ArticulationCell internal cell;
    Predicating internal predicating;

    bytes32 internal subjectCell;
    bytes32 internal predicateCell;
    bytes32 internal objectCell;

    function setUp() public {
        mark = new Mark();
        utterance = new Utterance(mark);
        cell = new ArticulationCell(utterance);
        predicating = new Predicating(cell);
        subjectCell = seatedCell("subject");
        predicateCell = seatedCell("predicate");
        objectCell = seatedCell("object");
        cell.articulateToken(subjectCell);
    }

    function seatedCell(bytes memory surface) internal returns (bytes32 id) {
        bytes32 m = mark.admit(surface);
        id = utterance.form(m, m);
        cell.seat(id);
    }

    function testPredicationIsTheFoldOfItsOrderedTriple() public {
        bytes32 id = predicating.predicate_(subjectCell, predicateCell, objectCell);
        require(
            id == predicating.predicationId(subjectCell, predicateCell, objectCell),
            "predication is not the sha256 fold of its triple"
        );
        require(predicating.generated(id), "predication was not generated");
    }

    function testTheOrderOfTheTripleIsLoadBearing() public {
        bytes32 straight = predicating.predicate_(subjectCell, predicateCell, objectCell);
        bytes32 swapped = predicating.predicate_(subjectCell, objectCell, predicateCell);
        require(straight != swapped, "predicate and object positions are not distinguished");
    }

    function testReadoutsRecoverEachPositionByPosition() public {
        bytes32 id = predicating.predicate_(subjectCell, predicateCell, objectCell);
        require(predicating.subject(id) == subjectCell, "subject readout wrong");
        require(predicating.predicate(id) == predicateCell, "predicate readout wrong");
        require(predicating.object(id) == objectCell, "object readout wrong");
        require(
            predicating.at_(id, Predicating.Position.Subject) == subjectCell, "at_ subject wrong"
        );
        require(
            predicating.at_(id, Predicating.Position.Predicate) == predicateCell,
            "at_ predicate wrong"
        );
        require(predicating.at_(id, Predicating.Position.Object) == objectCell, "at_ object wrong");
    }

    function testPredicatingTakesOnlySeatedCells() public {
        bytes32 unseated = keccak256("never-seated");
        vm.expectRevert(
            abi.encodeWithSelector(Predicating.CellNotSeated.selector, unseated)
        );
        predicating.predicate_(unseated, predicateCell, objectCell);
    }

    function testPredicatingLeavesOnlyFromThePotentialCorner() public {
        cell.articulateClaim(subjectCell);
        vm.expectRevert(
            abi.encodeWithSelector(
                Predicating.SubjectNotPotential.selector,
                subjectCell,
                ArticulationCell.Corner.Stable
            )
        );
        predicating.predicate_(subjectCell, predicateCell, objectCell);
    }

    function testAPredicationIsGeneratedExactlyOnce() public {
        bytes32 id = predicating.predicate_(subjectCell, predicateCell, objectCell);
        vm.expectRevert(
            abi.encodeWithSelector(Predicating.PredicationAlreadyGenerated.selector, id)
        );
        predicating.predicate_(subjectCell, predicateCell, objectCell);
    }

    function testAnUngeneratedPredicationHasNoReadout() public {
        bytes32 id = predicating.predicationId(subjectCell, predicateCell, objectCell);
        vm.expectRevert(
            abi.encodeWithSelector(Predicating.PredicationNotGenerated.selector, id)
        );
        predicating.subject(id);
    }
}

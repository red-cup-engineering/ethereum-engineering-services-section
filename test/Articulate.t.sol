// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Mark } from "../src/ArticulatingMark.sol";
import { Utterance } from "../src/ArticulatingUtterance.sol";
import { Articulating } from "../src/Articulating.sol";
import { ArticulationCell } from "../src/ArticulationCell.sol";

interface LadderVm {
    function expectRevert(bytes calldata reason) external;
}

/// Exercises the articulating stage: composition law: each rung admits only the
/// previous rung's codomain, and every readout reproduces its Lean lemma.
contract ArticulateTest {
    LadderVm private constant vm =
        LadderVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    Mark internal mark;
    Utterance internal utterance;
    Articulating internal articulating;
    ArticulationCell internal cell;

    bytes internal constant SURFACE = "A mark is admitted.";

    function setUp() public {
        mark = new Mark();
        utterance = new Utterance(mark);
        articulating = new Articulating(utterance);
        cell = new ArticulationCell(utterance);
    }

    function admitted() internal returns (bytes32 id) {
        id = mark.admit(SURFACE);
    }

    function formed() internal returns (bytes32 id) {
        bytes32 m = admitted();
        id = utterance.form(m, m);
    }

    function testMarkIsItsSurfacesContentAddress() public {
        bytes32 id = admitted();
        require(id == sha256(SURFACE), "mark id is not sha256 of its surface");
        require(mark.admitted(id), "admitted mark not readable");
        require(id == mark.markId(SURFACE), "markId disagrees with admission");
    }

    function testAMarkAdmitsExactlyOnce() public {
        bytes32 id = admitted();
        vm.expectRevert(abi.encodeWithSelector(Mark.MarkAlreadyAdmitted.selector, id));
        mark.admit(SURFACE);
    }

    function testAnEmptySurfaceIsRefused() public {
        vm.expectRevert(abi.encodeWithSelector(Mark.EmptySurface.selector));
        mark.admit("");
    }

    function testUtteranceTakesOnlyAdmittedMarks() public {
        bytes32 stranger = sha256("never admitted");
        vm.expectRevert(abi.encodeWithSelector(Utterance.MarkNotAdmitted.selector, stranger));
        utterance.form(stranger, stranger);
    }

    function testUtteranceProjectionsReadByPosition() public {
        bytes32 m = admitted();
        bytes32 u = utterance.form(m, m);
        require(u == sha256(abi.encode(m, m)), "utterance id is not the pair fold");
        require(utterance.at_(u, Utterance.Kind.Token) == m, "at_ token projection");
        require(utterance.at_(u, Utterance.Kind.Claim) == m, "at_ claim projection");
    }

    function testArticulatingBottomsOutAtItsFloor() public {
        bytes32 u = formed();
        bytes32 leaf = articulating.utter(u);
        require(articulating.depth(leaf) == 0, "utter leaf has depth zero");
        require(!articulating.moved(leaf), "a bare utterance has not moved");
        bytes32 node = articulating.pair(u, leaf);
        require(articulating.depth(node) == 1, "pair depth is child depth + 1");
        require(articulating.moved(node), "a pair has moved");
        require(articulating.floor(node) == u, "floor is the innermost utterance");
        require(articulating.head(node) == u, "head is the domain projection");
    }

    function testArticulatingTakesOnlyFormedChildren() public {
        bytes32 u = formed();
        bytes32 stranger = sha256("no such articulating");
        vm.expectRevert(
            abi.encodeWithSelector(Articulating.ArticulatingNotFound.selector, stranger)
        );
        articulating.pair(u, stranger);
    }

    function testCellWalksTheNaturalCornerPath() public {
        bytes32 u = formed();
        cell.seat(u);
        require(cell.corner(u) == ArticulationCell.Corner.Absurd, "untold cell is absurd");
        cell.articulateToken(u);
        require(cell.corner(u) == ArticulationCell.Corner.Potential, "told-true cell is potential");
        cell.articulateClaim(u);
        require(cell.corner(u) == ArticulationCell.Corner.Stable, "told-both cell is stable");
        vm.expectRevert(
            abi.encodeWithSelector(ArticulationCell.TokenAlreadyArticulated.selector, u)
        );
        cell.articulateToken(u);
    }

    function testClaimWithoutTokenIsActive() public {
        bytes32 u = formed();
        cell.seat(u);
        cell.articulateClaim(u);
        require(cell.corner(u) == ArticulationCell.Corner.Active, "told-false cell is active");
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { FourMix, FourMixConsensusProfile } from "../src/FourMixConsensusProfile.sol";

contract FourMixConsensusProfileTest {
    FourMixConsensusProfile private profile;

    function setUp() public {
        profile = new FourMixConsensusProfile();
    }

    function charges() internal pure returns (FourMix.Charge[4] memory values) {
        values[0] = FourMix.Charge(false, false);
        values[1] = FourMix.Charge(true, false);
        values[2] = FourMix.Charge(false, true);
        values[3] = FourMix.Charge(true, true);
    }

    function same(FourMix.Charge memory left, FourMix.Charge memory right)
        internal
        pure
        returns (bool)
    {
        return left.positiveEvidence == right.positiveEvidence
            && left.negativeEvidence == right.negativeEvidence;
    }

    function testAllSixteenPairsMatchAxiomFreeLeanTheorem() public view {
        FourMix.Charge[4] memory values = charges();
        for (uint256 leftIndex; leftIndex < values.length; ++leftIndex) {
            for (uint256 rightIndex; rightIndex < values.length; ++rightIndex) {
                FourMix.Charge memory left = values[leftIndex];
                FourMix.Charge memory right = values[rightIndex];
                (
                    FourMix.Charge memory tensorCharge,
                    FourMix.Charge memory parCharge,
                    bool premium,
                    bool consensusRequired,
                    bool laxMixHolds,
                    bool matchesLocus
                ) = profile.assay(left, right);
                bool leftBoth = left.positiveEvidence && left.negativeEvidence;
                bool rightBoth = right.positiveEvidence && right.negativeEvidence;
                bool leftNeither = !left.positiveEvidence && !left.negativeEvidence;
                bool expectedEquality = leftBoth || rightBoth || (same(left, right) && !leftNeither);
                require(laxMixHolds && matchesLocus, "Lean lax-MIX theorem drifted");
                require(
                    same(tensorCharge, parCharge) == expectedEquality, "tensor/par locus mismatch"
                );
                require(
                    premium == !expectedEquality && consensusRequired == premium,
                    "consensus admission drifted"
                );
            }
        }
    }

    function testDirectConflictIsStrictMix() public view {
        FourMix.Charge memory positive = FourMix.Charge(true, false);
        FourMix.Charge memory negative = FourMix.Charge(false, true);
        (
            FourMix.Charge memory tensorCharge,
            FourMix.Charge memory parCharge,
            bool premium,
            bool consensusRequired,,
        ) = profile.assay(positive, negative);
        require(same(tensorCharge, negative), "true tensor false must be false");
        require(same(parCharge, positive), "true par false must be true");
        require(premium && consensusRequired, "direct conflict escaped consensus admission");
    }

    function testCommittedAgreementAndHeldContradictionStayBilateral() public view {
        FourMix.Charge[4] memory values = charges();
        FourMix.Charge memory both = FourMix.Charge(true, true);
        for (uint256 index = 1; index < values.length; ++index) {
            (,, bool premium, bool consensusRequired,,) =
                profile.assay(values[index], values[index]);
            require(!premium && !consensusRequired, "committed agreement bought consensus");
        }
        for (uint256 index; index < values.length; ++index) {
            (,, bool leftPremium,,,) = profile.assay(both, values[index]);
            (,, bool rightPremium,,,) = profile.assay(values[index], both);
            require(!leftPremium && !rightPremium, "held contradiction charged premium");
        }
    }
}

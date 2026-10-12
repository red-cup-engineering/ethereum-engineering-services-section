// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Executable mirror of Obsmetrologia's axiom-free FOUR lax-MIX theorem.
/// @dev FOUR is represented only by its two evidence bits.
library FourMix {
    struct Charge {
        bool positiveEvidence;
        bool negativeEvidence;
    }

    function equal(Charge memory left, Charge memory right) internal pure returns (bool) {
        return left.positiveEvidence == right.positiveEvidence
            && left.negativeEvidence == right.negativeEvidence;
    }

    function negate(Charge memory charge) internal pure returns (Charge memory) {
        return Charge(charge.negativeEvidence, charge.positiveEvidence);
    }

    /// @notice FOUR fusion/tensor: (x∧z, (x→v)∧(z→y)).
    function tensor(Charge memory left, Charge memory right) internal pure returns (Charge memory) {
        return Charge(
            left.positiveEvidence && right.positiveEvidence,
            (!left.positiveEvidence || right.negativeEvidence)
                && (!right.positiveEvidence || left.negativeEvidence)
        );
    }

    /// @notice De Morgan par: ∼(∼a ⊗ ∼b).
    function par(Charge memory left, Charge memory right) internal pure returns (Charge memory) {
        return negate(tensor(negate(left), negate(right)));
    }

    /// @notice Belnap truth order: positive evidence rises; negative evidence falls.
    function truthLe(Charge memory left, Charge memory right) internal pure returns (bool) {
        return (!left.positiveEvidence || right.positiveEvidence)
            && (!right.negativeEvidence || left.negativeEvidence);
    }

    function requiresConsensus(Charge memory left, Charge memory right)
        internal
        pure
        returns (bool)
    {
        return !equal(tensor(left, right), par(left, right));
    }

    /// @notice Exact Lean equality locus used as an independent executable oracle.
    function equalityLocus(Charge memory left, Charge memory right) internal pure returns (bool) {
        bool leftBoth = left.positiveEvidence && left.negativeEvidence;
        bool rightBoth = right.positiveEvidence && right.negativeEvidence;
        bool leftNeither = !left.positiveEvidence && !left.negativeEvidence;
        return leftBoth || rightBoth || (equal(left, right) && !leftNeither);
    }
}

/// @notice Stateless EVM conformance face for local chain-admission decisions.
contract FourMixConsensusProfile {
    bytes32 public constant PROFILE = keccak256("org.emsenn.four.lax-mix-consensus-admission.v2");

    function assay(FourMix.Charge calldata left, FourMix.Charge calldata right)
        external
        pure
        returns (
            FourMix.Charge memory tensorCharge,
            FourMix.Charge memory parCharge,
            bool coordinationPremium,
            bool consensusRequired,
            bool laxMixHolds,
            bool matchesExactEqualityLocus
        )
    {
        tensorCharge = FourMix.tensor(left, right);
        parCharge = FourMix.par(left, right);
        coordinationPremium = !FourMix.equal(tensorCharge, parCharge);
        consensusRequired = coordinationPremium;
        laxMixHolds = FourMix.truthLe(tensorCharge, parCharge);
        matchesExactEqualityLocus = !coordinationPremium == FourMix.equalityLocus(left, right);
    }
}

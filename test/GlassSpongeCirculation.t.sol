// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { ActorOfficeBindingRegistryV1 } from "../src/ActorOfficeBindingRegistryV1.sol";
import { ConsiderationEvidenceRegistryV1 } from "../src/ConsiderationEvidenceRegistryV1.sol";
import { ContentClaimRegistryV1 } from "../src/ContentClaimRegistryV1.sol";
import { CrossSystemTimeWitnessRegistryV1 } from "../src/CrossSystemTimeWitnessRegistryV1.sol";
import { GlassPoreRegistryV1 } from "../src/GlassPoreRegistryV1.sol";
import {
    IActorOfficeBindingRegistryV1,
    ICanonicalUtteranceV1,
    IConsiderationEvidenceRegistryV1,
    IConsiderationVerifierV1,
    ICrossSystemTimeWitnessRegistryV1,
    ISemioticExchangeV1
} from "../src/GlassSpongeInterfaces.sol";
import { OutcomeReceiptRegistryV1 } from "../src/OutcomeReceiptRegistryV1.sol";
import { SemioticExchange } from "../services/semiotic-exchange-chain-services-section/lib/legacy/SemioticExchange.sol";

interface GlassSpongeVm {
    function expectRevert(bytes4 selector) external;
    function expectRevert(bytes calldata reason) external;
    function prank(address caller) external;
}

contract TestConsiderationVerifier is IConsiderationVerifierV1 {
    bool public accepted = true;

    function configure(bool accepted_) external {
        accepted = accepted_;
    }

    function verifyConsideration(
        bytes32 registryDomain,
        bytes32 evidencePayloadDigest,
        bytes calldata proof
    ) external view returns (bool verified, bytes32 verificationDigest) {
        if (!accepted) return (false, bytes32(0));
        return (true, sha256(abi.encode(registryDomain, evidencePayloadDigest, sha256(proof))));
    }
}

contract TestCanonicalUtterance is ICanonicalUtteranceV1 {
    struct Pair {
        bytes32 token;
        bytes32 claim;
        bool exists;
    }

    mapping(bytes32 utterance => Pair pair) private pairs;

    function form(bytes32 token, bytes32 claim) external returns (bytes32 utterance) {
        utterance = sha256(abi.encode(token, claim));
        pairs[utterance] = Pair(token, claim, true);
    }

    function formed(bytes32 utterance) external view returns (bool) {
        return pairs[utterance].exists;
    }

    function at_(bytes32 utterance, uint8 kind) external view returns (bytes32 mark) {
        return kind == 0 ? pairs[utterance].token : pairs[utterance].claim;
    }
}

contract GlassSpongeCirculationTest {
    GlassSpongeVm private constant vm =
        GlassSpongeVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address private constant CUSTOMER = address(0xA11CE);
    address private constant PROVIDER = address(0xB0B);
    address private constant ASSAYER = address(0xA55A7);
    address private constant OUTSIDER = address(0xBAD);

    bytes32 private constant LAW = keccak256("capability-law");
    bytes32 private constant ASSET = keccak256("eip155:5615611/slip44:60");
    bytes32 private constant PAYMENT = keccak256("payment-evidence");

    SemioticExchange private exchange;
    ContentClaimRegistryV1 private claims;
    ActorOfficeBindingRegistryV1 private identities;
    GlassPoreRegistryV1 private pores;
    ConsiderationEvidenceRegistryV1 private consideration;
    OutcomeReceiptRegistryV1 private outcomes;
    TestConsiderationVerifier private verifier;
    TestCanonicalUtterance private utterances;
    CrossSystemTimeWitnessRegistryV1 private timeWitnesses;

    bytes32 private cell;
    bytes32 private demand;
    bytes32 private offer;
    bytes32 private result;
    bytes32 private timeWitness;

    function setUp() public {
        exchange = new SemioticExchange();
        timeWitnesses = new CrossSystemTimeWitnessRegistryV1();
        timeWitness = timeWitnesses.recordWitness(
            keccak256("git-commit"),
            keccak256("federation-position"),
            70,
            keccak256("evm-block-hash"),
            keccak256("evm-transaction-hash"),
            0,
            keccak256("time-witness-carrier")
        );
        utterances = new TestCanonicalUtterance();
        claims = new ContentClaimRegistryV1(
            ICanonicalUtteranceV1(address(utterances)),
            ICrossSystemTimeWitnessRegistryV1(address(timeWitnesses))
        );
        identities = new ActorOfficeBindingRegistryV1();
        pores = new GlassPoreRegistryV1(
            IActorOfficeBindingRegistryV1(address(identities)),
            ICrossSystemTimeWitnessRegistryV1(address(timeWitnesses))
        );
        consideration = new ConsiderationEvidenceRegistryV1(
            ISemioticExchangeV1(address(exchange)),
            ICrossSystemTimeWitnessRegistryV1(address(timeWitnesses))
        );
        outcomes = new OutcomeReceiptRegistryV1(
            ISemioticExchangeV1(address(exchange)),
            IConsiderationEvidenceRegistryV1(address(consideration))
        );
        verifier = new TestConsiderationVerifier();
        _settlePurchase();
    }

    function testClaimsPreserveRootsAcrossAuthorizedRevokedVersions() public {
        bytes32 utterance = _formUtterance("claim");
        vm.prank(CUSTOMER);
        bytes32 first = claims.registerClaim(
            utterance,
            keccak256("provenance-v1"),
            keccak256("dependencies-v1"),
            keccak256("carrier-v1"),
            timeWitness,
            bytes32(0)
        );
        require(claims.isActive(first), "first claim is not active");

        vm.expectRevert(
            abi.encodeWithSelector(
                ContentClaimRegistryV1.NotClaimController.selector, first, OUTSIDER
            )
        );
        vm.prank(OUTSIDER);
        claims.revokeClaim(first);

        vm.prank(CUSTOMER);
        claims.revokeClaim(first);
        require(!claims.isActive(first), "revoked claim remained active");

        vm.prank(CUSTOMER);
        bytes32 second = claims.registerClaim(
            utterance,
            keccak256("provenance-v2"),
            keccak256("dependencies-v2"),
            keccak256("carrier-v2"),
            timeWitness,
            first
        );
        require(second != first, "version replayed claim identity");
        require(claims.latestClaim(CUSTOMER, utterance) == second, "latest claim drift");
    }

    function testClaimReplayAndParallelActiveSuccessorAreRefused() public {
        bytes32 utterance = _formUtterance("claim");
        vm.prank(CUSTOMER);
        bytes32 first = claims.registerClaim(
            utterance,
            keccak256("provenance"),
            keccak256("dependencies"),
            keccak256("carrier"),
            timeWitness,
            bytes32(0)
        );
        vm.expectRevert(
            abi.encodeWithSelector(
                ContentClaimRegistryV1.PreviousClaimMismatch.selector, first, bytes32(0)
            )
        );
        vm.prank(CUSTOMER);
        claims.registerClaim(
            utterance,
            keccak256("provenance"),
            keccak256("dependencies"),
            keccak256("carrier"),
            timeWitness,
            bytes32(0)
        );
    }

    function testActorOfficeBindingAndGlassPoreAreVersionedControllerDeclarations() public {
        bytes32 sku = keccak256("sku:publication");
        bytes32 stablePore = pores.poreIdentity(PROVIDER, sku, LAW);
        vm.prank(PROVIDER);
        bytes32 binding = identities.registerBinding(
            keccak256("urn:ame:provider"),
            keccak256("office:provider"),
            keccak256("identity-carrier"),
            bytes32(0)
        );
        vm.prank(PROVIDER);
        bytes32 firstRegistration = pores.registerPore(
            LAW,
            sku,
            keccak256("https://provider.example/a2a"),
            keccak256("pore-carrier-v1"),
            binding,
            timeWitness,
            bytes32(0)
        );
        require(pores.isActive(firstRegistration), "pore was not registered");
        require(pores.poreOf(firstRegistration) == stablePore, "derived pore identity drift");

        vm.expectRevert(
            abi.encodeWithSelector(
                GlassPoreRegistryV1.NotPoreController.selector, firstRegistration, OUTSIDER
            )
        );
        vm.prank(OUTSIDER);
        pores.revokePore(firstRegistration);

        vm.prank(PROVIDER);
        pores.revokePore(firstRegistration);
        vm.prank(PROVIDER);
        bytes32 successor = pores.registerPore(
            LAW,
            sku,
            keccak256("https://provider.example/a2a/v2"),
            keccak256("pore-carrier-v2"),
            binding,
            timeWitness,
            firstRegistration
        );
        require(
            successor != firstRegistration && pores.isActive(successor),
            "pore version did not advance"
        );
        require(
            pores.poreOf(successor) == stablePore, "endpoint rotation changed stable pore identity"
        );
    }

    function testPoreIdentityChangesWithSkuLawOrSovereignController() public view {
        bytes32 sku = keccak256("sku:publication");
        bytes32 stablePore = pores.poreIdentity(PROVIDER, sku, LAW);
        require(
            stablePore != pores.poreIdentity(PROVIDER, keccak256("sku:other"), LAW),
            "SKU did not separate pore identity"
        );
        require(
            stablePore != pores.poreIdentity(PROVIDER, sku, keccak256("other-law")),
            "capability law did not separate pore identity"
        );
        require(
            stablePore != pores.poreIdentity(OUTSIDER, sku, LAW),
            "sovereign controller did not separate pore identity"
        );
    }

    function testPoreCannotBorrowOrUseRevokedActorOfficeBinding() public {
        vm.prank(PROVIDER);
        bytes32 binding = identities.registerBinding(
            keccak256("urn:ame:provider"),
            keccak256("office:provider"),
            keccak256("identity-carrier"),
            bytes32(0)
        );
        vm.expectRevert(
            abi.encodeWithSelector(
                GlassPoreRegistryV1.InactiveActorOfficeBinding.selector, binding, OUTSIDER
            )
        );
        vm.prank(OUTSIDER);
        pores.registerPore(
            LAW,
            keccak256("pore"),
            keccak256("endpoint"),
            keccak256("carrier"),
            binding,
            timeWitness,
            bytes32(0)
        );
        vm.prank(PROVIDER);
        identities.revokeBinding(binding);
        vm.expectRevert(
            abi.encodeWithSelector(
                GlassPoreRegistryV1.InactiveActorOfficeBinding.selector, binding, PROVIDER
            )
        );
        vm.prank(PROVIDER);
        pores.registerPore(
            LAW,
            keccak256("pore"),
            keccak256("endpoint"),
            keccak256("carrier"),
            binding,
            timeWitness,
            bytes32(0)
        );
    }

    function testDeclaredConsiderationDoesNotClaimVerificationAndCannotReplay() public {
        vm.prank(CUSTOMER);
        ConsiderationEvidenceRegistryV1.Input memory input =
            _consideration(PAYMENT, ConsiderationEvidenceRegistryV1.Phase.Authorized);
        bytes32 evidence = consideration.recordDeclared(input);
        require(!consideration.isNamedVerifierEvidence(evidence), "declaration became verification");
        vm.expectRevert(
            abi.encodeWithSelector(
                ConsiderationEvidenceRegistryV1.EvidenceAlreadyRecorded.selector, evidence
            )
        );
        vm.prank(CUSTOMER);
        consideration.recordDeclared(input);
        vm.expectRevert(
            abi.encodeWithSelector(
                ConsiderationEvidenceRegistryV1.NotConsiderationCounterparty.selector, OUTSIDER
            )
        );
        vm.prank(OUTSIDER);
        consideration.recordDeclared(
            _consideration(
                keccak256("outsider-payment"), ConsiderationEvidenceRegistryV1.Phase.Settled
            )
        );
    }

    function testNamedVerifierMustActuallyVerifyConsideration() public {
        verifier.configure(false);
        vm.expectRevert(
            abi.encodeWithSelector(
                ConsiderationEvidenceRegistryV1.ConsiderationNotVerified.selector, address(verifier)
            )
        );
        vm.prank(CUSTOMER);
        ConsiderationEvidenceRegistryV1.Input memory input =
            _consideration(PAYMENT, ConsiderationEvidenceRegistryV1.Phase.Settled);
        consideration.recordVerified(input, verifier, hex"0102");
        verifier.configure(true);
        vm.prank(CUSTOMER);
        bytes32 evidence = consideration.recordVerified(input, verifier, hex"0102");
        require(consideration.isNamedVerifierEvidence(evidence), "verifier provenance absent");
    }

    function testDeliveryAssayAcceptanceCompletionPaymentAndReceiptStayDistinct() public {
        vm.prank(PROVIDER);
        bytes32 delivery = outcomes.recordDelivery(
            demand, offer, result, keccak256("delivery"), keccak256("delivery-receipt")
        );
        vm.prank(ASSAYER);
        bytes32 assay = outcomes.recordAssay(
            demand, offer, result, keccak256("assay"), keccak256("assay-receipt")
        );
        vm.prank(CUSTOMER);
        bytes32 outcome = outcomes.recordCustomerOutcome(
            demand,
            offer,
            result,
            assay,
            OutcomeReceiptRegistryV1.CustomerDisposition.Accepted,
            keccak256("accepted"),
            keccak256("customer-outcome-receipt")
        );
        vm.prank(CUSTOMER);
        bytes32 completion = outcomes.recordCompletion(
            demand,
            offer,
            result,
            delivery,
            outcome,
            keccak256("completion"),
            keccak256("completion-receipt")
        );
        vm.prank(CUSTOMER);
        bytes32 payment = consideration.recordDeclared(
            _consideration(PAYMENT, ConsiderationEvidenceRegistryV1.Phase.Settled)
        );
        vm.prank(CUSTOMER);
        bytes32 receipt = outcomes.recordCirculationReceipt(
            demand,
            offer,
            result,
            delivery,
            assay,
            outcome,
            completion,
            payment,
            keccak256("circulation-receipt")
        );
        require(
            delivery != assay && assay != outcome && outcome != completion && completion != payment
                && payment != receipt,
            "distinct circulation facts collapsed"
        );
    }

    function testDeliveryAndCustomerOutcomeUseTheirOwnExchangeRoles() public {
        vm.expectRevert(
            abi.encodeWithSelector(OutcomeReceiptRegistryV1.NotProvider.selector, CUSTOMER)
        );
        vm.prank(CUSTOMER);
        outcomes.recordDelivery(
            demand, offer, result, keccak256("delivery"), keccak256("delivery-receipt")
        );
        vm.prank(ASSAYER);
        bytes32 assay = outcomes.recordAssay(
            demand, offer, result, keccak256("assay"), keccak256("assay-receipt")
        );
        vm.expectRevert(
            abi.encodeWithSelector(OutcomeReceiptRegistryV1.NotCustomer.selector, PROVIDER)
        );
        vm.prank(PROVIDER);
        outcomes.recordCustomerOutcome(
            demand,
            offer,
            result,
            assay,
            OutcomeReceiptRegistryV1.CustomerDisposition.Accepted,
            keccak256("accepted"),
            keccak256("customer-outcome-receipt")
        );
    }

    function testRejectedCustomerOutcomeCannotBecomeCompletion() public {
        vm.prank(PROVIDER);
        bytes32 delivery = outcomes.recordDelivery(
            demand, offer, result, keccak256("delivery"), keccak256("delivery-receipt")
        );
        vm.prank(ASSAYER);
        bytes32 assay = outcomes.recordAssay(
            demand, offer, result, keccak256("assay"), keccak256("assay-receipt")
        );
        vm.prank(CUSTOMER);
        bytes32 rejected = outcomes.recordCustomerOutcome(
            demand,
            offer,
            result,
            assay,
            OutcomeReceiptRegistryV1.CustomerDisposition.Rejected,
            keccak256("rejected"),
            keccak256("customer-outcome-receipt")
        );
        vm.expectRevert(
            abi.encodeWithSelector(
                OutcomeReceiptRegistryV1.RejectedOutcomeCannotComplete.selector, rejected
            )
        );
        vm.prank(CUSTOMER);
        outcomes.recordCompletion(
            demand,
            offer,
            result,
            delivery,
            rejected,
            keccak256("completion"),
            keccak256("completion-receipt")
        );
    }

    function testRegistryAddressSeparatesOtherwiseIdenticalClaimIds() public {
        ContentClaimRegistryV1 other = new ContentClaimRegistryV1(
            ICanonicalUtteranceV1(address(utterances)),
            ICrossSystemTimeWitnessRegistryV1(address(timeWitnesses))
        );
        bytes32 utterance = _formUtterance("claim");
        vm.prank(CUSTOMER);
        bytes32 first = claims.registerClaim(
            utterance,
            keccak256("provenance"),
            keccak256("dependencies"),
            keccak256("carrier"),
            timeWitness,
            bytes32(0)
        );
        vm.prank(CUSTOMER);
        bytes32 second = other.registerClaim(
            utterance,
            keccak256("provenance"),
            keccak256("dependencies"),
            keccak256("carrier"),
            timeWitness,
            bytes32(0)
        );
        require(first != second, "registry domain was not separated");
    }

    function _settlePurchase() private {
        vm.prank(PROVIDER);
        cell = exchange.seatCell("cell-carrier", LAW);
        vm.prank(CUSTOMER);
        demand = exchange.raiseDemand("demand-carrier", keccak256("grounding"), LAW);
        vm.prank(PROVIDER);
        offer = exchange.offerDemand(demand, cell, "offer-carrier");
        vm.prank(CUSTOMER);
        exchange.purchaseMove(demand, offer);
        vm.prank(PROVIDER);
        exchange.settleDemand(demand, "result-carrier");
        (,,,, result) = exchange.demands(demand);
        require(result == sha256("result-carrier"), "fixture result drift");
    }

    function _formUtterance(string memory label) private returns (bytes32) {
        return utterances.form(
            keccak256(abi.encode(label, "token")), keccak256(abi.encode(label, "claim"))
        );
    }

    function _consideration(bytes32 paymentDigest, ConsiderationEvidenceRegistryV1.Phase phase)
        private
        view
        returns (ConsiderationEvidenceRegistryV1.Input memory)
    {
        return ConsiderationEvidenceRegistryV1.Input({
            demand: demand,
            offer: offer,
            side: ConsiderationEvidenceRegistryV1.Side.Buy,
            lot: keccak256("exact-lot"),
            asset: ASSET,
            amount: 42,
            payee: PROVIDER,
            paymentDigest: paymentDigest,
            validAfter: 1,
            validBefore: type(uint64).max,
            authorityDigest: keccak256("issuer-bound-authority"),
            timeWitness: timeWitness,
            phase: phase
        });
    }
}

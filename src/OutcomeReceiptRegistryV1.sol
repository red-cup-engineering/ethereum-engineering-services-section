// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { IConsiderationEvidenceRegistryV1, ISemioticExchangeV1 } from "./GlassSpongeInterfaces.sol";

/// @title OutcomeReceiptRegistryV1
/// @notice Separate delivery, assay, customer outcome, completion, payment-evidence,
///         and receipt joins for one settled SemioticExchange v1 purchase.
/// @dev Settlement delivery is not customer acceptance; acceptance is not
///      completion; completion is not payment. Each fact has its own identity,
///      issuer, authorization rule, event, and replay marker.
contract OutcomeReceiptRegistryV1 {
    enum CustomerDisposition {
        Accepted,
        Rejected
    }

    struct Delivery {
        address provider;
        bytes32 demand;
        bytes32 offer;
        bytes32 result;
        bytes32 deliveryDigest;
        bytes32 receiptDigest;
        uint64 recordedAtBlock;
    }

    struct Assay {
        address assayer;
        bytes32 demand;
        bytes32 offer;
        bytes32 result;
        bytes32 assayDigest;
        bytes32 receiptDigest;
        uint64 recordedAtBlock;
    }

    struct CustomerOutcome {
        address customer;
        bytes32 demand;
        bytes32 offer;
        bytes32 result;
        bytes32 assay;
        CustomerDisposition disposition;
        bytes32 outcomeDigest;
        bytes32 receiptDigest;
        uint64 recordedAtBlock;
    }

    struct Completion {
        address customer;
        bytes32 demand;
        bytes32 offer;
        bytes32 result;
        bytes32 delivery;
        bytes32 customerOutcome;
        bytes32 completionDigest;
        bytes32 receiptDigest;
        uint64 recordedAtBlock;
    }

    struct CirculationReceipt {
        address issuer;
        bytes32 demand;
        bytes32 offer;
        bytes32 result;
        bytes32 delivery;
        bytes32 assay;
        bytes32 customerOutcome;
        bytes32 completion;
        bytes32 considerationEvidence;
        bytes32 receiptDigest;
        uint64 recordedAtBlock;
    }

    ISemioticExchangeV1 public immutable exchange;
    IConsiderationEvidenceRegistryV1 public immutable consideration;
    mapping(bytes32 delivery => Delivery record) public deliveries;
    mapping(bytes32 assay => Assay record) public assays;
    mapping(bytes32 outcome => CustomerOutcome record) public customerOutcomes;
    mapping(bytes32 completion => Completion record) public completions;
    mapping(bytes32 receipt => CirculationReceipt record) public receipts;

    error InvalidRegistry(address registry);
    error EmptyOutcomeField(bytes32 field);
    error SettledPurchaseJoinMissing(bytes32 demand, bytes32 offer, bytes32 result);
    error NotProvider(address caller);
    error NotCustomer(address caller);
    error RecordAlreadyExists(bytes32 record);
    error JoinedRecordMissing(bytes32 record);
    error JoinedRecordMismatch(bytes32 record);
    error RejectedOutcomeCannotComplete(bytes32 outcome);

    event DeliveryRecorded(
        bytes32 indexed delivery,
        bytes32 indexed demand,
        bytes32 indexed offer,
        address provider,
        bytes32 result,
        bytes32 deliveryDigest,
        bytes32 receiptDigest,
        uint64 recordedAtBlock
    );
    event AssayRecorded(
        bytes32 indexed assay,
        bytes32 indexed demand,
        bytes32 indexed offer,
        address assayer,
        bytes32 result,
        bytes32 assayDigest,
        bytes32 receiptDigest,
        uint64 recordedAtBlock
    );
    event CustomerOutcomeRecorded(
        bytes32 indexed outcome,
        bytes32 indexed demand,
        bytes32 indexed offer,
        address customer,
        bytes32 result,
        bytes32 assay,
        CustomerDisposition disposition,
        bytes32 outcomeDigest,
        bytes32 receiptDigest,
        uint64 recordedAtBlock
    );
    event CompletionRecorded(
        bytes32 indexed completion,
        bytes32 indexed demand,
        bytes32 indexed offer,
        address customer,
        bytes32 result,
        bytes32 delivery,
        bytes32 customerOutcome,
        bytes32 completionDigest,
        bytes32 receiptDigest,
        uint64 recordedAtBlock
    );
    event CirculationReceiptRecorded(
        bytes32 indexed receipt,
        bytes32 indexed demand,
        bytes32 indexed offer,
        address issuer,
        bytes32 result,
        bytes32 delivery,
        bytes32 assay,
        bytes32 customerOutcome,
        bytes32 completion,
        bytes32 considerationEvidence,
        bytes32 receiptDigest,
        uint64 recordedAtBlock
    );

    constructor(ISemioticExchangeV1 exchange_, IConsiderationEvidenceRegistryV1 consideration_) {
        if (address(exchange_).code.length == 0) revert InvalidRegistry(address(exchange_));
        if (address(consideration_).code.length == 0) {
            revert InvalidRegistry(address(consideration_));
        }
        exchange = exchange_;
        consideration = consideration_;
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode("OutcomeReceiptRegistryV1", block.chainid, address(this)));
    }

    function recordDelivery(
        bytes32 demand,
        bytes32 offer,
        bytes32 result,
        bytes32 deliveryDigest,
        bytes32 receiptDigest
    ) external returns (bytes32 id) {
        _requireDigest(deliveryDigest, "deliveryDigest");
        _requireDigest(receiptDigest, "receiptDigest");
        (, address provider) = _settledRoles(demand, offer, result);
        if (msg.sender != provider) revert NotProvider(msg.sender);
        id = keccak256(
            abi.encode(
                domainSeparator(),
                "delivery",
                msg.sender,
                demand,
                offer,
                result,
                deliveryDigest,
                receiptDigest
            )
        );
        if (deliveries[id].provider != address(0)) revert RecordAlreadyExists(id);
        uint64 recordedAtBlock = uint64(block.number);
        deliveries[id] = Delivery(
            msg.sender, demand, offer, result, deliveryDigest, receiptDigest, recordedAtBlock
        );
        emit DeliveryRecorded(
            id, demand, offer, msg.sender, result, deliveryDigest, receiptDigest, recordedAtBlock
        );
    }

    function recordAssay(
        bytes32 demand,
        bytes32 offer,
        bytes32 result,
        bytes32 assayDigest,
        bytes32 receiptDigest
    ) external returns (bytes32 id) {
        _requireDigest(assayDigest, "assayDigest");
        _requireDigest(receiptDigest, "receiptDigest");
        _settledRoles(demand, offer, result);
        id = keccak256(
            abi.encode(
                domainSeparator(),
                "assay",
                msg.sender,
                demand,
                offer,
                result,
                assayDigest,
                receiptDigest
            )
        );
        if (assays[id].assayer != address(0)) revert RecordAlreadyExists(id);
        uint64 recordedAtBlock = uint64(block.number);
        assays[id] =
            Assay(msg.sender, demand, offer, result, assayDigest, receiptDigest, recordedAtBlock);
        emit AssayRecorded(
            id, demand, offer, msg.sender, result, assayDigest, receiptDigest, recordedAtBlock
        );
    }

    function recordCustomerOutcome(
        bytes32 demand,
        bytes32 offer,
        bytes32 result,
        bytes32 assay,
        CustomerDisposition disposition,
        bytes32 outcomeDigest,
        bytes32 receiptDigest
    ) external returns (bytes32 id) {
        _requireDigest(outcomeDigest, "outcomeDigest");
        _requireDigest(receiptDigest, "receiptDigest");
        (address customer,) = _settledRoles(demand, offer, result);
        if (msg.sender != customer) revert NotCustomer(msg.sender);
        _requireAssayJoin(assay, demand, offer, result);
        id = keccak256(
            abi.encode(
                domainSeparator(),
                "customer-outcome",
                msg.sender,
                demand,
                offer,
                result,
                assay,
                disposition,
                outcomeDigest,
                receiptDigest
            )
        );
        if (customerOutcomes[id].customer != address(0)) revert RecordAlreadyExists(id);
        uint64 recordedAtBlock = uint64(block.number);
        customerOutcomes[id] = CustomerOutcome(
            msg.sender,
            demand,
            offer,
            result,
            assay,
            disposition,
            outcomeDigest,
            receiptDigest,
            recordedAtBlock
        );
        emit CustomerOutcomeRecorded(
            id,
            demand,
            offer,
            msg.sender,
            result,
            assay,
            disposition,
            outcomeDigest,
            receiptDigest,
            recordedAtBlock
        );
    }

    function recordCompletion(
        bytes32 demand,
        bytes32 offer,
        bytes32 result,
        bytes32 delivery,
        bytes32 customerOutcome,
        bytes32 completionDigest,
        bytes32 receiptDigest
    ) external returns (bytes32 id) {
        _requireDigest(completionDigest, "completionDigest");
        _requireDigest(receiptDigest, "receiptDigest");
        (address customer,) = _settledRoles(demand, offer, result);
        if (msg.sender != customer) revert NotCustomer(msg.sender);
        _requireDeliveryJoin(delivery, demand, offer, result);
        CustomerOutcome storage outcome = customerOutcomes[customerOutcome];
        if (outcome.customer == address(0)) revert JoinedRecordMissing(customerOutcome);
        if (
            outcome.demand != demand || outcome.offer != offer || outcome.result != result
                || outcome.customer != customer
        ) revert JoinedRecordMismatch(customerOutcome);
        if (outcome.disposition != CustomerDisposition.Accepted) {
            revert RejectedOutcomeCannotComplete(customerOutcome);
        }
        id = keccak256(
            abi.encode(
                domainSeparator(),
                "completion",
                msg.sender,
                demand,
                offer,
                result,
                delivery,
                customerOutcome,
                completionDigest,
                receiptDigest
            )
        );
        if (completions[id].customer != address(0)) revert RecordAlreadyExists(id);
        uint64 recordedAtBlock = uint64(block.number);
        completions[id] = Completion(
            msg.sender,
            demand,
            offer,
            result,
            delivery,
            customerOutcome,
            completionDigest,
            receiptDigest,
            recordedAtBlock
        );
        emit CompletionRecorded(
            id,
            demand,
            offer,
            msg.sender,
            result,
            delivery,
            customerOutcome,
            completionDigest,
            receiptDigest,
            recordedAtBlock
        );
    }

    function recordCirculationReceipt(
        bytes32 demand,
        bytes32 offer,
        bytes32 result,
        bytes32 delivery,
        bytes32 assay,
        bytes32 customerOutcome,
        bytes32 completion,
        bytes32 considerationEvidence,
        bytes32 receiptDigest
    ) external returns (bytes32 id) {
        _requireDigest(receiptDigest, "receiptDigest");
        (address customer,) = _settledRoles(demand, offer, result);
        if (msg.sender != customer) revert NotCustomer(msg.sender);
        _requireDeliveryJoin(delivery, demand, offer, result);
        _requireAssayJoin(assay, demand, offer, result);
        CustomerOutcome storage outcome = customerOutcomes[customerOutcome];
        Completion storage completed = completions[completion];
        if (outcome.customer == address(0)) revert JoinedRecordMissing(customerOutcome);
        if (completed.customer == address(0)) revert JoinedRecordMissing(completion);
        if (
            outcome.demand != demand || outcome.offer != offer || outcome.result != result
                || completed.demand != demand || completed.offer != offer
                || completed.result != result || completed.delivery != delivery
                || completed.customerOutcome != customerOutcome
        ) revert JoinedRecordMismatch(completion);
        (bytes32 paymentDemand, bytes32 paymentOffer, bool paymentExists) =
            consideration.evidenceJoin(considerationEvidence);
        if (!paymentExists) revert JoinedRecordMissing(considerationEvidence);
        if (paymentDemand != demand || paymentOffer != offer) {
            revert JoinedRecordMismatch(considerationEvidence);
        }
        id = keccak256(
            abi.encode(
                domainSeparator(),
                "circulation-receipt",
                msg.sender,
                demand,
                offer,
                result,
                delivery,
                assay,
                customerOutcome,
                completion,
                considerationEvidence,
                receiptDigest
            )
        );
        if (receipts[id].issuer != address(0)) revert RecordAlreadyExists(id);
        uint64 recordedAtBlock = uint64(block.number);
        receipts[id] = CirculationReceipt(
            msg.sender,
            demand,
            offer,
            result,
            delivery,
            assay,
            customerOutcome,
            completion,
            considerationEvidence,
            receiptDigest,
            recordedAtBlock
        );
        emit CirculationReceiptRecorded(
            id,
            demand,
            offer,
            msg.sender,
            result,
            delivery,
            assay,
            customerOutcome,
            completion,
            considerationEvidence,
            receiptDigest,
            recordedAtBlock
        );
    }

    function _settledRoles(bytes32 demand, bytes32 offer, bytes32 result)
        private
        view
        returns (address customer, address provider)
    {
        (address raiser,,, bytes32 claimant, bytes32 settledResult) = exchange.demands(demand);
        (bytes32 offeredDemand, bytes32 cell) = exchange.offers(offer);
        (address controller,,) = exchange.cells(cell);
        if (
            raiser == address(0) || offeredDemand != demand || claimant != cell
                || settledResult == bytes32(0) || settledResult != result
                || controller == address(0)
        ) revert SettledPurchaseJoinMissing(demand, offer, result);
        return (raiser, controller);
    }

    function _requireDeliveryJoin(bytes32 id, bytes32 demand, bytes32 offer, bytes32 result)
        private
        view
    {
        Delivery storage delivery = deliveries[id];
        if (delivery.provider == address(0)) revert JoinedRecordMissing(id);
        if (delivery.demand != demand || delivery.offer != offer || delivery.result != result) {
            revert JoinedRecordMismatch(id);
        }
    }

    function _requireAssayJoin(bytes32 id, bytes32 demand, bytes32 offer, bytes32 result)
        private
        view
    {
        Assay storage assay = assays[id];
        if (assay.assayer == address(0)) revert JoinedRecordMissing(id);
        if (assay.demand != demand || assay.offer != offer || assay.result != result) {
            revert JoinedRecordMismatch(id);
        }
    }

    function _requireDigest(bytes32 value, bytes32 field) private pure {
        if (value == bytes32(0)) revert EmptyOutcomeField(field);
    }
}

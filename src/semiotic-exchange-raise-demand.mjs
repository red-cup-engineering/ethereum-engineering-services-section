import { induceCapabilityRepairDemand } from "@red-cup-engineering/semiotic-exchange-chain-services-section/semiotic-exchange-demand-induction";

/**
 * Node projection of the authoritative `SemioticExchange.raiseDemand` move.
 *
 * Domain: one witnessed capability-repair refusal plus an admitted bounded
 * chain-transition writer. Codomain: either the contract's canonical
 * DemandRaised boundary receipt or an explicit refusal residue. The injected
 * writer belongs to the zero-custody actuator; this projection neither owns
 * keys nor substitutes an off-chain authority for the contract.
 */
export async function raiseCapabilityRepairDemand({ raiser, locus, operation, objective, refusalCode, refusalWitnessNis, requiredStandard, inputNi, transition }) {
  const induced = induceCapabilityRepairDemand({ raiser, locus, operation, objective, refusalCode, refusalWitnessNis, requiredStandard, inputNi });
  if (typeof transition !== "function") return Object.freeze({ disposition: "chain-transition-unavailable", demandNi: induced.demandNi, obstruction: "no admitted zero-custody SemioticExchange transition was supplied" });
  try {
    const settled = await transition(Object.freeze({
      rmnSemanticDigest: induced.demandBytes32,
      transition: Object.freeze({ operation: "raiseDemand", args: induced.raiseDemand.args }),
      demand: induced,
    }));
    const transactionHash = settled?.transactionHash ?? settled?.object?.data?.receipt?.transactionHash;
    const eventReceipt = settled?.eventReceipt ?? settled?.object?.data?.eventReceipt;
    if (!/^0x[0-9a-fA-F]{64}$/u.test(transactionHash ?? "") || eventReceipt?.type !== "SemioticExchangeEventReceipt" || eventReceipt.move !== "DemandRaised" || eventReceipt.demand?.toLowerCase() !== induced.demandBytes32.toLowerCase()) throw new Error("zero-custody transition returned no canonical DemandRaised event receipt");
    return Object.freeze({ disposition: "demand-raised", demandNi: induced.demandNi, transactionHash: transactionHash.toLowerCase(), eventReceipt });
  } catch (error) {
    return Object.freeze({ disposition: "chain-transition-refused", demandNi: induced.demandNi, obstruction: error instanceof Error ? error.message : String(error) });
  }
}

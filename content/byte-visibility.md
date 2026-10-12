# Cycle 1 commuting-square verifier byte inventory

This is a provider-local Foundry/Anvil proof, not a customer installation.
Raw witnesses are consensus-visible calldata and this profile does **not**
claim that consensus contains only residues.

| Carrier | Observed/encoded size | Classification |
| --- | ---: | --- |
| `closeSquare` calldata with one sibling per proof | 964 bytes | allowed limited seam witness, including roots, point/state halves, owners, nonce, deadline, profile, FOUR charges, paths, and two EIP-712 signatures |
| calldata witness subset | variable with proof depth | visible seam witness; a later succinct/ZK profile is required if this disclosure is unacceptable |
| storage | one 32-byte value slot per closed square, encoded as block number plus one | seam-only replay marker; trie/account overhead not counted |
| `SquareClosed` log payload | 128 topic bytes + 160 data bytes | seam-only audit evidence: square id, roots, half digests, profile, zero residue, and block number; receipt/bloom/RLP overhead not counted |
| local data | future customer receipt and EAVT/Datom projection | not emitted by this provider proof; later customer-owned gate |

The exact one-sibling conformance vector emits 964 calldata bytes and observes
41,382 gas around the external close call in the Foundry trace. The Foundry
gas report observed `closeSquare` paths from 45,416 to 72,345 gas and a 715,030
gas deployment. These are local engineering measurements, not transaction-fee
promises or monetary receipts, and gas must not be equated with semantic
erasure.

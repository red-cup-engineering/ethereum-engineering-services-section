# Ethereum Engineering Services Section

Ethereum/EVM chain services under Red Cup Engineering's Blockchain Services
Section — seated so Union enterprises that need EVM/Ethereum capability have
a proper home to offer and consume it from, rather than each hand-rolling
its own.

## Shared core

The account implementation imports the pinned official ERC-4337 contracts and
OpenZeppelin cryptography/interfaces. Local scripts use Foundry's `cast`; this
section carries no second secp256k1 or keccak implementation.

`services/base-pre-sign-policy-service` owns the deterministic evaluation of
unsigned Base transactions against declared policy and immutable anchors. It
is authority-free; public products compose it rather than carrying a private
fork of Base transaction semantics.

## Sovereign enterprise accounts

`EnterpriseAccount.sol` makes the settlement itself an EVM smart account. The
account implements the ERC-4337 `IAccount` face, ERC-165 discovery, ERC-1271
contract signatures, EIP-712/ERC-5267 publication, and safe ERC-721/ERC-1155
receipt. Its policy signer only authorizes UserOperations; only the pinned
EntryPoint can execute. Every execution commits the raw SHA-256 digest of one
typed RMN effect under the account's pinned RMN profile. The CREATE2 factory
owns no registry and retains no authority.

This is deliberately not a shared Union treasury. Every account has exactly
one enterprise identity commitment and its own policy signer. Signer keys,
books, matrices, and unpublished records stay inside that settlement.

The live development-chain territory (chain ID defaulted in
`scripts/run-development-chain.mjs`) binds every operating settlement found by
the enterprise census. Each binding is public inside that settlement;
There is no root keyring, shared policy signer, registry owner, or central CFO.

The off-chain binding profile uses CAIP-2 chain identifiers and CAIP-10 account
identifiers. Each chain binding stays at
`content/evm/accounts/eip155-<chain-id>.json` inside its settlement, so one
enterprise can operate on several independently merged chains. `npm run census:enterprise-wallets` finds every operating package
that declares `x-agentic-metro-enterprise` and reports which settlement-owned
bindings remain absent or invalid. `npm run verify:enterprise-wallets` is the
strict migration gate.

The independently hireable `enterprise-account-provisioning-service` owns the
only supplied binding writer and counterfactual provisioning operation. Before
it creates a local binding, it asks the target chain for the account and factory
bytecode, checks the account's enterprise commitment and policy signer, probes
the required ERC interfaces, recomputes the factory's CREATE2 address, and
verifies the indexed factory event in the deployment transaction. It refuses
to overwrite an existing chain binding.

For an isolated persistent development chain, run `npm run chain:development`.
It defaults to the development chain ID set in `scripts/run-development-chain.mjs`, binds only to localhost, and persists state under
this settlement's `data/state/development-chain-state/`. Chain-standard contracts are
installed by the chain operator. Settlement accounts themselves are deployed
only through ERC-4337, the hired ERC-7677 paymaster service, and the hired
ERC-7769 bundler; there is no unlocked-deployer settlement path.

## First seam verifier

`CommittedChuSquareVerifier.sol` implements the first bounded service profile:
two distinct ERC-4337 enterprise accounts sign complementary
EIP-712 Chu-map halves, disclose one
Merkle-proven FOUR entry from each committed matrix, and close the seam only
when the square commutes. Invalid signatures, commitments, evaluations, and
replays receive exact refusal codes.

This is a provider-local proof candidate, not a customer installation or an
accepted Union standard. Ordinary EVM calldata retains the disclosed leaves,
paths, and signatures, so this profile does **not** claim residue-only
consensus or matrix privacy for seam witnesses. A later succinct-proof profile
is required if the consensus surface must expose only a residue and proof.

Run `npm test` for the local EVM proof and negative controls.

## Effect placement

The typed effect cell is owned by the RMN semantic-conformance provider, not by
this EVM settlement. Git ANT and device I/O now hire that provider and witness
local task/syscall FOUR cover transitions in WitnessJournal. They do not buy consensus
for factorable local work. This EVM service is used only when an effect is a
genuine par seam: shared authority, custody, scarcity, atomic payment, or a
typed inter-settlement residue. There is no JavaScript effect ontology beside
RMN and no chain-every-syscall path.

## Consensus admission is a separate predicate

`FourMixConsensusProfile.sol` mirrors Obsmetrologia's axiom-free FOUR lax-MIX
with explicit `(positiveEvidence, negativeEvidence)` bits and no ordinal carrier.
theorem across the complete 16-pair denominator. It returns a one-bit support
indicator for the coordination premium: agreement and held contradiction stay
bilateral, while uncommitted/frontier pairs and direct true/false conflict are
the exact tensor/par divergence locus.

This does not prove that every divergent pair requires a chain. That is the C5
protocol conjecture. It does prevent this section from conflating “the seam is
valid” with “consensus is worth buying.” The profile is an EVM conformance
mirror pending an independently admitted OSS/RMN semantic service.

## Org

- **Over**: blockchain-services-section
- **Owns**: (no child teams yet)

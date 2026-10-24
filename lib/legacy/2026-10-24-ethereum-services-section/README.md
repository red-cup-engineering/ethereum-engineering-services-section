# Merged from red-cup-engineering/ethereum-services-section (2026-10-24)

`red-cup-engineering/ethereum-services-section` (package
`@red-cup-engineering/ethereum-services-section`, repository head
`0e721198`) was a misnamed duplicate of this section and is archived. This
repository is canonical: its package `@red-cup-engineering/ethereum-engineering-services-section`
has been published since 0.15.0 (2026-09-10), while the old name's last
publish was 0.14.0 (2026-09-08).

Merged live into this repository:

- `src/agent-prediction-market-receipt.mjs`, `test/agent-prediction-market-receipt.test.mjs`
  and the `./agent-prediction-market-receipt` export (finalized prediction-market
  EVM receipt reader; existed only in the old repository).

Kept here, superseded by newer implementations already in this repository:

- `src/articulating-rmn-evm-projection.mjs` (+ test): replaced by `src/articulating-evm-projection.mjs`.
- `src/semiotic-exchange-circulation-index.mjs`, its test, `scripts/serve-semiotic-exchange-rpc.py`
  and `test/test_semiotic_exchange_rpc.py`: the old repository's 2026-10-13 revisions;
  this repository carries the later bounded-read-law revisions at the live paths.

Not merged because already extracted into their own repositories on 2026-10-18/19
(history of this repository holds them): `services/account-abstraction-services-section`
(now `account-abstraction-engineering-services-section`), `services/ethereum-node-services-section`,
`services/optimism-services-section`, `services/sign-ethereum-digest-with-cloud-kms-services-section`,
`services/smart-contract-services-section`.

Package names: `@red-cup-engineering/ethereum-services-section` is retired (no publish since
0.14.0; remaining dependents `agrodao` and `bare-cedar-fog-colony-report-team`, plus archived
`2026-08-04-561-group-dynamic-site` and `2026-08-03-leader-services-section`, pin exact `0.7.2`,
which stays in the registry). Nested packages `@red-cup-engineering/erc-4337-bundler-services-section`
and `@red-cup-engineering/erc-7677-paymaster-services-section` are published from their extracted repositories.

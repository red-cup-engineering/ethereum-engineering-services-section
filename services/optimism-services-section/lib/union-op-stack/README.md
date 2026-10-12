# Union OP Stack carrier

This is a small deployment carrier for one custom OP Stack L3-like chain settled on Base Sepolia (`eip155:84532`). It invokes official `op-deployer v0.7.1`; it does not implement a blockchain runtime or deploy anything merely by being present.

The child is `eip155:804739999`: the first 32 bits of `keccak256("Union of Harmonious Colonies")`, `0x2ff75b9`. It was checked unallocated on 2026-07-24; that observation is not a reservation or a deployment claim. The pinned deployer’s official generated custom intent uses embedded artifacts, resolving to `op-contracts/v7.0.0-rc.4` (recorded in `op-deployer.lock`), not `v6.0.0`: `v0.7.1` is incompatible with forcing the requested v6.0.0 locator. This is an explicit pre-release risk and refusal boundary: do not deploy until the contracts/release selection is accepted. The intent configures Custom Gas Token v2, whose 18-decimal L2-native asset is **Union Gas** (`UHG`). CGT v2 rejects ETH-value bridge operations; operators must separately design and audit liquidity and bridging before use.

## Inputs, outputs, and effects

`roles.env.example` specifies twelve required public role-address inputs. Copy it outside the repository (or to ignored `roles.env`), make every listed address nonzero and distinct, and set `UNION_OP_ROLE_FILE` to it. `UNION_OP_L1_RPC_URL` must be an HTTPS Base Sepolia endpoint. `UNION_OP_DEPLOYER_PRIVATE_KEY` is read only at execution time from an operator-controlled secret provider; never place it in a file, shell history, logs, or this directory.

`scripts/bootstrap.sh` spends the supplied deployer’s Base Sepolia ETH to create shared Superchain contracts and writes bootstrap JSON only to ignored `.deployer/`. `scripts/apply.sh` renders the intent into that ignored state directory, sends the chain deployment transactions, then writes deployment state and genesis there. `scripts/inspect.sh` regenerates a local genesis projection from existing state. These are cloud build/deploy acts only; no script starts `op-reth`, `op-node`, `op-batcher`, `op-proposer`, or `op-challenger`. Long-running placement, key custody, network policy, monitoring, and independent release approval remain separate operations.

Run offline validation before any remote action:

```bash
./scripts/validate.sh
bash -n scripts/*.sh
OP_DEPLOYER_BIN=/absolute/path/to/op-deployer-v0.7.1 ./scripts/test-cli-compatibility.sh
```

Then, after an authorized operator has supplied the inputs:

```bash
./scripts/bootstrap.sh
./scripts/apply.sh
./scripts/inspect.sh
```

The scripts refuse localhost endpoints and any non-Base-Sepolia local development chain (by requiring the live RPC chain ID to be `84532`), parent-chain drift, child-chain derivation drift, a non-`v0.7.1` deployer, absent/non-EVM/zero/distinct-role violations, unpinned images, and secret-shaped role files. `images.lock` pins the current official create-L2-rollup images by tag and digest. No Solidity is changed, and no deployment, allocation, custody, bridge, production placement, or release approval is claimed.

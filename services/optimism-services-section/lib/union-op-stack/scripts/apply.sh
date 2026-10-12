#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
"$ROOT/scripts/validate.sh"
require_env UNION_OP_L1_RPC_URL; require_env UNION_OP_DEPLOYER_PRIVATE_KEY
reject_local_or_dev_rpc "$UNION_OP_L1_RPC_URL"; load_roles; assert_deployer; assert_parent_chain
state="${UNION_OP_STATE_DIR:-$ROOT/.deployer}"; [[ -f "$state/bootstrap_superchain.json" && -f "$state/bootstrap_implementations.json" ]] || die "bootstrap outputs missing; run bootstrap.sh first"
mkdir -p "$state"
envsubst < "$ROOT/intent.toml.template" > "$state/intent.toml"
"$OP_DEPLOYER_BIN" apply --workdir "$state" --l1-rpc-url="$UNION_OP_L1_RPC_URL" --private-key="$UNION_OP_DEPLOYER_PRIVATE_KEY"
"$OP_DEPLOYER_BIN" apply --workdir "$state" --deployment-target genesis
"$OP_DEPLOYER_BIN" inspect genesis --workdir "$state" "$CHILD_CHAIN_ID" > "$state/genesis.json"
printf 'Deployment transactions submitted; inspect receipts before placing long-running services.\n'

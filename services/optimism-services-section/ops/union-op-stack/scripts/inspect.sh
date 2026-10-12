#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
"$ROOT/scripts/validate.sh"
require_env UNION_OP_L1_RPC_URL; reject_local_or_dev_rpc "$UNION_OP_L1_RPC_URL"; assert_parent_chain; assert_deployer
state="${UNION_OP_STATE_DIR:-$ROOT/.deployer}"; [[ -f "$state/state.json" ]] || die "apply state missing"
"$OP_DEPLOYER_BIN" inspect genesis --workdir "$state" "$CHILD_CHAIN_ID" > "$state/genesis.json"
jq -e . "$state/state.json" >/dev/null
printf 'inspect completed; generated genesis is %s/genesis.json (no deployment status is asserted).\n' "$state"

#!/usr/bin/env bash
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
"$ROOT/scripts/validate.sh"
require_env UNION_OP_L1_RPC_URL; require_env UNION_OP_DEPLOYER_PRIVATE_KEY
reject_local_or_dev_rpc "$UNION_OP_L1_RPC_URL"; load_roles; assert_deployer; assert_parent_chain
OP_DEPLOYER_BIN="$OP_DEPLOYER_BIN" "$ROOT/scripts/test-cli-compatibility.sh"
state="${UNION_OP_STATE_DIR:-$ROOT/.deployer}"; mkdir -p "$state"
"$OP_DEPLOYER_BIN" bootstrap superchain --l1-rpc-url="$UNION_OP_L1_RPC_URL" --private-key="$UNION_OP_DEPLOYER_PRIVATE_KEY" --artifacts-locator=embedded --outfile="$state/bootstrap_superchain.json" --superchain-proxy-admin-owner="$SUPERCHAIN_PROXY_ADMIN_OWNER" --guardian="$SUPERCHAIN_GUARDIAN"
"$OP_DEPLOYER_BIN" bootstrap implementations --l1-rpc-url="$UNION_OP_L1_RPC_URL" --private-key="$UNION_OP_DEPLOYER_PRIVATE_KEY" --artifacts-locator=embedded --outfile="$state/bootstrap_implementations.json" --superchain-config-proxy="$(jq -r .superchainConfigProxyAddress "$state/bootstrap_superchain.json")" --superchain-proxy-admin="$(jq -r .proxyAdminAddress "$state/bootstrap_superchain.json")" --challenger="$CHALLENGER" --upgrade-controller="$SUPERCHAIN_PROXY_ADMIN_OWNER"

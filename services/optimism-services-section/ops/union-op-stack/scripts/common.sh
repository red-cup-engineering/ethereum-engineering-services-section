#!/usr/bin/env bash
set -euo pipefail

readonly ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly PARENT_CHAIN_ID=84532
readonly CHILD_CHAIN_ID=804739999
readonly CHILD_CHAIN_HEX=0x2ff75b9f
readonly DEPLOYER_VERSION=v0.7.1
readonly OP_DEPLOYER_BIN="${OP_DEPLOYER_BIN:-op-deployer}"

die() { printf 'union-op-stack: %s\n' "$*" >&2; exit 64; }
require_command() { command -v "$1" >/dev/null 2>&1 || die "required command missing: $1"; }
require_env() { [[ -n "${!1:-}" ]] || die "required environment variable missing: $1"; }

reject_local_or_dev_rpc() {
  local url="$1"
  [[ "$url" =~ ^https:// ]] || die "RPC URL must use https"
  [[ ! "$url" =~ (localhost|127\\.|0\\.0\\.0\\.0|::1) ]] || die "localhost RPC endpoints are refused"
}

load_roles() {
  local role_file="${UNION_OP_ROLE_FILE:-$ROOT/roles.env}"
  [[ -f "$role_file" ]] || die "role file missing; set UNION_OP_ROLE_FILE"
  [[ ! "$role_file" =~ /roles\.env\.example$ ]] || die "example role file is not an input"
  if rg -n -i '^[A-Za-z_][A-Za-z0-9_]*(private[_-]?key|mnemonic|seed(_phrase)?|password|api[_-]?key|secret)[A-Za-z0-9_]*=' "$role_file" >/dev/null; then
    die "role file is secret-shaped; it may contain public addresses only"
  fi
  # shellcheck disable=SC1090
  source "$role_file"
  local names=(SUPERCHAIN_PROXY_ADMIN_OWNER SUPERCHAIN_GUARDIAN CHALLENGER CHAIN_CHALLENGER L1_PROXY_ADMIN_OWNER L2_PROXY_ADMIN_OWNER SYSTEM_CONFIG_OWNER UNSAFE_BLOCK_SIGNER BATCHER PROPOSER FEE_VAULT_RECIPIENT LIQUIDITY_CONTROLLER_OWNER)
  local n value
  for n in "${names[@]}"; do
    require_env "$n"; value="${!n}"
    [[ "$value" =~ ^0x[0-9a-fA-F]{40}$ ]] || die "$n is not a 20-byte EVM address"
    [[ "$value" != 0x0000000000000000000000000000000000000000 ]] || die "$n must not be the zero address"
  done
  local i j
  for ((i=0; i<${#names[@]}; i++)); do for ((j=i+1; j<${#names[@]}; j++)); do
    [[ "${!names[i],,}" != "${!names[j],,}" ]] || die "roles must be distinct: ${names[i]} and ${names[j]}"
  done; done
}

assert_parent_chain() {
  require_command cast
  local actual
  actual="$(cast chain-id --rpc-url "$UNION_OP_L1_RPC_URL")"
  [[ "$actual" == "$PARENT_CHAIN_ID" ]] || die "parent chain drift: expected eip155:$PARENT_CHAIN_ID, got eip155:$actual"
}

assert_deployer() {
  require_command "$OP_DEPLOYER_BIN"
  local actual
  actual="$($OP_DEPLOYER_BIN --version 2>&1 || true)"
  [[ "$actual" == *"$DEPLOYER_VERSION"* ]] || die "op-deployer drift: required $DEPLOYER_VERSION, got: $actual"
}

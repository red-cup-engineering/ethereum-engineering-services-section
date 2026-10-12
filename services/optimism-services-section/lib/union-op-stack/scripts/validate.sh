#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fail() { printf 'union-op-stack validation: %s\n' "$*" >&2; exit 1; }
[[ "$(cast keccak 'Union of Harmonious Colonies')" == 0x2ff75b9f7811c99aab3e7d3da941d1c752b59558c8b8871a4d828fb152e1e9e0 ]] || fail "chain-name digest drift"
[[ "$(cast to-dec 0x2ff75b9f)" == 804739999 ]] || fail "child chain ID drift"
rg -q '^l1ChainID = 84532$' "$ROOT/intent.toml.template" || fail "parent chain drift"
rg -q '^l1ContractsLocator = "embedded"$' "$ROOT/intent.toml.template" || fail "v0.7.1 embedded-contract locator drift"
rg -q '^l2ContractsLocator = "embedded"$' "$ROOT/intent.toml.template" || fail "v0.7.1 embedded-contract locator drift"
! rg -q 'ProtocolVersionsOwner' "$ROOT/intent.toml.template" || fail "unsupported v0.7.1 ProtocolVersionsOwner intent field"
! rg -q -- '--mips-version' "$ROOT/scripts/bootstrap.sh" || fail "bootstrap must use v0.7.1's default MIPS version 8"
rg -q '^name = "Union Gas"$' "$ROOT/intent.toml.template" || fail "gas-token name drift"
rg -q '^symbol = "UHG"$' "$ROOT/intent.toml.template" || fail "gas-token symbol drift"
while IFS= read -r image; do [[ "$image" =~ :v[^@]+@sha256:[a-f0-9]{64}$ ]] || fail "image is not tag-and-digest pinned: $image"; done < <(rg '^[A-Z_]+=' "$ROOT/images.lock" | cut -d= -f2)
if rg -n -i '(private[_-]?key|mnemonic|seed(_phrase)?|password|api[_-]?key|secret)[[:space:]]*=' "$ROOT" --glob '!README.md' --glob '!scripts/common.sh' --glob '!scripts/validate.sh' --glob '!roles.env.example' --glob '!*\.gitignore' | rg -v 'UNION_OP_DEPLOYER_PRIVATE_KEY'; then fail "secret-shaped public artifact"; fi
printf 'offline validation passed: parent eip155:84532; child eip155:804739999; CGT v2 intent; pinned images.\n'

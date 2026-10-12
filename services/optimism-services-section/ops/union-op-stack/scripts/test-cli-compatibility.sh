#!/usr/bin/env bash
# Offline guard: interrogates a supplied v0.7.1 binary only; it sends no RPC calls.
set -euo pipefail
bin="${OP_DEPLOYER_BIN:?set OP_DEPLOYER_BIN to the pinned op-deployer v0.7.1 binary}"
fail() { printf 'op-deployer CLI compatibility: %s\n' "$*" >&2; exit 1; }
command -v "$bin" >/dev/null 2>&1 || fail "binary not found: $bin"
version="$($bin --version 2>&1 || true)"
[[ "$version" == *v0.7.1* ]] || fail "expected v0.7.1, got: $version"
superchain="$($bin bootstrap superchain --help)"
implementations="$($bin bootstrap implementations --help)"
implementations_flat="$(printf '%s' "$implementations" | tr '\n' ' ')"
for flag in --l1-rpc-url --private-key --artifacts-locator --outfile --superchain-proxy-admin-owner --guardian; do [[ "$superchain" == *"$flag"* ]] || fail "bootstrap superchain lacks $flag"; done
for flag in --l1-rpc-url --private-key --artifacts-locator --outfile --superchain-config-proxy --superchain-proxy-admin --challenger --upgrade-controller; do [[ "$implementations" == *"$flag"* ]] || fail "bootstrap implementations lacks $flag"; done
[[ "$implementations_flat" =~ --mips-version.*default[^0-9]*8 ]] || fail "bootstrap implementations default MIPS version is not 8"
[[ "$superchain" != *--protocol-versions-owner* ]] || fail "unsupported protocol-versions-owner unexpectedly accepted"
[[ "$implementations" != *--protocol-versions-proxy* ]] || fail "unsupported protocol-versions-proxy unexpectedly accepted"
printf 'op-deployer v0.7.1 CLI compatibility passed.\n'

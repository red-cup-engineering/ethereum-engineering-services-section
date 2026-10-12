import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { bootstrapScript, generate, nodeEnvironment, systemdUnit } from "../generate-cloud-vps-bootstrap.mjs";

const GENESIS_SHA256 = "a".repeat(64);

test("generator emits a loopback-only, hardened node bundle without keys", async () => {
  const parent = await mkdtemp(join(tmpdir(), "alpha-chain-vps-"));
  const output = join(parent, "bundle");
  try {
    await generate({
      outputPath: output,
      p2pHost: "100.64.0.12",
      bootnodes: ["enode://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@100.64.0.11:30303"],
      genesisUrl: "https://example.invalid/alpha-chain/genesis.json",
      genesisSha256: GENESIS_SHA256,
    });
    const environment = await readFile(join(output, "node.env"), "utf8");
    const unit = await readFile(join(output, "alpha-chain-node.service"), "utf8");
    const script = await readFile(join(output, "bootstrap-alpha-chain-node.sh"), "utf8");
    assert.match(environment, /^RPC_HOST=127\.0\.0\.1$/mu);
    assert.match(environment, /^P2P_INTERFACE=100\.64\.0\.12$/mu);
    assert.match(unit, /ProtectSystem=strict/u);
    assert.match(unit, /--p2p-interface=\$\{P2P_INTERFACE\}/u);
    assert.match(unit, /ConditionPathExists=\/var\/lib\/alpha-chain\/node\.key/u);
    assert.match(unit, /--rpc-http-host=\$\{RPC_HOST\}/u);
    assert.doesNotMatch(`${environment}\n${unit}\n${script}`, /PRIVATE_KEY=/u);
    assert.match(script, /openjdk-25-jre-headless/u);
    assert.match(script, /21129fbd34468182ef134fca78989450f2bd8205e18ed87e75b1a420141ba209/u);
    assert.equal(((await stat(join(output, "node.env"))).mode & 0o777), 0o600);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("rejects public P2P addresses, malformed bootnodes, and unsafe genesis input", () => {
  assert.throws(() => nodeEnvironment({ p2pHost: "8.8.8.8" }), /private|Tailscale/u);
  assert.throws(() => nodeEnvironment({ p2pHost: "127.0.0.1" }), /private|Tailscale/u);
  assert.throws(() => nodeEnvironment({ p2pHost: "10.999.1.1" }), /private|Tailscale/u);
  assert.throws(() => nodeEnvironment({ p2pHost: "100.64.0.1", bootnodes: ["https://peer"] }), /enode/u);
  assert.throws(() => bootstrapScript({ genesisUrl: "http://example.invalid/genesis", genesisSha256: GENESIS_SHA256 }), /HTTPS/u);
  assert.throws(() => bootstrapScript({ genesisUrl: "https://example.invalid/genesis", genesisSha256: "A".repeat(64) }), /lowercase/u);
  assert.match(systemdUnit(), /eip155:5615610/u);
});

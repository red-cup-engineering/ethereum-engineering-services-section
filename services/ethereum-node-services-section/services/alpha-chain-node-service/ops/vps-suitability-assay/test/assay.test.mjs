import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  ASSAY_POLICY,
  assayVpsSuitability,
  isPrivateNetworkAddress,
} from "../src/assay.mjs";

const suitableFacts = Object.freeze({
  ramBytes: 8 * 1024 ** 3,
  disk: { availableBytes: 80 * 1024 ** 3, kind: "nvme" },
  java: { major: 25 },
  architecture: "x86_64",
  privateNetworkAddress: "100.74.3.9",
  clock: { synchronized: true, offsetMs: -12 },
  ports: {
    p2pTcp: { port: 30303, available: true, scope: "private-network" },
    p2pUdp: { port: 30303, available: true, scope: "private-network" },
    rpcHttp: { port: 8561, available: true, scope: "loopback" },
    metrics: { port: 9545, available: true, scope: "loopback" },
  },
});

test("accepts supplied facts for a private, synchronized Besu FULL node", () => {
  const outcome = assayVpsSuitability(suitableFacts);
  assert.equal(outcome.decision, "pass");
  assert.deepEqual(outcome.refusalCodes, []);
  assert.equal(outcome.target.chain, "eip155:5615610");
  assert.equal(outcome.target.client, `hyperledger-besu@${ASSAY_POLICY.besuVersion}`);
  assert.equal(outcome.policy.profile, ASSAY_POLICY.profile);
  assert.deepEqual(outcome.policy.sources, ASSAY_POLICY.sources);
});

test("refuses an undersized host and publicly exposed node boundaries with exact evidence", () => {
  const outcome = assayVpsSuitability({
    ...suitableFacts,
    ramBytes: 4 * 1024 ** 3,
    disk: { availableBytes: 10 * 1024 ** 3, kind: "network-hdd" },
    java: { major: 21 },
    privateNetworkAddress: "34.1.2.3",
    clock: { synchronized: false, offsetMs: 8_000 },
    ports: {
      ...suitableFacts.ports,
      rpcHttp: { port: 8561, available: true, scope: "public" },
    },
  });
  assert.equal(outcome.decision, "refuse");
  assert.deepEqual(outcome.refusalCodes, [
    "memory.capacity",
    "disk.capacity",
    "disk.medium",
    "java.version",
    "network.private-address",
    "clock.synchronization",
    "port.rpc-http",
  ]);
});

test("missing injected observations refuse rather than silently default", () => {
  const outcome = assayVpsSuitability();
  assert.equal(outcome.decision, "refuse");
  assert.equal(outcome.refusalCodes.length, 11);
  assert.equal(outcome.checks.every(({ observed }) => observed === null), true);
});

test("recognizes RFC1918, carrier-grade private, and IPv6 ULA addresses only", () => {
  for (const address of ["10.4.5.6", "172.31.2.3", "192.168.9.8", "100.127.255.1", "fd12::9"]) {
    assert.equal(isPrivateNetworkAddress(address), true, address);
  }
  for (const address of ["127.0.0.1", "169.254.1.1", "8.8.8.8", "100.128.0.1", "::1", "not-an-ip"]) {
    assert.equal(isPrivateNetworkAddress(address), false, address);
  }
});

test("CLI consumes JSON from stdin and makes refusal machine-visible", () => {
  const result = spawnSync(
    process.execPath,
    [new URL("../scripts/assay-vps.mjs", import.meta.url).pathname, "-"],
    { input: JSON.stringify({ ...suitableFacts, architecture: "i386" }), encoding: "utf8" },
  );
  assert.equal(result.status, 2);
  assert.equal(result.stderr, "");
  const outcome = JSON.parse(result.stdout);
  assert.deepEqual(outcome.refusalCodes, ["cpu.architecture"]);
});

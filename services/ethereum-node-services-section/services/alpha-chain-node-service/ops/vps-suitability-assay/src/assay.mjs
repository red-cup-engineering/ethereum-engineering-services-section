import { isIP } from "node:net";

const GIB = 1024 ** 3;
const SUPPORTED_ARCHITECTURES = new Set(["x86_64", "amd64", "aarch64", "arm64"]);
const SSD_KINDS = new Set(["local-ssd", "nvme", "ssd"]);

export const ASSAY_POLICY = Object.freeze({
  profile: "besu-qbft-private-full-node-v1",
  chain: "eip155:5615610",
  besuVersion: "26.7.0",
  minimumRamBytes: 6 * GIB,
  minimumDiskAvailableBytes: 20 * GIB,
  minimumJavaMajor: 25,
  maximumClockOffsetMs: 1_000,
  p2pPort: 30_303,
  rpcPort: 8_561,
  metricsPort: 9_545,
  sources: Object.freeze([
    "https://docs.besu-eth.org/private-networks/get-started/system-requirements",
    "https://docs.besu-eth.org/public-networks/get-started/system-requirements",
  ]),
});

function ipv4Number(address) {
  return address.split(".").reduce((result, part) => (result << 8) + Number(part), 0) >>> 0;
}

function inIpv4Range(address, first, prefixLength) {
  const mask = prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0;
  return (ipv4Number(address) & mask) === (ipv4Number(first) & mask);
}

export function isPrivateNetworkAddress(address) {
  if (typeof address !== "string") return false;
  const family = isIP(address);
  if (family === 4) {
    return inIpv4Range(address, "10.0.0.0", 8)
      || inIpv4Range(address, "172.16.0.0", 12)
      || inIpv4Range(address, "192.168.0.0", 16)
      || inIpv4Range(address, "100.64.0.0", 10);
  }
  if (family === 6) {
    const normalized = address.toLowerCase();
    return /^f[cd][0-9a-f]{2}:/u.test(normalized);
  }
  return false;
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function check(id, requirement, observed, accepted) {
  return Object.freeze({
    id,
    status: accepted ? "pass" : "refuse",
    requirement,
    observed: observed ?? null,
  });
}

function portCheck(id, observed, port, requiredScope) {
  const accepted = observed?.port === port
    && observed?.available === true
    && observed?.scope === requiredScope;
  return check(
    id,
    `port ${port} must be available with ${requiredScope} scope`,
    observed,
    accepted,
  );
}

/**
 * Assay supplied host facts. This function never probes or mutates the host.
 *
 * Expected ports shape:
 * { p2pTcp, p2pUdp, rpcHttp, metrics }, where each value is
 * { port: number, available: boolean, scope: "private-network" | "loopback" | "public" }.
 */
export function assayVpsSuitability(facts = {}) {
  const checks = [
    check(
      "memory.capacity",
      `RAM must be at least ${ASSAY_POLICY.minimumRamBytes} bytes (6 GiB host recommendation)`,
      facts.ramBytes,
      finiteNumber(facts.ramBytes) && facts.ramBytes >= ASSAY_POLICY.minimumRamBytes,
    ),
    check(
      "disk.capacity",
      `available data disk must be at least ${ASSAY_POLICY.minimumDiskAvailableBytes} bytes (20 GiB initial floor)`,
      facts.disk?.availableBytes,
      finiteNumber(facts.disk?.availableBytes)
        && facts.disk.availableBytes >= ASSAY_POLICY.minimumDiskAvailableBytes,
    ),
    check(
      "disk.medium",
      "validator and RPC-node state must use SSD or NVMe storage",
      facts.disk?.kind,
      SSD_KINDS.has(facts.disk?.kind),
    ),
    check(
      "java.version",
      `Java major version must be at least ${ASSAY_POLICY.minimumJavaMajor}`,
      facts.java?.major,
      Number.isInteger(facts.java?.major) && facts.java.major >= ASSAY_POLICY.minimumJavaMajor,
    ),
    check(
      "cpu.architecture",
      "architecture must have a supported 64-bit Besu/Java distribution",
      facts.architecture,
      SUPPORTED_ARCHITECTURES.has(facts.architecture),
    ),
    check(
      "network.private-address",
      "P2P host must be an explicit RFC1918, RFC6598, or IPv6 ULA address",
      facts.privateNetworkAddress,
      isPrivateNetworkAddress(facts.privateNetworkAddress),
    ),
    check(
      "clock.synchronization",
      `clock must be synchronized within ${ASSAY_POLICY.maximumClockOffsetMs} ms`,
      facts.clock,
      facts.clock?.synchronized === true
        && finiteNumber(facts.clock?.offsetMs)
        && Math.abs(facts.clock.offsetMs) <= ASSAY_POLICY.maximumClockOffsetMs,
    ),
    portCheck("port.p2p-tcp", facts.ports?.p2pTcp, ASSAY_POLICY.p2pPort, "private-network"),
    portCheck("port.p2p-udp", facts.ports?.p2pUdp, ASSAY_POLICY.p2pPort, "private-network"),
    portCheck("port.rpc-http", facts.ports?.rpcHttp, ASSAY_POLICY.rpcPort, "loopback"),
    portCheck("port.metrics", facts.ports?.metrics, ASSAY_POLICY.metricsPort, "loopback"),
  ];
  const refusals = checks.filter(({ status }) => status === "refuse");
  return Object.freeze({
    schema: "org.red-cup-engineering.alpha-chain.vps-suitability-assay.v1",
    decision: refusals.length === 0 ? "pass" : "refuse",
    policy: Object.freeze({
      profile: ASSAY_POLICY.profile,
      sources: ASSAY_POLICY.sources,
    }),
    target: Object.freeze({
      chain: ASSAY_POLICY.chain,
      client: `hyperledger-besu@${ASSAY_POLICY.besuVersion}`,
      consensus: "QBFT",
      syncMode: "FULL",
    }),
    checks: Object.freeze(checks),
    refusalCodes: Object.freeze(refusals.map(({ id }) => id)),
  });
}

#!/usr/bin/env node

import { chmod, mkdir, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import { resolve } from "node:path";

const CHAIN_ID = "5615610";
const BESU_VERSION = "26.7.0";
const BESU_SHA256 = "21129fbd34468182ef134fca78989450f2bd8205e18ed87e75b1a420141ba209";
const BESU_URL = `https://github.com/hyperledger/besu/releases/download/${BESU_VERSION}/besu-${BESU_VERSION}.tar.gz`;
const SHA256 = /^[a-f0-9]{64}$/u;
const ENODE = /^enode:\/\/[0-9a-f]{128}@[A-Za-z0-9:.[\]-]+:[1-9][0-9]{0,4}(?:\?discport=[1-9][0-9]{0,4})?$/u;

function fail(message) {
  throw new TypeError(message);
}

function ipv4Number(address) {
  return address.split(".").reduce((result, part) => (result * 256) + Number(part), 0) >>> 0;
}

function inIpv4Range(address, first, prefixLength) {
  const mask = prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0;
  return (ipv4Number(address) & mask) === (ipv4Number(first) & mask);
}

function privateP2pAddress(value) {
  if (typeof value !== "string" || value.length === 0 || /[\s'"`$\\]/u.test(value)) {
    fail("--p2p-host must be a literal private or Tailscale address");
  }
  const family = isIP(value);
  const isV4 = family === 4 && (
    inIpv4Range(value, "10.0.0.0", 8)
    || inIpv4Range(value, "172.16.0.0", 12)
    || inIpv4Range(value, "192.168.0.0", 16)
    || inIpv4Range(value, "100.64.0.0", 10)
  );
  const isUla = family === 6 && /^f[cd][0-9a-f]{2}:/iu.test(value);
  if (!isV4 && !isUla) fail("--p2p-host must be RFC1918, Tailscale 100.64.0.0/10, or IPv6 ULA");
  return value;
}

function option(args, name) {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

function required(args, name) {
  const value = option(args, name);
  if (typeof value !== "string" || value.length === 0) fail(`${name} is required`);
  return value;
}

export function nodeEnvironment({ p2pHost, bootnodes = [] }) {
  privateP2pAddress(p2pHost);
  if (!Array.isArray(bootnodes) || bootnodes.some((node) => !ENODE.test(node))) {
    fail("--bootnode must be a complete enode URL; repeat it for each peer");
  }
  return [
    `CHAIN_ID=${CHAIN_ID}`,
    "BESU_HOME=/usr/local/lib/alpha-chain/besu",
    "DATA_PATH=/var/lib/alpha-chain",
    "GENESIS_FILE=/var/lib/alpha-chain/genesis.json",
    "NODE_PRIVATE_KEY_FILE=/var/lib/alpha-chain/node.key",
    `P2P_HOST=${p2pHost}`,
    `P2P_INTERFACE=${p2pHost}`,
    "P2P_PORT=30303",
    "RPC_HOST=127.0.0.1",
    "RPC_PORT=8561",
    "METRICS_HOST=127.0.0.1",
    "METRICS_PORT=9545",
    `BOOTNODES=${bootnodes.join(",")}`,
    "# Copy a pre-generated private key to NODE_PRIVATE_KEY_FILE before starting the unit.",
    "# This bundle intentionally never generates validator or node keys.",
    "",
  ].join("\n");
}

export function systemdUnit() {
  return `[Unit]\nDescription=Union Alpha Chain eip155:${CHAIN_ID} Besu QBFT node\nWants=network-online.target\nAfter=network-online.target\nConditionPathExists=/etc/alpha-chain/node.env\nConditionPathExists=/var/lib/alpha-chain/genesis.json\nConditionPathExists=/var/lib/alpha-chain/node.key\n\n[Service]\nType=simple\nUser=besu\nGroup=besu\nEnvironmentFile=/etc/alpha-chain/node.env\nExecStart=/usr/local/lib/alpha-chain/besu/bin/besu --data-path=\${DATA_PATH} --genesis-file=\${GENESIS_FILE} --network-id=${CHAIN_ID} --profile=ENTERPRISE --sync-mode=FULL --version-compatibility-protection=true --node-private-key-file=\${NODE_PRIVATE_KEY_FILE} --p2p-host=\${P2P_HOST} --p2p-interface=\${P2P_INTERFACE} --p2p-port=\${P2P_PORT} --rpc-http-enabled=true --rpc-http-host=\${RPC_HOST} --rpc-http-port=\${RPC_PORT} --rpc-http-api=ETH,NET,WEB3,QBFT --rpc-ws-enabled=false --graphql-http-enabled=false --host-allowlist=localhost,127.0.0.1 --metrics-enabled=true --metrics-host=\${METRICS_HOST} --metrics-port=\${METRICS_PORT} --bootnodes=\${BOOTNODES}\nRestart=on-failure\nRestartSec=5s\nTimeoutStartSec=90s\nLimitNOFILE=65536\nNoNewPrivileges=true\nPrivateTmp=true\nPrivateDevices=true\nProtectSystem=strict\nProtectHome=true\nProtectKernelTunables=true\nProtectKernelModules=true\nProtectControlGroups=true\nProtectClock=true\nProtectHostname=true\nRestrictAddressFamilies=AF_UNIX AF_INET AF_INET6\nRestrictNamespaces=true\nLockPersonality=true\nMemoryDenyWriteExecute=false\nReadWritePaths=/var/lib/alpha-chain\nUMask=0077\n\n[Install]\nWantedBy=multi-user.target\n`;
}

export function bootstrapScript({ genesisUrl, genesisSha256 }) {
  if (!/^https:\/\//u.test(genesisUrl ?? "") || /[\s'"`$\\]/u.test(genesisUrl)) fail("--genesis-url must be one literal HTTPS URL");
  if (!SHA256.test(genesisSha256 ?? "")) fail("--genesis-sha256 must be lowercase SHA-256");
  return `#!/usr/bin/env bash\nset -euo pipefail\n\nBESU_VERSION=${BESU_VERSION}\nBESU_SHA256=${BESU_SHA256}\nBESU_URL=${BESU_URL}\nGENESIS_URL=${genesisUrl}\nGENESIS_SHA256=${genesisSha256}\nSCRIPT_DIR=$(CDPATH= cd -- \"$(dirname -- \"$0\")\" && pwd)\n\nif [ \"$(id -u)\" -ne 0 ]; then\n  echo 'Run this installer as root.' >&2\n  exit 1\nfi\nif [ ! -f /etc/alpha-chain/node.env ]; then\n  echo 'Install the generated node.env at /etc/alpha-chain/node.env before running this installer.' >&2\n  exit 1\nfi\nif [ ! -f /var/lib/alpha-chain/node.key ]; then\n  echo 'Copy an existing node key to /var/lib/alpha-chain/node.key (owner besu, mode 0600); this installer never generates keys.' >&2\n  exit 1\nfi\nif [ -e /usr/local/lib/alpha-chain/besu ]; then\n  echo 'Refusing to replace an existing Besu installation; review and replace it explicitly.' >&2\n  exit 1\nfi\n\nexport DEBIAN_FRONTEND=noninteractive\napt-get update\napt-get install -y --no-install-recommends ca-certificates curl openjdk-25-jre-headless\ngetent group besu >/dev/null || groupadd --system besu\nid -u besu >/dev/null 2>&1 || useradd --system --gid besu --home-dir /var/lib/alpha-chain --shell /usr/sbin/nologin besu\ninstall -d -o besu -g besu -m 0700 /var/lib/alpha-chain\nchown besu:besu /var/lib/alpha-chain/node.key\nchmod 0600 /var/lib/alpha-chain/node.key\n\nworkdir=$(mktemp -d)\ntrap 'rm -rf \"$workdir\"' EXIT\ncurl --fail --location --proto '=https' --tlsv1.2 \"$BESU_URL\" --output \"$workdir/besu.tar.gz\"\necho \"$BESU_SHA256  $workdir/besu.tar.gz\" | sha256sum --check --status\ninstall -d -m 0755 /usr/local/lib/alpha-chain\ntar --extract --gzip --file \"$workdir/besu.tar.gz\" --directory /usr/local/lib/alpha-chain\nmv \"/usr/local/lib/alpha-chain/besu-$BESU_VERSION\" /usr/local/lib/alpha-chain/besu\n\ncurl --fail --location --proto '=https' --tlsv1.2 \"$GENESIS_URL\" --output \"$workdir/genesis.json\"\necho \"$GENESIS_SHA256  $workdir/genesis.json\" | sha256sum --check --status\ninstall -o besu -g besu -m 0600 \"$workdir/genesis.json\" /var/lib/alpha-chain/genesis.json\ninstall -m 0644 \"$SCRIPT_DIR/alpha-chain-node.service\" /etc/systemd/system/alpha-chain-node.service\nsystemctl daemon-reload\nsystemctl enable alpha-chain-node.service\necho 'Installed. Inspect with systemctl status alpha-chain-node; start only after independent peer/genesis review.'\n`;
}

export async function generate({ outputPath, p2pHost, bootnodes, genesisUrl, genesisSha256 }) {
  const output = resolve(outputPath);
  await mkdir(output, { recursive: false, mode: 0o700 });
  await Promise.all([
    writeFile(resolve(output, "node.env"), nodeEnvironment({ p2pHost, bootnodes }), { mode: 0o600, flag: "wx" }),
    writeFile(resolve(output, "alpha-chain-node.service"), systemdUnit(), { mode: 0o644, flag: "wx" }),
    writeFile(resolve(output, "bootstrap-alpha-chain-node.sh"), bootstrapScript({ genesisUrl, genesisSha256 }), { mode: 0o700, flag: "wx" }),
  ]);
  await Promise.all([
    chmod(resolve(output, "node.env"), 0o600),
    chmod(resolve(output, "alpha-chain-node.service"), 0o644),
    chmod(resolve(output, "bootstrap-alpha-chain-node.sh"), 0o700),
  ]);
  return output;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const outputPath = required(args, "--output");
  const p2pHost = required(args, "--p2p-host");
  const genesisUrl = required(args, "--genesis-url");
  const genesisSha256 = required(args, "--genesis-sha256");
  const bootnodes = args.flatMap((value, index) => value === "--bootnode" ? [args[index + 1]] : []).filter(Boolean);
  const output = await generate({ outputPath, p2pHost, bootnodes, genesisUrl, genesisSha256 });
  process.stdout.write(`${output}\n`);
}

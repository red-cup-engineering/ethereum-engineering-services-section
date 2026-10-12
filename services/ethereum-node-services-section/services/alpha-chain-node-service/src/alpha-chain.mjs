import { resolve, sep } from "node:path";

// The predecessor chain is retained as an immutable historical trace.  No
// successor-number law existed, so continuity uses the smallest non-reused
// decimal successor (this constant).
export const ALPHA_CHAIN_ID = 5_615_611;
export const ALPHA_CAIP2 = `eip155:${ALPHA_CHAIN_ID}`;
// Bootstrap one real failure domain. Additional validators are admitted only
// after they run on independent machines; extra processes here are not quorum.
export const VALIDATOR_COUNT = 1;
export const BESU_VERSION = "26.7.0";
export const BESU_SHA256 = "21129fbd34468182ef134fca78989450f2bd8205e18ed87e75b1a420141ba209";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const PORT = /^[1-9][0-9]*$/u;

function port(value, label) {
  const selected = String(value ?? "");
  if (!PORT.test(selected) || Number(selected) > 65_535) {
    throw new TypeError(`${label} must be a TCP/UDP port from 1 through 65535`);
  }
  return selected;
}

function privateOverlayAddress(value) {
  const match = /^100\.([0-9]{1,3})\.[0-9]{1,3}\.[0-9]{1,3}$/u.exec(String(value ?? ""));
  if (!match) return false;
  const second = Number(match[1]);
  return second >= 64 && second <= 127;
}

function absolutePath(value, label) {
  if (typeof value !== "string" || value.length === 0 || resolve(value) !== value) {
    throw new TypeError(`${label} must be an absolute path`);
  }
  return value;
}

export function qbftConfiguration({ treasuryAddress, bootstrapAddresses = [] } = {}) {
  if (!ADDRESS.test(treasuryAddress ?? "")) {
    throw new TypeError("treasuryAddress must be one EVM address whose signer is held outside Git");
  }
  if (!Array.isArray(bootstrapAddresses) || bootstrapAddresses.some((address) => !ADDRESS.test(address))) {
    throw new TypeError("bootstrapAddresses must be EVM addresses whose service signers are held outside Git");
  }
  const fundedAddresses = new Set([
    treasuryAddress.toLowerCase(),
    ...bootstrapAddresses.map((address) => address.toLowerCase()),
  ]);
  return Object.freeze({
    genesis: {
      config: {
        chainId: ALPHA_CHAIN_ID,
        berlinBlock: 0,
        londonBlock: 0,
        shanghaiTime: 0,
        cancunTime: 0,
        pragueTime: 0,
        osakaTime: 0,
        qbft: {
          blockperiodseconds: 2,
          emptyblockperiodseconds: 30,
          epochlength: 30_000,
          requesttimeoutseconds: 4,
          blockreward: "0x0",
        },
      },
      nonce: "0x0",
      timestamp: "0x0",
      gasLimit: "0x1c9c380",
      baseFeePerGas: "0x3b9aca00",
      difficulty: "0x1",
      mixHash: "0x63746963616c2062797a616e74696e65206661756c7420746f6c6572616e6365",
      coinbase: "0x0000000000000000000000000000000000000000",
      alloc: Object.fromEntries([...fundedAddresses].map((address) => [address, {
        balance: "0x204fce5e3e25026110000000",
      }])),
      number: "0x0",
      gasUsed: "0x0",
      parentHash: `0x${"00".repeat(32)}`,
    },
    blockchain: {
      nodes: {
        generate: true,
        count: VALIDATOR_COUNT,
      },
    },
  });
}

export function assertPrivateOutputPath({ outputPath, repositoryRoot } = {}) {
  const output = absolutePath(outputPath, "outputPath");
  const repository = absolutePath(repositoryRoot, "repositoryRoot");
  if (output === repository || output.startsWith(`${repository}${sep}`)) {
    throw new Error("validator material must be generated outside the repository");
  }
  return output;
}

export function nodeArguments({
  dataPath,
  genesisPath,
  p2pHost,
  p2pPort = "30303",
  rpcHost = "127.0.0.1",
  rpcPort = "8561",
  bootnodes = [],
  validator = true,
} = {}) {
  absolutePath(dataPath, "dataPath");
  absolutePath(genesisPath, "genesisPath");
  if (typeof p2pHost !== "string" || p2pHost.length === 0) {
    throw new TypeError("p2pHost must be the node's explicit private-network address");
  }
  // Loopback stays the default. An explicit private-overlay (CGNAT 100.64/10,
  // the tailnet) bind is additionally lawful because WSL virtioproxy has been
  // observed to wedge JVM loopback listeners (accepted p2p on the tailscale
  // address, refused every connection to the loopback RPC and metrics ports);
  // wildcard and public binds remain refused.
  const loopback = rpcHost === "127.0.0.1" || rpcHost === "::1";
  if (!loopback && !privateOverlayAddress(rpcHost)) {
    throw new TypeError("RPC must remain loopback-bound or bind one explicit private-overlay (CGNAT 100.64/10) address; publish it through an authenticated boundary");
  }
  if (!Array.isArray(bootnodes) || bootnodes.some((value) => !/^enode:\/\//u.test(value))) {
    throw new TypeError("bootnodes must be explicit enode URLs");
  }
  return Object.freeze([
    `--data-path=${dataPath}`,
    `--genesis-file=${genesisPath}`,
    `--network-id=${ALPHA_CHAIN_ID}`,
    "--profile=ENTERPRISE",
    "--sync-mode=FULL",
    "--version-compatibility-protection=true",
    `--p2p-host=${p2pHost}`,
    `--p2p-interface=${p2pHost}`,
    `--p2p-port=${port(p2pPort, "p2pPort")}`,
    `--rpc-http-host=${rpcHost}`,
    `--rpc-http-port=${port(rpcPort, "rpcPort")}`,
    "--rpc-http-enabled=true",
    "--rpc-http-api=ETH,NET,WEB3,QBFT",
    "--rpc-ws-enabled=false",
    "--graphql-http-enabled=false",
    `--host-allowlist=localhost,127.0.0.1${loopback ? "" : `,${rpcHost}`}`,
    "--metrics-enabled=true",
    "--metrics-host=127.0.0.1",
    "--metrics-port=9545",
    `--min-gas-price=${validator ? "1" : "0"}`,
    ...(bootnodes.length === 0 ? [] : [`--bootnodes=${bootnodes.join(",")}`]),
  ]);
}

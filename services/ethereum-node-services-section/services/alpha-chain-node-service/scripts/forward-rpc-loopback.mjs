#!/usr/bin/env node
// forward-rpc-loopback — one bounded TCP forwarder from the loopback RPC
// coordinate every existing consumer already dials (default 127.0.0.1:8561)
// to the node's explicit private-overlay RPC bind (default
// 100.125.205.105:8562).
//
// Why this exists: under WSL networkingMode=virtioproxy the JVM's loopback
// listeners wedge — Besu shows LISTEN on 127.0.0.1:8561/9545 but refuses or
// times out every connection, while its private-overlay p2p bind accepts.
// A Node.js loopback listener accepts normally, so the node binds RPC on the
// private-overlay address (see src/alpha-chain.mjs) and this forwarder keeps
// the settled 127.0.0.1:8561 contract alive unchanged.

import { createConnection, createServer } from "node:net";

function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (typeof value !== "string" || value.length === 0) throw new Error(`${name} is required`);
  return value;
}

const listenHost = required("RPC_FORWARD_LISTEN_HOST", "127.0.0.1");
const listenPort = Number(required("RPC_FORWARD_LISTEN_PORT", "8561"));
const upstreamHost = required("RPC_FORWARD_UPSTREAM_HOST", "100.125.205.105");
const upstreamPort = Number(required("RPC_FORWARD_UPSTREAM_PORT", "8562"));
if (!Number.isInteger(listenPort) || !Number.isInteger(upstreamPort)) {
  throw new Error("forwarder ports must be integers");
}

const server = createServer((downstream) => {
  const upstream = createConnection({ host: upstreamHost, port: upstreamPort });
  const close = () => { downstream.destroy(); upstream.destroy(); };
  downstream.on("error", close);
  upstream.on("error", close);
  upstream.once("connect", () => {
    downstream.pipe(upstream);
    upstream.pipe(downstream);
  });
});
server.on("error", (error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exit(1);
});
server.listen(listenPort, listenHost, () => {
  process.stdout.write(JSON.stringify({
    type: "AlphaChainRpcLoopbackForwardListening",
    listen: `${listenHost}:${listenPort}`,
    upstream: `${upstreamHost}:${upstreamPort}`,
  }) + "\n");
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { server.close(); process.exit(0); });

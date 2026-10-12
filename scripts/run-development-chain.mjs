#!/usr/bin/env node

import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { argument as option } from "@red-cup-engineering/javascript-node-services-section/argv";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const chainId = option("--chain-id") ?? "31337";
const port = option("--port") ?? "8545";
const stateInterval = option("--state-interval");
const state = resolve(option("--state") ?? resolve(ROOT, "data", "state", "development-chain-state", `eip155-${chainId}.json`));
if (![chainId, port].every((value) => /^[1-9][0-9]*$/u.test(value)) || (stateInterval !== undefined && !/^[1-9][0-9]*$/u.test(stateInterval))) throw new Error("chain id, port, and optional state interval must be positive decimal integers");
mkdirSync(dirname(state), { recursive: true });

const args = [
  "--quiet",
  "--host", "127.0.0.1",
  "--port", port,
  "--chain-id", chainId,
  "--hardfork", "cancun",
  "--state", state,
];
if (stateInterval !== undefined) args.push("--state-interval", stateInterval);
const child = spawn("anvil", args, { stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code, signal) => process.exit(signal ? 128 : (code ?? 1)));

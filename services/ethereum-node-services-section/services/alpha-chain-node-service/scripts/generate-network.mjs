#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

import {
  assertPrivateOutputPath,
  qbftConfiguration,
} from "../src/alpha-chain.mjs";

function option(name) {
  const at = process.argv.indexOf(name);
  const value = at < 0 ? undefined : process.argv[at + 1];
  if (typeof value !== "string" || value.length === 0) throw new Error(`${name} is required`);
  return value;
}

function options(name) {
  const values = [];
  for (let at = process.argv.indexOf(name); at !== -1; at = process.argv.indexOf(name, at + 1)) {
    const value = process.argv[at + 1];
    if (typeof value !== "string" || value.length === 0) throw new Error(`${name} requires one EVM address`);
    values.push(value);
  }
  return values;
}

const repositoryRoot = resolve(option("--repository-root"));
const outputPath = assertPrivateOutputPath({
  outputPath: resolve(option("--output")),
  repositoryRoot,
});
const besu = resolve(option("--besu"));
await mkdir(outputPath, { recursive: false, mode: 0o700 });
const configPath = resolve(outputPath, "qbft-config.json");
await writeFile(
  configPath,
  `${JSON.stringify(qbftConfiguration({
    treasuryAddress: option("--treasury-address"),
    bootstrapAddresses: options("--bootstrap-address"),
  }), null, 2)}\n`,
  { encoding: "utf8", mode: 0o600, flag: "wx" },
);

const child = spawn(besu, [
  "operator",
  "generate-blockchain-config",
  `--config-file=${configPath}`,
  `--to=${resolve(outputPath, "network")}`,
  "--private-key-file-name=key",
], { stdio: "inherit" });
const exitCode = await new Promise((accept, reject) => {
  child.once("error", reject);
  child.once("exit", (code) => accept(code ?? 1));
});
if (exitCode !== 0) throw new Error(`Besu genesis generation exited ${exitCode}`);
process.stdout.write(`${resolve(outputPath, "network", "genesis.json")}\n`);

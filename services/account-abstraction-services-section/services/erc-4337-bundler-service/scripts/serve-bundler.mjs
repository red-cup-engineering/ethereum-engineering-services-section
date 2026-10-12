#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { decryptKeystoreJson, isKeystoreJson } from "ethers";

const require = createRequire(import.meta.url);
const ALTO = join(dirname(require.resolve("@pimlico/alto")), "cli", "alto.js");

function option(name, fallback) {
  const at = process.argv.indexOf(name);
  return at === -1 ? fallback : process.argv[at + 1];
}

function required(name) {
  const value = option(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function privateFile(path, label) {
  const mode = statSync(path).mode & 0o777;
  if ((mode & 0o077) !== 0) throw new Error(`${label} must not be readable or writable by group or other users`);
}

const keystorePath = required("--keystore");
const passwordFile = required("--password-file");
privateFile(keystorePath, "bundler executor keystore");
privateFile(passwordFile, "bundler executor password file");
const keystore = readFileSync(keystorePath, "utf8");
if (!isKeystoreJson(keystore)) throw new Error("bundler executor must use Ethereum Secret Storage v3");
const passwordBuffer = readFileSync(passwordFile);
const password = passwordBuffer.toString("utf8").replace(/[\r\n]+$/u, "");
passwordBuffer.fill(0);
if (password.length < 16) throw new Error("bundler executor password must contain at least 16 characters");
const executor = await decryptKeystoreJson(keystore, password);
const safeMode = option("--safe-mode", "true");
if (safeMode !== "true" && safeMode !== "false") throw new Error("--safe-mode must be true or false");

const childEnvironment = { ...process.env };
for (const name of Object.keys(childEnvironment)) {
  if (name.startsWith("ALTO_") && name.includes("PRIVATE_KEY")) delete childEnvironment[name];
}
childEnvironment.ALTO_EXECUTOR_PRIVATE_KEYS = executor.privateKey;
childEnvironment.ALTO_UTILITY_PRIVATE_KEY = executor.privateKey;

const child = spawn(process.execPath, [
  ALTO,
  "--entrypoints", required("--entry-point"),
  "--rpc-url", required("--rpc-url"),
  "--port", option("--port", "4337"),
  "--safe-mode", safeMode,
  "--flush-stuck-transactions-during-startup", "true",
  "--refilling-wallets", "false",
  "--utility-wallet-monitor", "false",
  "--max-resubmits", "1",
  "--bundle-mode", "auto",
  "--block-time", option("--block-time", "1000"),
  "--log-level", option("--log-level", "warn"),
], { env: childEnvironment, stdio: "inherit" });

delete childEnvironment.ALTO_EXECUTOR_PRIVATE_KEYS;
delete childEnvironment.ALTO_UTILITY_PRIVATE_KEY;

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code, signal) => {
  process.exitCode = signal ? 1 : (code ?? 1);
});

#!/usr/bin/env node
import { readFile, rename, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { createFileAuthorizationConsumer, createFileConsumedAuthorizationConfirmer, createOperatorAdapter, launchAnchoredAnvil, readDotEnv, resolveNamedEnvironment } from "../src/operator-adapter.mjs";
import { executeDeleverage, resumeDeleverage, simulateDeleverage } from "../src/base-btc-deleverage-execution.mjs";

const option = (flag) => { const index = process.argv.indexOf(flag); return index < 0 ? undefined : process.argv[index + 1]; };
const cardPath = option("--card"), authorizationPath = option("--authorization"), dotenvPath = option("--env-file") ?? ".env";
if (!cardPath || !authorizationPath) throw new Error("usage: base-btc-deleverage-operator --card CARD.json --authorization AUTH.json [--env-file .env] [--broadcast] [--resume]");
const dotenv = await readDotEnv(resolve(dotenvPath), readFile); const card = JSON.parse(await readFile(resolve(cardPath), "utf8")); const authorization = JSON.parse(await readFile(resolve(authorizationPath), "utf8"));
const broadcast = process.argv.includes("--broadcast");
const envNames = { rpcUrl: option("--rpc-env") ?? "BASE_BTC_RPC_URL", sourceSigner: option("--source-signer-env") ?? "BASE_BTC_SOURCE_SIGNER", targetSigner: option("--target-signer-env") ?? "BASE_BTC_TARGET_SIGNER" };
if (broadcast) {
  if (!card?.actionId || !authorization?.authorizationId || authorization.actionId !== card.actionId) throw new Error("broadcast requires a bound card and authorization");
  const adapter = createOperatorAdapter({ dotenv, consumeAuthorization: createFileAuthorizationConsumer({ authorizationPath: resolve(authorizationPath), authorization, stat, rename }), confirmConsumedAuthorization: createFileConsumedAuthorizationConfirmer({ consumedPath: resolve(authorizationPath), authorization, readFile }), envNames });
  const result = process.argv.includes("--resume") ? await resumeDeleverage(card, authorization, adapter) : await executeDeleverage(card, authorization, adapter); process.stdout.write(`${JSON.stringify({ actualRepay: result.actualRepay.toString(), cumulativeGas: result.cumulativeGas.toString(), feeWei: result.feeWei.toString() })}\n`);
} else {
  const values = resolveNamedEnvironment(envNames, process.env, dotenv); const fork = await launchAnchoredAnvil({ card, forkUrl: values.rpcUrl });
  try { const adapter = createOperatorAdapter({ dotenv, provider: fork.provider, envNames }); const result = await simulateDeleverage(card, authorization, { fork: adapter.fork }); process.stdout.write(`${JSON.stringify({ simulated: true, actualRepay: result.actualRepay.toString(), cumulativeGas: result.cumulativeGas.toString(), feeWei: result.feeWei.toString() })}\n`); } finally { await fork.cleanup(); }
}

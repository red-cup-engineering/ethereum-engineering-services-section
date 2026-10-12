import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const INDUCTION_SCRIPT = join(ROOT, "scripts/induce-semiotic-exchange-chain-evm-face.mjs");
const ENTRY_POINT = "0x4337084d9e255ff0702461cf8895ce9e3b5ff108";
const targets = [
  "services/semiotic-exchange-chain-services-section/lib/legacy/SemioticExchange.sol:SemioticExchange",
  "src/EnterpriseAccount.sol:EnterpriseAccountFactory",
  "src/CommittedChuSquareVerifier.sol:CommittedChuSquareVerifier",
  "src/FourMixConsensusProfile.sol:FourMixConsensusProfile",
  "src/TypedCommitmentProjection.sol:TypedCommitmentProjection",
  "services/smart-contract-services-section/services/onchain-data-resource-service/src/OnchainDataResource.sol:OnchainDataResource",
];

function hash(number) { return `0x${number.toString(16).padStart(64, "0")}`; }
function address(number) { return `0x${number.toString(16).padStart(40, "0")}`; }

async function listen(server) {
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  return `http://127.0.0.1:${server.address().port}`;
}

function executable(path, source) {
  writeFileSync(path, `#!/usr/bin/env node\n${source}`);
  chmodSync(path, 0o755);
}

async function run(command, args, options) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, options);
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code, signal) => resolveRun({ code, signal, stdout, stderr }));
  });
}

test("fresh deployment process serializes every standard behind receipt and code observation", async () => {
  const root = mkdtempSync(join(tmpdir(), "union-deployment-serialization-"));
  const bin = join(root, "bin");
  const state = { completed: 0, started: [], pending: new Map(), failure: null };
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const call = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const answer = (result, error) => response.end(JSON.stringify({ jsonrpc: "2.0", id: call.id, ...(error ? { error: { code: -32000, message: error } } : { result }) }));
    const [argument] = call.params ?? [];
    if (call.method === "eth_chainId") return answer("0x539");
    if (call.method === "test_forgeStarted") {
      const target = argument;
      if (state.completed !== state.started.length + 1) {
        state.failure = `forge started ${target} before prior receipt and code were both observed`;
        return answer(null, state.failure);
      }
      state.started.push(target);
      const transactionHash = hash(state.started.length + 1);
      state.pending.set(transactionHash, { address: address(state.started.length), receiptObserved: false, codeObserved: false });
      return answer(true);
    }
    if (call.method === "eth_sendRawTransaction") {
      const transactionHash = hash(1);
      state.pending.set(transactionHash, { address: ENTRY_POINT, receiptObserved: false, codeObserved: false });
      return answer(transactionHash);
    }
    if (call.method === "eth_getTransactionReceipt") {
      const pending = state.pending.get(argument);
      if (!pending) return answer(null);
      pending.receiptObserved = true;
      return answer({ transactionHash: argument, status: "0x1", contractAddress: pending.address });
    }
    if (call.method === "eth_getCode") {
      const pending = [...state.pending.values()].find((candidate) => candidate.address.toLowerCase() === String(argument).toLowerCase());
      if (!pending) return answer("0x");
      if (!pending.receiptObserved) {
        state.failure = `code read before receipt for ${argument}`;
        return answer(null, state.failure);
      }
      if (!pending.codeObserved) {
        pending.codeObserved = true;
        state.completed += 1;
      }
      return answer("0x60006000");
    }
    return answer(null, `unexpected RPC method ${call.method}`);
  });
  const rpcUrl = await listen(server);
  try {
    const forge = join(bin, "forge"), cast = join(bin, "cast");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(bin));
    executable(forge, `
const args = process.argv.slice(2); const target = args[1]; const url = args[args.indexOf("--rpc-url") + 1];
const rpc = async (method, params) => { const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }); const body = await response.json(); if (body.error) throw new Error(body.error.message); return body.result; };
try { await rpc("test_forgeStarted", [target]); const index = ${JSON.stringify(targets)}.indexOf(target) + 1; console.log(JSON.stringify({ transactionHash: "0x" + (index + 1).toString(16).padStart(64, "0"), deployedTo: "0x" + index.toString(16).padStart(40, "0"), deployer: "0x" + "a".repeat(40) })); } catch (error) { console.error(error.message); process.exitCode = 1; }
`);
    executable(cast, `
const args = process.argv.slice(2); if (args[0] !== "send") process.exit(2); console.log(JSON.stringify({ status: "0x1", transactionHash: "0x" + "f".repeat(64) }));
`);
    const deployment = await run(process.execPath, [INDUCTION_SCRIPT, "--rpc-url", rpcUrl, "--expected-chain-id", "eip155:1337", "--unlocked-from", "0x1111111111111111111111111111111111111111", "--resource-write-price", "1", "--resource-fee-recipient", "0x2222222222222222222222222222222222222222"], {
      cwd: ROOT, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, stdio: ["ignore", "pipe", "pipe"],
    });
    assert.equal(deployment.code, 0, deployment.stderr || deployment.stdout);
    assert.equal(state.failure, null);
    assert.deepEqual(state.started, targets);
    assert.equal(state.completed, 7);
    const receipt = JSON.parse(deployment.stdout);
    assert.equal(receipt.type, "SemioticEvmFaceInduction");
    assert.deepEqual(receipt.deployments.map((entry) => entry.role), ["account-abstraction-entry-point", "modeled-union-dimension-exchange", "sovereign-settlement-account-factory", "four-admission-verifier", "four-consensus-admission", "typed-provenance-commitment-projection", "onchain-content-resource-residence"]);
    assert.equal(receipt.deployments.length, 7);
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
    rmSync(root, { recursive: true, force: true });
  }
});

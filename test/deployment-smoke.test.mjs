import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { censusEnterpriseWallets } from "../scripts/census-enterprise-wallets.mjs";
import { verifyLiveEnterpriseAccounts } from "../scripts/verify-live-enterprise-accounts.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FIRST_ANVIL_ACCOUNT = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";

async function availablePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}

async function rpc(url, method, params = []) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  });
  const body = await response.json();
  if (body.error) throw new Error(body.error.message);
  return body.result;
}

async function waitForRpc(url) {
  for (let attempt = 0; attempt < 100; ++attempt) {
    try { if (await rpc(url, "eth_chainId")) return; } catch { /* starting */ }
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error("Anvil did not become ready");
}

test("deploys the Union EVM standards to an isolated owned chain", async (context) => {
  const port = await availablePort();
  const rpcUrl = `http://127.0.0.1:${port}`;
  const state = join(mkdtempSync(join(tmpdir(), "union-evm-chain-")), "state.json");
  const anvil = spawn("anvil", [
    "--quiet", "--host", "127.0.0.1", "--port", String(port),
    "--chain-id", "31337", "--hardfork", "cancun", "--state", state
  ], { stdio: "ignore" });
  context.after(() => anvil.kill("SIGTERM"));
  await waitForRpc(rpcUrl);

  const deployment = spawnSync(process.execPath, [
    "scripts/induce-semiotic-exchange-chain-evm-face.mjs",
    "--rpc-url", rpcUrl,
    "--expected-chain-id", "eip155:31337",
    "--resource-write-price", "1",
    "--resource-fee-recipient", FIRST_ANVIL_ACCOUNT,
    "--unlocked-from", FIRST_ANVIL_ACCOUNT
  ], { cwd: ROOT, encoding: "utf8" });
  assert.equal(deployment.status, 0, deployment.stderr || deployment.stdout);
  const receipt = JSON.parse(deployment.stdout);
  const deploymentPath = join(dirname(state), "standards-deployment.json");
  writeFileSync(deploymentPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  assert.equal(receipt.chainId, "eip155:31337");
  assert.deepEqual(new Set(receipt.deployments.map(({ standard }) => standard)), new Set([
    "org.ethereum.erc-4337.entry-point.v0.8",
    "org.emsenn.semiotic-exchange-chain.v1",
    "org.emsenn.evm.sovereign-enterprise-account.v3",
    "org.emsenn.chu.four.strict-square.v1",
    "org.emsenn.four.lax-mix-consensus-admission.v2",
    "org.emsenn.evm.typed-commitment-projection.v1",
    "org.ethereum.erc-5219.onchain-data-resource.v1",
  ]));
  for (const deployed of receipt.deployments) {
    assert.match(deployed.address, /^0x[0-9a-fA-F]{40}$/u);
    assert.match(deployed.transactionHash, /^0x[0-9a-fA-F]{64}$/u);
    assert.notEqual(await rpc(rpcUrl, "eth_getCode", [deployed.address, "latest"]), "0x");
  }

  const entryPoint = receipt.deployments.find((entry) => entry.standard === "org.ethereum.erc-4337.entry-point.v0.8").address;
  const factory = receipt.deployments.find((entry) => entry.standard === "org.emsenn.evm.sovereign-enterprise-account.v3").address;
  assert.match(entryPoint, /^0x[0-9a-fA-F]{40}$/u);
  const enterpriseUrn = "urn:ame:smoke-enterprise";
  const enterpriseId = spawnSync("cast", ["keccak", enterpriseUrn], { encoding: "utf8" }).stdout.trim();
  const userSalt = `0x${"77".repeat(32)}`;
  const prediction = spawnSync("cast", [
    "call", factory,
    "accountAddress(bytes32,address,bytes32)(address)", enterpriseId, FIRST_ANVIL_ACCOUNT, userSalt,
    "--rpc-url", rpcUrl
  ], { encoding: "utf8" });
  assert.equal(prediction.status, 0, prediction.stderr);
  const account = prediction.stdout.trim().toLowerCase();
  assert.match(account, /^0x[0-9a-f]{40}$/u);

  const accountDeployment = spawnSync("cast", [
    "send", factory,
    "deploy(bytes32,address,bytes32)(address)", enterpriseId, FIRST_ANVIL_ACCOUNT, userSalt,
    "--rpc-url", rpcUrl, "--unlocked", "--from", FIRST_ANVIL_ACCOUNT, "--json"
  ], { encoding: "utf8" });
  assert.equal(accountDeployment.status, 0, accountDeployment.stderr || accountDeployment.stdout);
  const accountReceipt = JSON.parse(accountDeployment.stdout);

  const bindingWorkspace = mkdtempSync(join(tmpdir(), "enterprise-binding-workspace-"));
  const settlement = join(bindingWorkspace, "lib", "emsenn", "services", "smoke-enterprise");
  mkdirSync(settlement, { recursive: true });
  writeFileSync(join(settlement, "package.json"), `${JSON.stringify({
    name: "smoke-enterprise",
    "x-agentic-metro-enterprise": { "node-id": "smoke-enterprise", "organizational-kind": "micro-enterprise" }
  })}\n`, "utf8");
  const binding = spawnSync(process.execPath, [
    "services/account-abstraction-services-section/services/enterprise-account-provisioning-service/scripts/bind-enterprise-account.mjs",
    "--workspace", bindingWorkspace,
    "--settlement", settlement,
    "--urn", enterpriseUrn,
    "--account", account,
    "--factory", factory,
    "--policy-signer", FIRST_ANVIL_ACCOUNT,
    "--salt", userSalt,
    "--transaction", accountReceipt.transactionHash,
    "--rpc-url", rpcUrl
  ], { cwd: ROOT, encoding: "utf8" });
  assert.equal(binding.status, 0, binding.stderr || binding.stdout);
  assert.deepEqual(censusEnterpriseWallets(bindingWorkspace).counts, { total: 1, bound: 1, unbound: 0, invalid: 0 });
  assert.deepEqual((await verifyLiveEnterpriseAccounts({ workspace: bindingWorkspace, rpcUrl, deploymentPath })).counts, { settlements: 1, bindings: 1, verified: 1, failures: 0 });
});

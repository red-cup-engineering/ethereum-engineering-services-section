import assert from "node:assert/strict";
import { createPublicKey, verify } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createPolicyBoundPrivyAuthorizationSignFn,
  createPrivyAuthorizationKeyKeystore,
} from "../src/privy-authorization-key-custody.mjs";
import { semanticIdentity } from "../src/semantic-content.mjs";

const NOW = 1_782_000_000_000;
const WALLET_ID = "wallet_yanagi_operator";
const APP_ID = "cltsev9j90f67yhyw4sngtrpv";
const WALLET = "0x1111111111111111111111111111111111111111";
const CONTRACT = "0x69007702764179f14F51cdce752f4f775d74E139";

function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function payload(body, overrides = {}) {
  return new TextEncoder().encode(canonicalJson({
    version: 1,
    method: "POST",
    url: `https://api.privy.io/v1/wallets/${WALLET_ID}/rpc`,
    body,
    headers: { "privy-app-id": APP_ID },
    ...overrides,
  }));
}

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "privy-authorization-custody-"));
  const passwordFile = join(directory, "password");
  const path = join(directory, "authorization-key.json");
  writeFileSync(passwordFile, "test-only-privy-authorization-password\n", { mode: 0o600 });
  return { directory, passwordFile, path };
}

function policy(overrides = {}) {
  return {
    walletId: WALLET_ID,
    privyAppId: APP_ID,
    walletAddress: WALLET,
    allowedRpcMethods: ["personal_sign", "eth_signUserOperation", "eth_sign7702Authorization"],
    allowedChainIds: [8453],
    allowedContracts: [CONTRACT],
    personalSign: { messagePrefix: "acp-auth:", maxClockSkewMs: 60_000 },
    ...overrides,
  };
}

function userOperation(callData = "0x1234") {
  return {
    sender: WALLET,
    nonce: "0x0",
    call_data: callData,
    call_gas_limit: "0x1",
    verification_gas_limit: "0x2",
    pre_verification_gas: "0x3",
    max_fee_per_gas: "0x4",
    max_priority_fee_per_gas: "0x5",
    paymaster: "0x",
    paymaster_data: "0x",
  };
}

test("creates an encrypted P-256 PKCS8 keystore and returns only public material", async () => {
  const { path, passwordFile } = fixture();
  const created = createPrivyAuthorizationKeyKeystore({ path, passwordFile });
  assert.equal(created.format, "privy-p256-encrypted-pkcs8-v1");
  assert.equal(created.algorithm, "ECDSA_P256_SHA256");
  assert.equal(Object.hasOwn(created, "privateKey"), false);
  assert.match(created.keyId, /^ni:\/\/\/sha-256;/u);

  const stored = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(stored.privateKey.format, "pkcs8-encrypted");
  assert.equal(stored.privateKey.cipher, "aes-256-cbc");
  assert.doesNotMatch(readFileSync(path, "utf8"), /BEGIN (?:EC )?PRIVATE KEY/u);

  const signFn = createPolicyBoundPrivyAuthorizationSignFn({ path, passwordFile, policy: policy(), now: () => NOW });
  assert.equal(signFn.descriptor.keyId, created.keyId);
  const signedPayload = payload({
    method: "personal_sign",
    chain_type: "ethereum",
    params: { message: `acp-auth:${NOW}`, encoding: "utf-8" },
  });
  const signature = Buffer.from(await signFn(signedPayload), "base64");
  const publicKey = createPublicKey({ key: Buffer.from(created.publicKey, "base64"), format: "der", type: "spki" });
  assert.equal(verify("sha256", signedPayload, { key: publicKey, dsaEncoding: "der" }, signature), true);
});

test("refuses envelope changes before opening the private key", async () => {
  const { path, passwordFile } = fixture();
  createPrivyAuthorizationKeyKeystore({ path, passwordFile });
  const signFn = createPolicyBoundPrivyAuthorizationSignFn({ path, passwordFile, policy: policy(), now: () => NOW });
  chmodSync(passwordFile, 0o000);
  const body = { method: "personal_sign", chain_type: "ethereum", params: { message: `acp-auth:${NOW}`, encoding: "utf-8" } };
  await assert.rejects(signFn(payload(body, { url: "https://example.invalid/wallet/rpc" })), /request URL/u);
  await assert.rejects(signFn(new TextEncoder().encode(`${canonicalJson(JSON.parse(new TextDecoder().decode(payload(body))))}\n`)), /canonical JSON/u);
});

test("binds Base, sender, signing contract, call data, and callback signature ceiling", async () => {
  const { path, passwordFile } = fixture();
  createPrivyAuthorizationKeyKeystore({ path, passwordFile });
  const callData = "0x1234";
  const digest = semanticIdentity("ethereum.evm-call-data", { encoding: "hex", data: callData });
  const signFn = createPolicyBoundPrivyAuthorizationSignFn({
    path,
    passwordFile,
    policy: policy({ allowedRpcMethods: ["eth_signUserOperation"], allowedUserOperationCallDataDigests: [digest], maxSignatures: 1 }),
    now: () => NOW,
  });
  const body = {
    method: "eth_signUserOperation",
    chain_type: "ethereum",
    params: { chain_id: 8453, contract: CONTRACT, user_operation: userOperation(callData) },
  };
  assert.match(await signFn(payload(body)), /^[A-Za-z0-9+/]+={0,2}$/u);
  await assert.rejects(signFn(payload(body)), /signature limit is exhausted/u);

  const other = createPolicyBoundPrivyAuthorizationSignFn({
    path,
    passwordFile,
    policy: policy({ allowedRpcMethods: ["eth_signUserOperation"], allowedUserOperationCallDataDigests: [digest] }),
    now: () => NOW,
  });
  await assert.rejects(other(payload({ ...body, params: { ...body.params, chain_id: 1 } })), /refuses chain/u);
  await assert.rejects(other(payload({ ...body, params: { ...body.params, user_operation: userOperation("0xabcd") } })), /refuses the user operation call data/u);
  await assert.rejects(other(payload({ ...body, params: { ...body.params, user_operation: { ...userOperation(), sender: "0x2222222222222222222222222222222222222222" } } })), /refuses the user operation sender/u);
});

test("permits only the fixed EIP-7702 delegation and rejects loose credentials", async () => {
  const { path, passwordFile } = fixture();
  chmodSync(passwordFile, 0o644);
  assert.throws(() => createPrivyAuthorizationKeyKeystore({ path, passwordFile }), /group or other users/u);
  chmodSync(passwordFile, 0o600);
  createPrivyAuthorizationKeyKeystore({ path, passwordFile });
  const signFn = createPolicyBoundPrivyAuthorizationSignFn({
    path,
    passwordFile,
    policy: policy({ allowedRpcMethods: ["eth_sign7702Authorization"] }),
    now: () => NOW,
  });
  const authorized = {
    method: "eth_sign7702Authorization",
    chain_type: "ethereum",
    params: { contract: CONTRACT, chain_id: 8453 },
  };
  assert.match(await signFn(payload(authorized)), /^[A-Za-z0-9+/]+={0,2}$/u);
  await assert.rejects(signFn(payload({ ...authorized, params: { ...authorized.params, contract: "0x3333333333333333333333333333333333333333" } })), /refuses contract/u);
  await assert.rejects(signFn(payload({ method: "eth_signTransaction", chain_type: "ethereum", params: {} })), /refuses RPC method/u);
});

test("refuses a keystore whose public-key identity was altered", () => {
  const { path, passwordFile } = fixture();
  createPrivyAuthorizationKeyKeystore({ path, passwordFile });
  const stored = JSON.parse(readFileSync(path, "utf8"));
  stored.keyId = `ni:///sha-256;${"a".repeat(42)}A`;
  writeFileSync(path, `${JSON.stringify(stored)}\n`, { mode: 0o600 });
  assert.throws(() => createPolicyBoundPrivyAuthorizationSignFn({ path, passwordFile, policy: policy() }), /does not match its public key/u);
});

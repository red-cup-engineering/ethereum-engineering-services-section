import assert from "node:assert/strict";
import test from "node:test";
import { generateAccount, signMessage } from "@red-cup-engineering/cryptographic-computer-data-engineering-services-section/evm";
import { verifyEvmSignedMessage } from "../scripts/verify-evm-signed-message.mjs";

// Throwaway accounts generated fresh per test run through the house
// primitives — never a real key.
function siweMessage({ domain = "alpaca-assist.561.group", address, statement = "Sign in to Alpaca Assist.", uri = "https://alpaca-assist.561.group", chainId = 8453, nonce = "n0nce1234", issuedAt = "2026-09-05T12:00:00.000Z", expirationTime, notBefore, requestId, resources = [] } = {}) {
  const lines = [`${domain} wants you to sign in with your Ethereum account:`, address, ""];
  if (statement !== null) lines.push(statement, "");
  lines.push(`URI: ${uri}`, "Version: 1", `Chain ID: ${chainId}`, `Nonce: ${nonce}`, `Issued At: ${issuedAt}`);
  if (expirationTime) lines.push(`Expiration Time: ${expirationTime}`);
  if (notBefore) lines.push(`Not Before: ${notBefore}`);
  if (requestId) lines.push(`Request ID: ${requestId}`);
  if (resources.length > 0) lines.push("Resources:", ...resources.map((r) => `- ${r}`));
  return lines.join("\n");
}

function signed(account, overrides = {}) {
  const message = siweMessage({ address: account.address, ...overrides });
  const { signature } = signMessage(message, account.privateKey);
  return { message, signature };
}

test("verifies a message signed by the address it names and returns the parsed fields", () => {
  const account = generateAccount();
  const { message, signature } = signed(account, { expirationTime: "2026-09-05T12:10:00.000Z", requestId: "req-1", resources: ["https://alpaca-assist.561.group/api"] });
  const result = verifyEvmSignedMessage({ message, signature, expected: { domain: "alpaca-assist.561.group", nonce: "n0nce1234", chainId: 8453 }, now: "2026-09-05T12:05:00.000Z" });
  assert.equal(result.verified, true);
  assert.equal(result.address, account.address);
  assert.equal(result.domain, "alpaca-assist.561.group");
  assert.equal(result.chainId, 8453);
  assert.equal(result.nonce, "n0nce1234");
  assert.equal(result.requestId, "req-1");
  assert.deepEqual(result.resources, ["https://alpaca-assist.561.group/api"]);
  assert.equal(result.statement, "Sign in to Alpaca Assist.");
});

test("verifies a message without a statement or optional fields", () => {
  const account = generateAccount();
  const { message, signature } = signed(account, { statement: null });
  const result = verifyEvmSignedMessage({ message, signature, now: "2026-09-05T12:05:00.000Z" });
  assert.equal(result.verified, true);
  assert.equal(result.statement, null);
  assert.equal(result.expirationTime, null);
});

test("refuses a signature from a different account than the message names", () => {
  const account = generateAccount();
  const other = generateAccount();
  const message = siweMessage({ address: account.address });
  const { signature } = signMessage(message, other.privateKey);
  const result = verifyEvmSignedMessage({ message, signature, now: "2026-09-05T12:05:00.000Z" });
  assert.equal(result.verified, false);
  assert.match(result.reason, /not produced by the address/);
});

test("refuses a nonce the relying party did not issue", () => {
  const account = generateAccount();
  const { message, signature } = signed(account);
  const result = verifyEvmSignedMessage({ message, signature, expected: { nonce: "othernonce" }, now: "2026-09-05T12:05:00.000Z" });
  assert.equal(result.verified, false);
  assert.match(result.reason, /nonce/);
});

test("refuses a domain the relying party does not serve", () => {
  const account = generateAccount();
  const { message, signature } = signed(account);
  const result = verifyEvmSignedMessage({ message, signature, expected: { domain: "evil.example" }, now: "2026-09-05T12:05:00.000Z" });
  assert.equal(result.verified, false);
  assert.match(result.reason, /domain/);
});

test("refuses an expired message", () => {
  const account = generateAccount();
  const { message, signature } = signed(account, { expirationTime: "2026-09-05T12:10:00.000Z" });
  const result = verifyEvmSignedMessage({ message, signature, now: "2026-09-05T12:10:00.000Z" });
  assert.equal(result.verified, false);
  assert.match(result.reason, /expired/);
});

test("refuses a message before its Not Before", () => {
  const account = generateAccount();
  const { message, signature } = signed(account, { notBefore: "2026-09-05T13:00:00.000Z" });
  const result = verifyEvmSignedMessage({ message, signature, now: "2026-09-05T12:05:00.000Z" });
  assert.equal(result.verified, false);
  assert.match(result.reason, /not yet valid/);
});

test("refuses a message whose Version is not 1", () => {
  const account = generateAccount();
  const message = siweMessage({ address: account.address }).replace("Version: 1", "Version: 2");
  const { signature } = signMessage(message, account.privateKey);
  const result = verifyEvmSignedMessage({ message, signature });
  assert.equal(result.verified, false);
  assert.match(result.reason, /Version must be 1/);
});

test("refuses a short nonce", () => {
  const account = generateAccount();
  const message = siweMessage({ address: account.address, nonce: "abc" });
  const { signature } = signMessage(message, account.privateKey);
  const result = verifyEvmSignedMessage({ message, signature });
  assert.equal(result.verified, false);
  assert.match(result.reason, /Nonce/);
});

test("refuses a malformed signature before parsing anything", () => {
  const result = verifyEvmSignedMessage({ message: "hello", signature: "0xnothex" });
  assert.equal(result.verified, false);
  assert.match(result.reason, /130-hex-digit/);
});

test("refuses a message that is not an EIP-4361 message", () => {
  const account = generateAccount();
  const message = "please sign this";
  const { signature } = signMessage(message, account.privateKey);
  const result = verifyEvmSignedMessage({ message, signature });
  assert.equal(result.verified, false);
  assert.match(result.reason, /not a valid EIP-4361/);
});

test("refuses a non-object request", () => {
  const result = verifyEvmSignedMessage(null);
  assert.equal(result.verified, false);
  assert.match(result.reason, /JSON object/);
});

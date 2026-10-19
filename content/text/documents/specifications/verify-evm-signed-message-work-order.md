# verify-evm-signed-message
## Requirements
- `parses-an-eip-4361-message`: The operation parses the UTF-8 `message` as an EIP-4361 (Sign-In with Ethereum) message: the first line `<scheme://>?<domain> wants you to sign in with your Ethereum account:`, the address line, an optional statement paragraph, then the `URI:`, `Version:`, `Chain ID:`, `Nonce:`, `Issued At:` fields and the optional `Expiration Time:`, `Not Before:`, `Request ID:`, and `Resources:` (one `- <uri>` per line) fields, in that order, and refuses any message that does not have that exact shape or whose `Version` is not `{{siwe-message-version}}`.
- `recovers-the-signer-through-the-house-evm-primitives`: The operation computes the EIP-191 `personal_sign` digest of the exact message bytes with `hashPersonalMessage` and recovers the signer's EIP-55 checksummed address from the {{compact-signature-bytes}}-byte `signature` with `recoverAddress`, both from `@red-cup-engineering/computer-data-cryptography-services-section/src/evm.mjs`, then requires the recovered address to equal the message's address line (compared case-insensitively, reported checksummed).
- `checks-the-binding-the-caller-expects`: When `expected.domain`, `expected.nonce`, `expected.address`, `expected.chainId`, or `expected.uri` are given, the operation requires the parsed message's corresponding field to equal each, so a relying party binds the signature to the nonce it issued and the domain it serves.
- `checks-the-time-window`: The operation requires `Issued At`, `Expiration Time`, and `Not Before` to be `RFC 3339` timestamps when present, and requires `now` (a caller-supplied ISO timestamp, defaulting to the wall clock) to be at or after `Not Before` and strictly before `Expiration Time` when those are present.
- `json-in-json-out`: The operation is one function taking one JSON request object and returning one JSON response object, never throwing: either `{verified: true, address, domain, uri, chainId, nonce, issuedAt, expirationTime, notBefore, requestId, statement, resources}` or `{verified: false, reason}`.
## Prohibitions
- `no-second-crypto-implementation`: The operation must never reimplement keccak-256, secp256k1 recovery, or the EIP-55 checksum; it composes `@red-cup-engineering/computer-data-cryptography-services-section`'s exports exclusively. [claims: crypto-has-one-owner, dep-computer-data-cryptography-services-section]
- `no-network-and-no-keys`: The operation performs no network call and never accepts, reads, or transmits a private key; ERC-1271 contract-signature validation (which needs a chain read) is a separate operation, not this one. [claims: local-verification-needs-no-chain]
- `never-verified-on-a-mismatch`: The operation must return `{verified: false}` when the recovered address differs from the message's address, when any expected binding differs, when the time window is not satisfied, or when the message shape is wrong; `{verified: true}` is returned only when every check passes. [claims: verified-only-when-every-check-passes]
## Laws
- `primitives-exist-once` | 561 Group working discipline | 2026-08-30 | CLAUDE.md | Applies to this operation's whole cryptographic composition. | keccak-256, secp256k1, EIP-191 hashing, and EIP-55 checksumming live once in `@red-cup-engineering/computer-data-cryptography-services-section`; this operation composes those exports by exact pin rather than reimplementing them.
- `fabricate-do-not-hand-write` | 561 Group working discipline, dispatch-agents skill | 2026-09-04 | .claude/skills/dispatch-agents/SKILL.md | Applies to this whole operation source file. | The operation is born through the jsnode fabrication line from this work order, never hand-written.
- `standards-first` | 561 Group org layering, standards-first data and networking | 2026-09-04 | .claude/rules/org-layering.md | Applies to the login message format and the signature scheme. | An existing open standard (EIP-4361 over EIP-191) is used for wallet sign-in rather than a house challenge format.
## Standards
- `node-esm-operation` | Node.js | v24.2.0+ | https://nodejs.org/docs/v24/api/esm.html | Applies to the .mjs operation and its import.meta.main guard. | The package uses one executable ESM operation source file eligible for downstream staged package-birth assays.
- `eip-4361-sign-in-with-ethereum` | Ethereum Improvement Proposals | Final | https://eips.ethereum.org/EIPS/eip-4361 | Applies to the message grammar, the required and optional fields, and the verification steps. | EIP-4361 specifies the message as `${scheme}:// ${domain} wants you to sign in with your Ethereum account:` followed by the address, optional statement, and the `URI`, `Version` (must be `1`), `Chain ID`, `Nonce` (at least 8 alphanumeric characters), `Issued At`, and optional `Expiration Time`, `Not Before`, `Request ID`, `Resources` fields, signed with EIP-191 `personal_sign`; a relying party checks the signature, the domain, the nonce, and the time fields.
- `eip-191-signed-data` | Ethereum Improvement Proposals | Final | https://eips.ethereum.org/EIPS/eip-191 | Applies to the digest the signer produced and this operation recomputes. | `personal_sign` hashes `"\x19Ethereum Signed Message:\n" + len(message) + message` with keccak-256; `hashPersonalMessage` in the house cryptography package is exactly that.
- `eip-55-checksum-address` | Ethereum Improvement Proposals | Final | https://eips.ethereum.org/EIPS/eip-55 | Applies to how the recovered and expected addresses are compared and reported. | Addresses compare case-insensitively and are reported in mixed-case checksum form; `toChecksumAddress` and `recoverAddress` in the house cryptography package produce that form.
- `rfc-3339-timestamps` | IETF | RFC 3339 | https://www.rfc-editor.org/rfc/rfc3339 | Applies to `Issued At`, `Expiration Time`, and `Not Before`. | EIP-4361 requires these fields to be RFC 3339 date-times; the operation parses them with `Date.parse` and refuses a value that does not parse.
## Open questions
none
## Claims
- `dep-computer-data-cryptography-services-section` | measured | dependency | @red-cup-engineering/computer-data-cryptography-services-section@0.1.1 is published on the Group registry | none | data/records/2026-10-19-work-order-evidence/npm-view-red-cup-engineering-computer-data-cryptography-services-section-0-1-1.json | sha256:e7433dfdbec6bf00cb996abd896182eacc36094664ccce77d24740501dbffa05 | npm view of @red-cup-engineering/computer-data-cryptography-services-section@0.1.1 returned its name, version and integrity (2026-10-19)
- `compact-signature-bytes` | derived | parameter | A recoverable secp256k1 signature is 32 bytes of r, 32 bytes of s and one recovery byte | 65 bytes | citation:EIP-191 personal_sign signatures, r and s of 32 bytes each plus one recovery byte | 32 + 32 + 1 = 65
- `crypto-has-one-owner` | derived | world | keccak-256, secp256k1 recovery and the EIP-55 checksum have one owner, published at the exact version this order pins | none | constraint:primitives-exist-once; claim:dep-computer-data-cryptography-services-section | The law places the primitive once in its owner, and the pinned owner is on the registry, so composing it leaves nothing to reimplement and a second implementation is outside what the law permits
- `local-verification-needs-no-chain` | derived | world | Recovering a signer from an EOA signature is local arithmetic, and only ERC-1271 contract signatures need a chain read | none | requirement:recovers-the-signer-through-the-house-evm-primitives; constraint:eip-191-signed-data | The requirement recovers with the house primitives and no key, and the contract-signature case is a separate operation
- `verified-only-when-every-check-passes` | derived | world | Verified is true only when the recovery, the expected bindings and the time window all hold and the message parses | none | requirement:parses-an-eip-4361-message; requirement:checks-the-binding-the-caller-expects; requirement:checks-the-time-window | Each requirement is a check, and the response is verified only when none fails
- `siwe-message-version` | measured | parameter | EIP-4361 requires the Version field of a SIWE message to be 1 | 1 version | data/records/2026-10-19-work-order-evidence/erc-4361-ethereum-ercs-c4ee980.md | sha256:bf30a6e2cf0580d2cb0ded54b4436fb5a3d3ff6ae01b3e404c946780e6a4eb4c | ERC-4361 text at ethereum/ERCs commit c4ee980 (GET raw.githubusercontent.com returned HTTP 200): the ABNF gives version = "1" and the field definition reads "The current version of the SIWE Message, which MUST be 1 for this specification" (2026-10-19)
## Package
```json
{"packageName":"@red-cup-engineering/verify-evm-signed-message-service","packageVersion":"0.1.0","license":"MIT","dependencies":{"@red-cup-engineering/computer-data-cryptography-services-section":"0.1.1"},"devDependencies":{}}
```
## Operation
```mjs path=scripts/verify-evm-signed-message.mjs
#!/usr/bin/env node
// Verifies an EIP-4361 (Sign-In with Ethereum) message signed with EIP-191
// personal_sign: parses the message, recovers the signer through the house
// EVM primitives, and checks the address, the caller's expected bindings
// (domain, nonce, address, chain id, uri), and the time window. Pure
// compute: no network, no keys; ERC-1271 contract signatures are a
// separate operation.
import { hashPersonalMessage, recoverAddress, toChecksumAddress } from "@red-cup-engineering/computer-data-cryptography-services-section/src/evm.mjs";

const HEADER_PATTERN = /^(?:(?<scheme>[a-zA-Z][a-zA-Z0-9+.-]*):\/\/)?(?<domain>[^\s]+) wants you to sign in with your Ethereum account:$/u;
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/u;
const SIGNATURE_PATTERN = /^0x[0-9a-fA-F]{130}$/u;
const NONCE_PATTERN = /^[a-zA-Z0-9]{8,}$/u;
const FIELD_ORDER = ["URI", "Version", "Chain ID", "Nonce", "Issued At", "Expiration Time", "Not Before", "Request ID"];
const REQUIRED_FIELDS = new Set(["URI", "Version", "Chain ID", "Nonce", "Issued At"]);

function parseMessage(message) {
  const lines = message.split("\n");
  const header = HEADER_PATTERN.exec(lines[0] ?? "");
  if (!header) throw new Error("first line must be '<domain> wants you to sign in with your Ethereum account:'");
  const address = lines[1] ?? "";
  if (!ADDRESS_PATTERN.test(address)) throw new Error("second line must be a 0x-prefixed 40-hex-digit address");
  let index = 2;
  if (lines[index] !== "") throw new Error("an empty line must follow the address");
  index += 1;
  let statement = null;
  if (lines[index] !== "" && lines[index] !== undefined && !lines[index].startsWith("URI: ")) {
    statement = lines[index];
    index += 1;
    if (lines[index] !== "") throw new Error("an empty line must follow the statement");
    index += 1;
  } else if (lines[index] === "") {
    index += 1;
  }
  const fields = {};
  let order = 0;
  while (index < lines.length && lines[index] !== "Resources:" && lines[index] !== "") {
    const line = lines[index];
    const colon = line.indexOf(": ");
    if (colon < 0) throw new Error(`malformed field line: ${JSON.stringify(line)}`);
    const name = line.slice(0, colon);
    const position = FIELD_ORDER.indexOf(name);
    if (position < 0) throw new Error(`unknown field: ${name}`);
    if (position < order) throw new Error(`field out of order: ${name}`);
    order = position + 1;
    fields[name] = line.slice(colon + 2);
    index += 1;
  }
  const resources = [];
  if (lines[index] === "Resources:") {
    index += 1;
    while (index < lines.length && lines[index].startsWith("- ")) {
      resources.push(lines[index].slice(2));
      index += 1;
    }
  }
  if (index !== lines.length) throw new Error("unexpected trailing content after the fields");
  for (const name of REQUIRED_FIELDS) {
    if (!(name in fields)) throw new Error(`missing required field: ${name}`);
  }
  if (fields.Version !== "1") throw new Error("Version must be 1");
  if (!/^\d+$/u.test(fields["Chain ID"])) throw new Error("Chain ID must be an unsigned integer");
  if (!NONCE_PATTERN.test(fields.Nonce)) throw new Error("Nonce must be at least 8 alphanumeric characters");
  return {
    scheme: header.groups.scheme ?? null,
    domain: header.groups.domain,
    address,
    statement,
    uri: fields.URI,
    version: fields.Version,
    chainId: Number(fields["Chain ID"]),
    nonce: fields.Nonce,
    issuedAt: fields["Issued At"],
    expirationTime: fields["Expiration Time"] ?? null,
    notBefore: fields["Not Before"] ?? null,
    requestId: fields["Request ID"] ?? null,
    resources,
  };
}

function parseTimestamp(value, name) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new Error(`${name} must be an RFC 3339 timestamp`);
  return time;
}

function sameAddress(left, right) {
  return typeof left === "string" && typeof right === "string" && left.toLowerCase() === right.toLowerCase();
}

/**
 * Verifies an EIP-4361 Sign-In with Ethereum message signed with EIP-191
 * personal_sign: parses the message, recovers the signer through the house
 * EVM primitives, and checks the address, the expected bindings, and the
 * time window.
 * @param {object} request An EvmSignedMessageVerificationRequest.
 * @param {string} request.message The exact EIP-4361 message text that was signed.
 * @param {string} request.signature The 65-byte `personal_sign` signature as 0x-prefixed hex (r||s||v).
 * @param {{domain?: string, nonce?: string, address?: string, chainId?: number, uri?: string}} [request.expected] Bindings the relying party issued and requires the message to carry.
 * @param {string} [request.now] ISO timestamp for the time-window check; defaults to the wall clock.
 * @returns {{verified: true, address: string, domain: string, uri: string, chainId: number, nonce: string, issuedAt: string, expirationTime: string|null, notBefore: string|null, requestId: string|null, statement: string|null, resources: string[]} | {verified: false, reason: string}}
 */
export function verifyEvmSignedMessage(request) {
  try {
    if (request === null || typeof request !== "object" || Array.isArray(request)) {
      return { verified: false, reason: "request must be a JSON object" };
    }
    const { message, signature, expected = {}, now } = request;
    if (typeof message !== "string" || message.length === 0) {
      return { verified: false, reason: "message must be a non-empty string" };
    }
    if (typeof signature !== "string" || !SIGNATURE_PATTERN.test(signature)) {
      return { verified: false, reason: "signature must be a 0x-prefixed 130-hex-digit EIP-191 signature" };
    }
    let parsed;
    try {
      parsed = parseMessage(message);
    } catch (error) {
      return { verified: false, reason: `message is not a valid EIP-4361 message: ${error.message}` };
    }
    let recovered;
    try {
      recovered = recoverAddress(hashPersonalMessage(message), signature);
    } catch (error) {
      return { verified: false, reason: `could not recover a signer from the signature: ${error.message}` };
    }
    if (!sameAddress(recovered, parsed.address)) {
      return { verified: false, reason: "signature was not produced by the address named in the message" };
    }
    if (expected.domain !== undefined && expected.domain !== parsed.domain) {
      return { verified: false, reason: "message domain does not match the expected domain" };
    }
    if (expected.nonce !== undefined && expected.nonce !== parsed.nonce) {
      return { verified: false, reason: "message nonce does not match the expected nonce" };
    }
    if (expected.address !== undefined && !sameAddress(expected.address, parsed.address)) {
      return { verified: false, reason: "message address does not match the expected address" };
    }
    if (expected.chainId !== undefined && Number(expected.chainId) !== parsed.chainId) {
      return { verified: false, reason: "message chain id does not match the expected chain id" };
    }
    if (expected.uri !== undefined && expected.uri !== parsed.uri) {
      return { verified: false, reason: "message uri does not match the expected uri" };
    }
    const at = now === undefined ? Date.now() : parseTimestamp(now, "now");
    parseTimestamp(parsed.issuedAt, "Issued At");
    if (parsed.notBefore !== null && at < parseTimestamp(parsed.notBefore, "Not Before")) {
      return { verified: false, reason: "message is not yet valid (Not Before is in the future)" };
    }
    if (parsed.expirationTime !== null && at >= parseTimestamp(parsed.expirationTime, "Expiration Time")) {
      return { verified: false, reason: "message has expired" };
    }
    return {
      verified: true,
      address: toChecksumAddress(parsed.address),
      domain: parsed.domain,
      uri: parsed.uri,
      chainId: parsed.chainId,
      nonce: parsed.nonce,
      issuedAt: parsed.issuedAt,
      expirationTime: parsed.expirationTime,
      notBefore: parsed.notBefore,
      requestId: parsed.requestId,
      statement: parsed.statement,
      resources: parsed.resources,
    };
  } catch (error) {
    return { verified: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

if (import.meta.main) {
  if (process.argv.includes("--help")) {
    process.stdout.write(
      "verifyEvmSignedMessage — Verifies an EIP-4361 Sign-In with Ethereum message signed with EIP-191 personal_sign: parses the message, recovers the signer through the house EVM primitives, and checks the address, the expected bindings, and the time window.\n",
    );
  } else {
    let text = "";
    for await (const chunk of process.stdin) text += chunk;
    for (const line of text.split("\n")) {
      if (line.length > 0) process.stdout.write(`${JSON.stringify(verifyEvmSignedMessage(JSON.parse(line)))}\n`);
    }
  }
}
```
## Tests
```mjs path=test/verify-evm-signed-message.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { generateAccount, signMessage } from "@red-cup-engineering/computer-data-cryptography-services-section/src/evm.mjs";
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
```
## Examples
```json name="a malformed signature is refused before the message is parsed"
{"input":{"message":"hello","signature":"0xnothex"},"output":{"verified":false,"reason":"signature must be a 0x-prefixed 130-hex-digit EIP-191 signature"}}
```
```json name="a non-object request is refused"
{"input":null,"output":{"verified":false,"reason":"request must be a JSON object"}}
```
## Traceability
- `parses-an-eip-4361-message` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `eip-4361-sign-in-with-ethereum`, `rfc-3339-timestamps`
- `recovers-the-signer-through-the-house-evm-primitives` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `eip-191-signed-data`, `eip-55-checksum-address`, `primitives-exist-once`
- `checks-the-binding-the-caller-expects` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `eip-4361-sign-in-with-ethereum`
- `checks-the-time-window` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `eip-4361-sign-in-with-ethereum`, `rfc-3339-timestamps`
- `json-in-json-out` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `node-esm-operation`
- `no-second-crypto-implementation` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `primitives-exist-once`
- `no-network-and-no-keys` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `standards-first`
- `never-verified-on-a-mismatch` -> projection `jsnode-operation-package`; acceptance `jsnode-package-assays`; constraints `eip-4361-sign-in-with-ethereum`, `fabricate-do-not-hand-write`

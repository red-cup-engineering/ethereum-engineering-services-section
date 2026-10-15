#!/usr/bin/env node
// Verifies an EIP-4361 (Sign-In with Ethereum) message signed with EIP-191
// personal_sign: parses the message, recovers the signer through the house
// EVM primitives, and checks the address, the caller's expected bindings
// (domain, nonce, address, chain id, uri), and the time window. Pure
// compute: no network, no keys; ERC-1271 contract signatures are a
// separate operation.
import { hashPersonalMessage, recoverAddress, toChecksumAddress } from "@red-cup-engineering/cryptographic-computer-data-engineering-services-section/evm";
import { runJavascriptNodeOperation } from "@red-cup-engineering/javascript-node-operation-engineering-services-section/operation";

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
  const result = await runJavascriptNodeOperation({ name: "verify-evm-signed-message", description: "Verifies an EIP-4361 Sign-In with Ethereum message signed with EIP-191 personal_sign: parses the message, recovers the signer through the house EVM primitives, and checks the address, the expected bindings, and the time window.", operation: verifyEvmSignedMessage }, { arguments: process.argv.slice(2), standardInput: process.stdin, standardOutput: process.stdout });
  process.exitCode = result.exitCode;
}

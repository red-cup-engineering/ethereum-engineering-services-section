import { semanticIdentity } from "./semantic-content.mjs";
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  timingSafeEqual,
} from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { createUserOperationAuthorizationPolicy } from "./user-operation-authorization-policy.mjs";

const FORMAT = "privy-p256-encrypted-pkcs8-v1";
const TYPE = "urn:emsenn:ethereum-services-section:privy-authorization-key-keystore";
const ALGORITHM = "ECDSA_P256_SHA256";
const DEFAULT_MAX_PAYLOAD_BYTES = 65_536;
const HEX_ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const HEX_BYTES = /^0x(?:[0-9a-fA-F]{2})*$/u;
const HEX_QUANTITY = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/u;
const SAFE_IDENTIFIER = /^[A-Za-z0-9._:-]{1,160}$/u;

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requirePlainObject(value, label) {
  if (!isPlainObject(value)) throw new Error(`${label} must be a plain object`);
  return value;
}

function requireExactKeys(value, required, optional, label) {
  const actual = Object.keys(requirePlainObject(value, label)).sort();
  const allowed = new Set([...required, ...optional]);
  for (const key of required) if (!Object.hasOwn(value, key)) throw new Error(`${label} is missing ${key}`);
  for (const key of actual) if (!allowed.has(key)) throw new Error(`${label} contains unsupported field ${key}`);
}

function requirePrivateRegularFile(path, label) {
  const stat = statSync(path);
  if (!stat.isFile()) throw new Error(`${label} must be a regular file`);
  if ((stat.mode & 0o077) !== 0) throw new Error(`${label} must not be readable or writable by group or other users`);
}

function readPassword(path) {
  requirePrivateRegularFile(path, "authorization-key password file");
  let password = readFileSync(path);
  try {
    if (password.length > 4_096) throw new Error("authorization-key password must not exceed 4096 bytes");
    while (password.length > 0 && (password.at(-1) === 0x0a || password.at(-1) === 0x0d)) {
      password.subarray(password.length - 1).fill(0);
      password = password.subarray(0, password.length - 1);
    }
    if (password.length < 16) throw new Error("authorization-key password must contain at least 16 bytes");
    if (password.includes(0)) throw new Error("authorization-key password must not contain NUL bytes");
    return password;
  } catch (error) {
    password.fill(0);
    throw error;
  }
}

function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("authorization payload contains a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  throw new Error("authorization payload contains a non-JSON value");
}


function decodeBase64(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(value)) {
    throw new Error(`${label} is not canonical base64`);
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) {
    bytes.fill(0);
    throw new Error(`${label} is not canonical base64`);
  }
  return bytes;
}

function requireIdentifier(value, label) {
  if (typeof value !== "string" || !SAFE_IDENTIFIER.test(value)) throw new Error(`${label} is invalid`);
  return value;
}

function normalizeAddress(value, label) {
  if (typeof value !== "string" || !HEX_ADDRESS.test(value)) throw new Error(`${label} must be an EVM address`);
  return value.toLowerCase();
}

function normalizeIntegerSet(values, label) {
  if (!Array.isArray(values) || values.length === 0) throw new Error(`${label} must be a nonempty array`);
  const normalized = values.map((value) => {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must contain positive safe integers`);
    return value;
  });
  return new Set(normalized);
}

function normalizeAddressSet(values, label) {
  if (!Array.isArray(values) || values.length === 0) throw new Error(`${label} must be a nonempty array`);
  return new Set(values.map((value) => normalizeAddress(value, label)));
}

function normalizeDigestSet(values, label) {
  if (values === undefined) return null;
  if (!Array.isArray(values) || values.length === 0) throw new Error(`${label} must be a nonempty array when present`);
  return new Set(values.map((value) => {
    if (typeof value !== "string" || !/^ni:\/\/\/sha-256;[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u.test(value)) {
      throw new Error(`${label} must contain SHA-256 ni URIs`);
    }
    return value;
  }));
}

function normalizePolicy(policy) {
  requireExactKeys(policy,
    ["walletId", "privyAppId", "walletAddress", "allowedRpcMethods", "allowedChainIds", "allowedContracts"],
    ["personalSign", "allowedUserOperationCallDataDigests", "expiresAt", "maxPayloadBytes", "maxSignatures"],
    "authorization policy");
  const supported = new Set(["personal_sign", "eth_signUserOperation", "eth_sign7702Authorization"]);
  if (!Array.isArray(policy.allowedRpcMethods) || policy.allowedRpcMethods.length === 0) {
    throw new Error("authorization policy allowedRpcMethods must be a nonempty array");
  }
  for (const method of policy.allowedRpcMethods) if (!supported.has(method)) throw new Error(`authorization policy refuses RPC method ${method}`);
  const personalSign = policy.personalSign === undefined ? null : requirePlainObject(policy.personalSign, "personalSign policy");
  if (personalSign) {
    requireExactKeys(personalSign, ["messagePrefix", "maxClockSkewMs"], [], "personalSign policy");
    if (typeof personalSign.messagePrefix !== "string" || personalSign.messagePrefix.length < 1 || personalSign.messagePrefix.length > 128) {
      throw new Error("personalSign messagePrefix is invalid");
    }
    if (!Number.isSafeInteger(personalSign.maxClockSkewMs) || personalSign.maxClockSkewMs < 0 || personalSign.maxClockSkewMs > 600_000) {
      throw new Error("personalSign maxClockSkewMs must be between zero and 600000");
    }
  }
  if (policy.allowedRpcMethods.includes("personal_sign") && !personalSign) {
    throw new Error("personal_sign requires a personalSign policy");
  }
  const expiresAt = policy.expiresAt === undefined ? null : Date.parse(policy.expiresAt);
  if (policy.expiresAt !== undefined && !Number.isFinite(expiresAt)) throw new Error("authorization policy expiresAt is invalid");
  const maxPayloadBytes = policy.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES;
  if (!Number.isSafeInteger(maxPayloadBytes) || maxPayloadBytes < 256 || maxPayloadBytes > 1_048_576) {
    throw new Error("authorization policy maxPayloadBytes is out of range");
  }
  const maxSignatures = policy.maxSignatures ?? null;
  if (maxSignatures !== null && (!Number.isSafeInteger(maxSignatures) || maxSignatures < 1 || maxSignatures > 1_000)) {
    throw new Error("authorization policy maxSignatures is out of range");
  }
  return Object.freeze({
    walletId: requireIdentifier(policy.walletId, "walletId"),
    privyAppId: requireIdentifier(policy.privyAppId, "privyAppId"),
    walletAddress: normalizeAddress(policy.walletAddress, "walletAddress"),
    allowedRpcMethods: new Set(policy.allowedRpcMethods),
    allowedChainIds: normalizeIntegerSet(policy.allowedChainIds, "allowedChainIds"),
    allowedContracts: normalizeAddressSet(policy.allowedContracts, "allowedContracts"),
    allowedUserOperationCallDataDigests: normalizeDigestSet(policy.allowedUserOperationCallDataDigests, "allowedUserOperationCallDataDigests"),
    personalSign,
    expiresAt,
    maxPayloadBytes,
    maxSignatures,
  });
}

function requireHex(value, label) {
  if (typeof value !== "string" || !HEX_BYTES.test(value)) throw new Error(`${label} must be even-length hexadecimal bytes`);
  return value.toLowerCase();
}

function requireHexQuantity(value, label) {
  if (typeof value !== "string" || !HEX_QUANTITY.test(value)) throw new Error(`${label} must be a canonical hexadecimal quantity`);
  return value.toLowerCase();
}

function requireAllowedChain(value, policy) {
  if (!Number.isSafeInteger(value) || !policy.allowedChainIds.has(value)) throw new Error(`authorization policy refuses chain ${value}`);
}

function requireAllowedContract(value, policy, label = "contract") {
  const address = normalizeAddress(value, label);
  if (!policy.allowedContracts.has(address)) throw new Error(`authorization policy refuses ${label} ${value}`);
}

function validatePersonalSign(body, policy, now) {
  requireExactKeys(body.params, ["message", "encoding"], [], "personal_sign params");
  if (body.params.encoding !== "utf-8") throw new Error("personal_sign encoding must be utf-8");
  const message = body.params.message;
  const prefix = policy.personalSign.messagePrefix;
  if (typeof message !== "string" || !message.startsWith(prefix)) throw new Error("personal_sign message has the wrong prefix");
  const timestampText = message.slice(prefix.length);
  if (!/^(?:0|[1-9][0-9]*)$/u.test(timestampText)) throw new Error("personal_sign message must end in a millisecond timestamp");
  const timestamp = Number(timestampText);
  if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > policy.personalSign.maxClockSkewMs) {
    throw new Error("personal_sign timestamp is outside the authorized clock window");
  }
}

function validateUserOperation(body, policy) {
  requireExactKeys(body.params, ["chain_id", "contract", "user_operation"], [], "eth_signUserOperation params");
  // Provider-neutral policy below owns the complete UserOperation grammar and bounds.
}

function validateAuthorization(body, policy) {
  requireExactKeys(body.params, ["contract", "chain_id"], ["nonce"], "eth_sign7702Authorization params");
  requireAllowedChain(body.params.chain_id, policy);
  requireAllowedContract(body.params.contract, policy);
  if (body.params.nonce !== undefined && (!Number.isSafeInteger(body.params.nonce) || body.params.nonce < 0)) {
    throw new Error("authorization nonce must be a nonnegative safe integer");
  }
}

function validatePayload(payload, policy, now) {
  if (!(payload instanceof Uint8Array)) throw new Error("authorization payload must be Uint8Array bytes");
  if (payload.byteLength === 0 || payload.byteLength > policy.maxPayloadBytes) throw new Error("authorization payload size is refused");
  const bytes = Buffer.from(payload);
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } finally {
    bytes.fill(0);
  }
  let input;
  try {
    input = JSON.parse(text);
  } catch {
    throw new Error("authorization payload must be valid JSON");
  }
  if (canonicalJson(input) !== text) throw new Error("authorization payload must use canonical JSON");
  requireExactKeys(input, ["version", "method", "url", "body", "headers"], [], "authorization payload");
  if (input.version !== 1 || input.method !== "POST") throw new Error("authorization payload has an unsupported request envelope");
  if (input.url !== `https://api.privy.io/v1/wallets/${policy.walletId}/rpc`) throw new Error("authorization policy refuses the request URL");
  requireExactKeys(input.headers, ["privy-app-id"], [], "authorization headers");
  if (input.headers["privy-app-id"] !== policy.privyAppId) throw new Error("authorization policy refuses the Privy app ID");
  requireExactKeys(input.body, ["method", "chain_type", "params"], [], "authorization RPC body");
  if (input.body.chain_type !== "ethereum" || !policy.allowedRpcMethods.has(input.body.method)) {
    throw new Error(`authorization policy refuses RPC method ${input.body.method}`);
  }
  if (input.body.method === "personal_sign") validatePersonalSign(input.body, policy, now);
  else if (input.body.method === "eth_signUserOperation") validateUserOperation(input.body, policy);
  else validateAuthorization(input.body, policy);
  return input.body.method;
}

function parseKeystore(path) {
  requirePrivateRegularFile(path, "Privy authorization keystore");
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error("Privy authorization keystore is not valid JSON");
  }
  requireExactKeys(parsed, ["type", "version", "format", "algorithm", "keyId", "publicKey", "privateKey"], [], "Privy authorization keystore");
  if (parsed.type !== TYPE || parsed.version !== 1 || parsed.format !== FORMAT || parsed.algorithm !== ALGORITHM) {
    throw new Error("Privy authorization keystore has an unsupported format");
  }
  requireExactKeys(parsed.publicKey, ["format", "encoding", "data"], [], "public key record");
  requireExactKeys(parsed.privateKey, ["format", "encoding", "cipher", "data"], [], "private key record");
  if (parsed.publicKey.format !== "spki" || parsed.publicKey.encoding !== "base64") throw new Error("Privy authorization public key format is invalid");
  if (parsed.privateKey.format !== "pkcs8-encrypted" || parsed.privateKey.encoding !== "base64" || parsed.privateKey.cipher !== "aes-256-cbc") {
    throw new Error("Privy authorization private key format is invalid");
  }
  if (!/^ni:\/\/\/sha-256;[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u.test(parsed.keyId)) throw new Error("Privy authorization keyId is invalid");
  const publicDer = decodeBase64(parsed.publicKey.data, "public key");
  try {
    const actualKeyId = semanticIdentity("ethereum.privy-p256-public-key", { encoding: "base64", data: publicDer.toString("base64") });
    if (actualKeyId !== parsed.keyId) throw new Error("Privy authorization keyId does not match its public key");
  } finally {
    publicDer.fill(0);
  }
  return parsed;
}

export function createPrivyAuthorizationKeyKeystore({ path, passwordFile }) {
  const password = readPassword(passwordFile);
  let encryptedPrivateDer;
  let publicDer;
  try {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    encryptedPrivateDer = privateKey.export({
      format: "der",
      type: "pkcs8",
      cipher: "aes-256-cbc",
      passphrase: password,
    });
    publicDer = publicKey.export({ format: "der", type: "spki" });
    const keyId = semanticIdentity("ethereum.privy-p256-public-key", { encoding: "base64", data: publicDer.toString("base64") });
    const record = {
      type: TYPE,
      version: 1,
      format: FORMAT,
      algorithm: ALGORITHM,
      keyId,
      publicKey: { format: "spki", encoding: "base64", data: publicDer.toString("base64") },
      privateKey: { format: "pkcs8-encrypted", encoding: "base64", cipher: "aes-256-cbc", data: encryptedPrivateDer.toString("base64") },
    };
    writeFileSync(path, `${JSON.stringify(record)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    requirePrivateRegularFile(path, "Privy authorization keystore");
    return Object.freeze({ path, keyId, publicKey: record.publicKey.data, format: FORMAT, algorithm: ALGORITHM });
  } finally {
    password.fill(0);
    encryptedPrivateDer?.fill(0);
    publicDer?.fill(0);
  }
}

export function createPolicyBoundPrivyAuthorizationSignFn({ path, passwordFile, policy, now = Date.now }) {
  if (typeof now !== "function") throw new Error("now must be a function");
  const normalized = normalizePolicy(policy);
  const userOperationPolicy = createUserOperationAuthorizationPolicy({
    chainIds: [...normalized.allowedChainIds],
    account: normalized.walletAddress,
    contracts: [...normalized.allowedContracts],
    ...(normalized.allowedUserOperationCallDataDigests ? { callDataDigests: [...normalized.allowedUserOperationCallDataDigests] } : {}),
    ...(normalized.maxSignatures !== null ? { maxSignatures: normalized.maxSignatures } : {}),
  });
  const record = parseKeystore(path);
  let successfulSignatures = 0;

  const signFn = async (payload) => {
    const currentTime = now();
    if (!Number.isFinite(currentTime)) throw new Error("current time is invalid");
    if (normalized.expiresAt !== null && currentTime > normalized.expiresAt) throw new Error("authorization policy has expired");
    const method = validatePayload(payload, normalized, currentTime);
    if (method === "eth_signUserOperation") {
      const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payload));
      userOperationPolicy.authorize({ chainId: parsed.body.params.chain_id, contract: parsed.body.params.contract, userOperation: parsed.body.params.user_operation });
    }
    if (normalized.maxSignatures !== null && successfulSignatures >= normalized.maxSignatures) {
      throw new Error("authorization policy signature limit is exhausted");
    }

    const password = readPassword(passwordFile);
    const encryptedPrivateDer = decodeBase64(record.privateKey.data, "encrypted private key");
    const publicDer = decodeBase64(record.publicKey.data, "public key");
    try {
      const privateKey = createPrivateKey({ key: encryptedPrivateDer, format: "der", type: "pkcs8", passphrase: password });
      if (privateKey.asymmetricKeyType !== "ec" || privateKey.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
        throw new Error("Privy authorization private key is not P-256");
      }
      const derivedPublicDer = createPublicKey(privateKey).export({ format: "der", type: "spki" });
      try {
        if (derivedPublicDer.length !== publicDer.length || !timingSafeEqual(derivedPublicDer, publicDer)) {
          throw new Error("Privy authorization public and private keys do not match");
        }
      } finally {
        derivedPublicDer.fill(0);
      }
      const signature = sign("sha256", payload, { key: privateKey, dsaEncoding: "der" });
      successfulSignatures += 1;
      try {
        return signature.toString("base64");
      } finally {
        signature.fill(0);
      }
    } finally {
      password.fill(0);
      encryptedPrivateDer.fill(0);
      publicDer.fill(0);
    }
  };

  Object.defineProperty(signFn, "descriptor", {
    enumerable: true,
    value: Object.freeze({ keyId: record.keyId, publicKey: record.publicKey.data, format: FORMAT, algorithm: ALGORITHM }),
  });
  return Object.freeze(signFn);
}

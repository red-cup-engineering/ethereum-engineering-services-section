import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Wallet, decryptKeystoreJson, isKeystoreJson } from "ethers";

function requirePrivateFile(path, label) {
  const mode = statSync(path).mode & 0o777;
  if ((mode & 0o077) !== 0) throw new Error(`${label} must not be readable or writable by group or other users`);
}

function passwordBytes(path) {
  requirePrivateFile(path, "keystore password file");
  const bytes = readFileSync(path);
  const text = bytes.toString("utf8").replace(/[\r\n]+$/u, "");
  bytes.fill(0);
  if (text.length < 16) throw new Error("keystore password must contain at least 16 characters");
  return text;
}

export function ensureSettlementPassword({ credentialRoot, urn, chainId }) {
  if (!urn?.startsWith("urn:")) throw new Error("settlement credential requires a stable URN");
  if (!Number.isSafeInteger(chainId) || chainId < 1) throw new Error("settlement credential requires a positive chain ID");
  const root = resolve(credentialRoot);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  requirePrivateFile(root, "credential root");
  const settlement = createHash("sha256").update(urn).digest("hex");
  const directory = join(root, settlement);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  requirePrivateFile(directory, "settlement credential directory");
  const path = join(directory, `eip155-${chainId}.password`);
  if (!existsSync(path)) writeFileSync(path, `${randomBytes(48).toString("base64url")}\n`, { flag: "wx", mode: 0o600 });
  requirePrivateFile(path, "keystore password file");
  return path;
}

export async function createSettlementKeystore({ path, passwordFile }) {
  const password = passwordBytes(passwordFile);
  const wallet = Wallet.createRandom();
  try {
    const json = await wallet.encrypt(password);
    writeFileSync(path, `${json}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    return Object.freeze({ path, signer: wallet.address.toLowerCase(), format: "ethereum-secret-storage-v3" });
  } finally {
    // JavaScript strings cannot be reliably zeroized; do not retain or return either secret.
  }
}

export async function encryptSettlementPrivateKey({ path, passwordFile, privateKey }) {
  const wallet = new Wallet(privateKey);
  const password = passwordBytes(passwordFile);
  const json = await wallet.encrypt(password);
  writeFileSync(path, `${json}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  return Object.freeze({ path, signer: wallet.address.toLowerCase(), format: "ethereum-secret-storage-v3" });
}

export function inspectSettlementMnemonic({ mnemonic }) {
  if (typeof mnemonic !== "string" || mnemonic.trim() !== mnemonic) throw new Error("settlement mnemonic must be a trimmed string");
  const words = mnemonic.split(/\s+/u);
  if (![12, 15, 18, 21, 24].includes(words.length)) throw new Error("settlement mnemonic must contain a standard BIP-39 word count");
  const wallet = Wallet.fromPhrase(mnemonic);
  return Object.freeze({ signer: wallet.address.toLowerCase(), wordCount: words.length });
}

export async function encryptSettlementMnemonic({ path, passwordFile, mnemonic, expectedSigner }) {
  const inspected = inspectSettlementMnemonic({ mnemonic });
  if (typeof expectedSigner !== "string" || inspected.signer !== expectedSigner.toLowerCase()) {
    throw new Error("settlement mnemonic does not derive the exact expected signer");
  }
  const wallet = Wallet.fromPhrase(mnemonic);
  const password = passwordBytes(passwordFile);
  const json = await wallet.encrypt(password);
  writeFileSync(path, `${json}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  return Object.freeze({ path, signer: inspected.signer, format: "ethereum-secret-storage-v3", sourceRetained: false });
}

export async function openSettlementSigner({ path, passwordFile }) {
  requirePrivateFile(path, "settlement keystore");
  const json = readFileSync(path, "utf8");
  if (!isKeystoreJson(json)) throw new Error("settlement controller is not an Ethereum Secret Storage keystore");
  const password = passwordBytes(passwordFile);
  const account = await decryptKeystoreJson(json, password);
  return new Wallet(account.privateKey);
}

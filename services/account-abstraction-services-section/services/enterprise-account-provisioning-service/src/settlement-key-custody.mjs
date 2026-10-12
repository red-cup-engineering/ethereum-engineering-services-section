import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Wallet, decryptKeystoreJson, isKeystoreJson } from "ethers";

function privateFile(path, label) {
  if ((statSync(path).mode & 0o077) !== 0) throw new Error(`${label} must not be readable or writable by group or other users`);
}
function password(path) {
  privateFile(path, "keystore password file");
  const bytes = readFileSync(path), value = bytes.toString("utf8").replace(/[\r\n]+$/u, "");
  bytes.fill(0);
  if (value.length < 16) throw new Error("keystore password must contain at least 16 characters");
  return value;
}
export function ensureSettlementPassword({ credentialRoot, urn, chainId }) {
  if (!urn?.startsWith("urn:") || !Number.isSafeInteger(chainId) || chainId < 1) throw new Error("settlement custody requires a stable URN and positive chain ID");
  const root = resolve(credentialRoot); mkdirSync(root, { recursive: true, mode: 0o700 }); privateFile(root, "credential root");
  const directory = join(root, createHash("sha256").update(urn).digest("hex"));
  mkdirSync(directory, { recursive: true, mode: 0o700 }); privateFile(directory, "settlement credential directory");
  const path = join(directory, `eip155-${chainId}.password`);
  if (!existsSync(path)) writeFileSync(path, `${randomBytes(48).toString("base64url")}\n`, { flag: "wx", mode: 0o600 });
  privateFile(path, "keystore password file"); return path;
}
export async function createSettlementKeystore({ path, passwordFile }) {
  const wallet = Wallet.createRandom();
  writeFileSync(path, `${await wallet.encrypt(password(passwordFile))}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  return Object.freeze({ path, signer: wallet.address.toLowerCase(), format: "ethereum-secret-storage-v3" });
}
export async function openSettlementSigner({ path, passwordFile }) {
  privateFile(path, "settlement keystore");
  const json = readFileSync(path, "utf8");
  if (!isKeystoreJson(json)) throw new Error("settlement custody must use Ethereum Secret Storage v3");
  const account = await decryptKeystoreJson(json, password(passwordFile));
  return new Wallet(account.privateKey);
}
export async function reencryptSettlementKeystore({ path, signer, passwordFile }) {
  privateFile(path, "settlement keystore");
  if (!(signer instanceof Wallet)) throw new Error("settlement signer must be an ethers Wallet");
  const temporary = `${path}.reencrypting`;
  writeFileSync(temporary, `${await signer.encrypt(password(passwordFile))}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  renameSync(temporary, path);
  return Object.freeze({ path, signer: signer.address.toLowerCase(), format: "ethereum-secret-storage-v3" });
}

#!/usr/bin/env node
import { ContractFactory, JsonRpcProvider, Signature, Transaction, keccak256, recoverAddress } from "ethers";
import { readFileSync } from "node:fs";

const CHAIN = 5615611;
const GENESIS = "0x1428dfe4653fbf3cd34090316ce9e177291eb1668cd8f6b4eb38561aa83dcce4";
const DEPLOYER = "0xacd5243c5734f68e866047231f1017a8a9832c3e";
const EXCHANGE = "0xc4234dc42c9d93bc7d61b0354aba2729ae52e322";
const required = (name) => { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value; };
const provider = new JsonRpcProvider(required("CHAIN_RPC_URL"), CHAIN);
const keyVersion = required("DEPLOYER_KMS_KEY_VERSION");
if (!keyVersion.endsWith("/cryptoKeys/a5615611-contract-deployer/cryptoKeyVersions/1")) throw new Error("wrong deployer KMS key");

function derSignature(base64) {
  const der = Buffer.from(base64, "base64"); let offset = 2;
  if (der[0] !== 48 || der[1] !== der.length - 2) throw new Error("bad KMS DER signature");
  const integer = () => { if (der[offset++] !== 2) throw new Error("bad KMS DER integer"); const length = der[offset++]; const bytes = der.subarray(offset, offset += length); return length === 33 ? bytes.subarray(1) : bytes; };
  const r = integer(), s = integer();
  return { r: `0x${Buffer.concat([Buffer.alloc(32 - r.length), r]).toString("hex")}`, s: `0x${Buffer.concat([Buffer.alloc(32 - s.length), s]).toString("hex")}` };
}
async function accessToken() {
  const response = await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", { headers: { "metadata-flavor": "Google" } });
  const body = await response.json(); if (!response.ok || !body.access_token) throw new Error("workload identity token unavailable"); return body.access_token;
}
async function sign(digest) {
  const response = await fetch(`https://cloudkms.googleapis.com/v1/${keyVersion}:asymmetricSign`, { method: "POST", headers: { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" }, body: JSON.stringify({ digest: { sha256: Buffer.from(digest.slice(2), "hex").toString("base64") } }) });
  const body = await response.json(); if (!response.ok) throw new Error(body.error?.message ?? "KMS refused");
  const { r, s } = derSignature(body.signature);
  for (const yParity of [0, 1]) { const signature = Signature.from({ r, s, yParity }); if (recoverAddress(digest, signature.serialized).toLowerCase() === DEPLOYER) return signature; }
  throw new Error("KMS signer mismatch");
}
function artifact(path) { return JSON.parse(readFileSync(path, "utf8")); }
function bytecode(value) { return typeof value === "string" ? value : value?.object; }
function verifyRuntime(value, observedRuntime, args) {
  const expected = bytecode(value.deployedBytecode).slice(2).toLowerCase();
  const observed = observedRuntime.slice(2).toLowerCase();
  if (expected.length !== observed.length) return false;
  const references = Object.values(value.deployedBytecode?.immutableReferences ?? {}).flat().sort((left, right) => left.start - right.start);
  const allowedWords = new Set(args.filter((arg) => /^0x[0-9a-f]{40}$/iu.test(arg)).map((arg) => arg.slice(2).toLowerCase().padStart(64, "0")));
  let cursor = 0;
  for (const reference of references) {
    const start = reference.start * 2, end = start + reference.length * 2;
    if (expected.slice(cursor, start) !== observed.slice(cursor, start)) return false;
    if (!allowedWords.has(observed.slice(start, end))) return false;
    cursor = end;
  }
  return expected.slice(cursor) === observed.slice(cursor);
}

if (Number((await provider.getNetwork()).chainId) !== CHAIN) throw new Error("chain drift");
if ((await provider.getBlock(0))?.hash?.toLowerCase() !== GENESIS) throw new Error("genesis drift");
if (await provider.getCode(EXCHANGE) === "0x") throw new Error("SemioticExchange is absent");
let nonce = await provider.getTransactionCount(DEPLOYER, "pending");
const gasPrice = (await provider.getFeeData()).gasPrice ?? 1n;
async function deploy(contractName, artifactPath, args = []) {
  const value = artifact(artifactPath), creation = bytecode(value.bytecode), expectedRuntime = bytecode(value.deployedBytecode);
  const request = await new ContractFactory(value.abi, creation).getDeployTransaction(...args);
  const transaction = Transaction.from({ type: 0, chainId: CHAIN, nonce: nonce++, data: request.data, gasLimit: 6_000_000n, gasPrice });
  transaction.signature = await sign(transaction.unsignedHash);
  const sent = await provider.broadcastTransaction(transaction.serialized);
  const receipt = await provider.waitForTransaction(sent.hash, 1, 60_000);
  if (!receipt || receipt.status !== 1 || !receipt.contractAddress) throw new Error(`${contractName} deployment failed: ${sent.hash}`);
  const observedRuntime = await provider.getCode(receipt.contractAddress);
  if (observedRuntime === "0x" || !verifyRuntime(value, observedRuntime, args)) throw new Error(`${contractName} runtime bytecode drift`);
  return Object.freeze({ contractName, address: receipt.contractAddress.toLowerCase(), deployer: DEPLOYER, transactionHash: receipt.hash, blockNumber: receipt.blockNumber, creationBytecodeHash: keccak256(creation), runtimeBytecodeHash: keccak256(observedRuntime), eventCount: receipt.logs.length });
}

async function recover(contractName, artifactPath, address, transactionHash, args = []) {
  if (!/^0x[0-9a-f]{40}$/iu.test(address) || !/^0x[0-9a-f]{64}$/iu.test(transactionHash)) throw new Error(`invalid ${contractName} recovery coordinates`);
  const value = artifact(artifactPath), receipt = await provider.getTransactionReceipt(transactionHash), observedRuntime = await provider.getCode(address);
  if (!receipt || receipt.status !== 1 || receipt.contractAddress?.toLowerCase() !== address.toLowerCase()) throw new Error(`${contractName} recovery receipt drift`);
  if (observedRuntime === "0x" || !verifyRuntime(value, observedRuntime, args)) throw new Error(`${contractName} recovery runtime drift`);
  return Object.freeze({ contractName, address: address.toLowerCase(), deployer: DEPLOYER, transactionHash: receipt.hash, blockNumber: receipt.blockNumber, creationBytecodeHash: keccak256(bytecode(value.bytecode)), runtimeBytecodeHash: keccak256(observedRuntime), eventCount: receipt.logs.length });
}

const contracts = [];
if (process.env.RESUME_MARK_ADDRESS || process.env.RESUME_UTTERANCE_ADDRESS) {
  contracts.push(await recover("Mark", "articulating/Mark.json", required("RESUME_MARK_ADDRESS"), required("RESUME_MARK_TRANSACTION")));
  contracts.push(await recover("Utterance", "articulating/Utterance.json", required("RESUME_UTTERANCE_ADDRESS"), required("RESUME_UTTERANCE_TRANSACTION"), [contracts[0].address]));
} else {
  contracts.push(await deploy("Mark", "articulating/Mark.json"));
  contracts.push(await deploy("Utterance", "articulating/Utterance.json", [contracts[0].address]));
}
contracts.push(await deploy("CrossSystemTimeWitnessRegistryV1", "out/CrossSystemTimeWitnessRegistryV1.sol/CrossSystemTimeWitnessRegistryV1.json"));
contracts.push(await deploy("ContentClaimRegistryV1", "out/ContentClaimRegistryV1.sol/ContentClaimRegistryV1.json", [contracts[1].address, contracts[2].address]));
contracts.push(await deploy("ActorOfficeBindingRegistryV1", "out/ActorOfficeBindingRegistryV1.sol/ActorOfficeBindingRegistryV1.json"));
contracts.push(await deploy("GlassPoreRegistryV1", "out/GlassPoreRegistryV1.sol/GlassPoreRegistryV1.json", [contracts[4].address, contracts[2].address]));
contracts.push(await deploy("ConsiderationEvidenceRegistryV1", "out/ConsiderationEvidenceRegistryV1.sol/ConsiderationEvidenceRegistryV1.json", [EXCHANGE, contracts[2].address]));
contracts.push(await deploy("OutcomeReceiptRegistryV1", "out/OutcomeReceiptRegistryV1.sol/OutcomeReceiptRegistryV1.json", [EXCHANGE, contracts[6].address]));
process.stdout.write(`${JSON.stringify({ type: "Eip1555615611GlassSpongeDeploymentReceipt", version: 1, chain: "eip155:5615611", genesisHash: GENESIS, deployer: DEPLOYER, sourcePlan: "content/deployment-plans/eip155-5615611-glass-sponge.json", contracts })}\n`);

#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { JsonRpcProvider } from "ethers";
import { createCloudKmsSecp256k1Signer } from "@red-cup-engineering/sign-ethereum-digest-with-cloud-kms-services-section";
import { submitUserOperationBundleToEntryPoint } from "../src/kms-handle-ops-submitter.mjs";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const QUANTITY = /^(?:0|[1-9][0-9]*)$/u;
const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

async function inputText() {
  if (process.env.BUNDLE_INPUT_JSON) return process.env.BUNDLE_INPUT_JSON;
  if (process.env.BUNDLE_INPUT_FILE) return readFile(process.env.BUNDLE_INPUT_FILE, "utf8");
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  if (chunks.length === 0) throw new Error("one canonical bundle input is required through BUNDLE_INPUT_JSON, BUNDLE_INPUT_FILE, or stdin");
  return Buffer.concat(chunks).toString("utf8");
}

function exactQuantity(value, name) {
  if (typeof value !== "string" || !QUANTITY.test(value)) throw new TypeError(`${name} must be a decimal nonnegative integer`);
  return value;
}

function exactInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("bundle input must be one object");
  const expected = ["beneficiary", "operation", "gasLimit", "maxFeePerGas", "maxPriorityFeePerGas", "nonce"];
  if (Object.keys(value).sort().join(",") !== expected.sort().join(",")) throw new TypeError("bundle input must contain exactly beneficiary, operation, gasLimit, maxFeePerGas, maxPriorityFeePerGas, and nonce");
  if (!ADDRESS.test(value.beneficiary)) throw new TypeError("beneficiary must be an EVM address");
  if (!value.operation || typeof value.operation !== "object" || Array.isArray(value.operation)) throw new TypeError("operation must be one packed ERC-4337 UserOperation");
  for (const name of ["gasLimit", "maxFeePerGas", "maxPriorityFeePerGas", "nonce"]) exactQuantity(value[name], name);
  return Object.freeze({ ...value, beneficiary: value.beneficiary.toLowerCase() });
}

const input = exactInput(JSON.parse(await inputText()));
const provider = new JsonRpcProvider(required("CHAIN_RPC_URL"));
const signer = createCloudKmsSecp256k1Signer({
  keyVersion: required("KMS_KEY_VERSION"),
  address: required("BUNDLER_SIGNER_ADDRESS"),
  accessToken: async () => (await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", { headers: { "metadata-flavor": "Google" } })).json().then(({ access_token }) => access_token),
});
const receipt = await submitUserOperationBundleToEntryPoint({
  ...input,
  rpc: provider.send.bind(provider),
  chainId: Number(required("CHAIN_ID")),
  entryPoint: required("ENTRY_POINT"),
  signer,
});
process.stdout.write(`${JSON.stringify({ type: "KmsHandleOpsBundleReceipt", version: 1, chain: `eip155:${required("CHAIN_ID")}`, ...receipt })}\n`);

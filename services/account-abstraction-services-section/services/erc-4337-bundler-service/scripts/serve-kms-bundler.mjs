import { createServer } from "node:http";
import { JsonRpcProvider } from "ethers";
import { createCloudKmsSecp256k1Signer } from "@red-cup-engineering/sign-ethereum-digest-with-cloud-kms-services-section";
import { submitUserOperationBundleToEntryPoint } from "../src/kms-handle-ops-submitter.mjs";
const port = Number(process.env.PORT ?? 8080);
const required = (name) => { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value; };
const provider = new JsonRpcProvider(required("CHAIN_RPC_URL"));
const signer = createCloudKmsSecp256k1Signer({ keyVersion: required("KMS_KEY_VERSION"), address: required("BUNDLER_SIGNER_ADDRESS"), accessToken: async () => (await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", { headers: { "metadata-flavor": "Google" } })).json().then(({ access_token }) => access_token) });
createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/healthz") {
    try {
      const [observedChainId, entryPointCode] = await Promise.all([provider.send("eth_chainId", []), provider.getCode(required("ENTRY_POINT"))]);
      if (Number(BigInt(observedChainId)) !== Number(required("CHAIN_ID")) || entryPointCode === "0x") throw new Error("configured private RPC chain or EntryPoint is unavailable");
      response.writeHead(200, { "content-type": "application/json" }); return response.end(JSON.stringify({ status: "ready", executor: "kms-handle-ops", chainId: Number(BigInt(observedChainId)), entryPoint: required("ENTRY_POINT").toLowerCase() }));
    } catch (error) { response.writeHead(503, { "content-type": "application/json" }); return response.end(JSON.stringify({ status: "unready", error: error.message })); }
  }
  if (request.method !== "POST" || request.url !== "/submit-user-operation-bundle") { response.writeHead(404); return response.end(); }
  const body = []; for await (const chunk of request) body.push(chunk);
  try { const input = JSON.parse(Buffer.concat(body).toString("utf8")); const receipt = await submitUserOperationBundleToEntryPoint({ ...input, rpc: provider.send.bind(provider), chainId: Number(required("CHAIN_ID")), entryPoint: required("ENTRY_POINT"), signer }); response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify(receipt)); } catch (error) { response.writeHead(400, { "content-type": "application/json" }); response.end(JSON.stringify({ error: error.message })); }
}).listen(port, process.env.HOST ?? "0.0.0.0");

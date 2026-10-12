#!/usr/bin/env node
import { createHttpServer } from "@red-cup-engineering/http-services-section/node-server";

import { createEnterpriseProvisioningPaymasterService } from "../src/paymaster-service.mjs";

function required(name) { const value = process.env[name]; if (!value) throw new Error(`${name} is required`); return value; }
const host = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? "7677");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be a TCP port");

const service = await createEnterpriseProvisioningPaymasterService({
  rpcUrl: required("EVM_RPC_URL"),
  expectedChainId: required("EXPECTED_CHAIN_ID"),
  bindingPath: required("ACCOUNT_BINDING"),
  keystorePath: required("SPONSOR_KEYSTORE"),
  passwordFile: required("SPONSOR_PASSWORD_FILE"),
  deploymentPath: required("STANDARDS_DEPLOYMENT"),
});

const server = createHttpServer({ handle: async (request, response) => {
  if (request.method !== "POST" || request.url !== "/") {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32601, message: "ERC-7677 JSON-RPC endpoint is POST /" } }));
    return;
  }
  let message;
  try {
    const chunks = []; let length = 0;
    for await (const chunk of request) {
      length += chunk.length;
      if (length > 256 * 1024) throw Object.assign(new Error("request exceeds 256 KiB"), { rpcCode: -32600 });
      chunks.push(chunk);
    }
    message = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!message || message.jsonrpc !== "2.0" || !(typeof message.id === "string" || typeof message.id === "number") || typeof message.method !== "string") throw Object.assign(new Error("invalid JSON-RPC 2.0 request"), { rpcCode: -32600 });
    const result = await service.invoke(message.method, message.params);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
  } catch (error) {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ jsonrpc: "2.0", id: message?.id ?? null, error: { code: error?.rpcCode ?? -32602, message: error instanceof Error ? error.message : String(error) } }));
  }
} });
server.listen(port, host, () => process.stdout.write(`${JSON.stringify({ type: "Erc7677PaymasterServiceListening", host, port, ...service })}\n`));

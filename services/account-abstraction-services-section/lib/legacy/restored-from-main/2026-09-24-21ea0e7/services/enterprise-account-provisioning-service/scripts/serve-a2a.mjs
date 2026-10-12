#!/usr/bin/env node
import { resolve } from "node:path";
import { serveContractedAgentProcess } from "@red-cup-engineering/a2a-services-section/serve-contracted-agent";
const root = resolve(import.meta.dirname, "..");
serveContractedAgentProcess({ port: Number(process.env.PORT ?? "8080"), host: process.env.HOST ?? "0.0.0.0", baseUrl: process.env.BASE_URL, agentCard: resolve(root, "content/agent-cards/enterprise-account-provisioning-service.json"), executor: process.execPath, executorArgs: [resolve(root, "scripts/execute-a2a-message.mjs")] });

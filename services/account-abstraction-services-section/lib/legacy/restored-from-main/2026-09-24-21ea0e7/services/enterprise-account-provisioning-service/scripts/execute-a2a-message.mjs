#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { executeA2aMessage } from "../src/a2a-executor.mjs";
process.stdout.write(`${JSON.stringify(await executeA2aMessage(JSON.parse(readFileSync(0, "utf8"))))}\n`);

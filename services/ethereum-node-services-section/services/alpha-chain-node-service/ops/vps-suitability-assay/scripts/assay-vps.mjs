#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import process from "node:process";

import { assayVpsSuitability } from "../src/assay.mjs";

async function inputText(argument) {
  if (argument === undefined || argument === "-") {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    return Buffer.concat(chunks).toString("utf8");
  }
  return readFile(argument, "utf8");
}

try {
  const facts = JSON.parse(await inputText(process.argv[2]));
  const outcome = assayVpsSuitability(facts);
  process.stdout.write(`${JSON.stringify(outcome, null, 2)}\n`);
  process.exitCode = outcome.decision === "pass" ? 0 : 2;
} catch (error) {
  process.stderr.write(`vps-suitability-assay: ${error.message}\n`);
  process.exitCode = 1;
}

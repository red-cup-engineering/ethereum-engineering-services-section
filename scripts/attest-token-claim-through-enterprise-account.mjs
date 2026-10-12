#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { attestTokenClaimThroughEnterpriseAccount } from "../src/enterprise-eas-attestation.mjs";

function option(name) {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
}

const request = JSON.parse(readFileSync(option("--request") ?? 0, "utf8"));
const result = await attestTokenClaimThroughEnterpriseAccount({
  ...request,
});
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

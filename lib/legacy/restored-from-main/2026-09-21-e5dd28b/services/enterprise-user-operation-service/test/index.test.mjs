import assert from "node:assert/strict";
import test from "node:test";
import { executeEnterpriseUserOperation, prepareEnterpriseUserOperation } from "../src/index.mjs";
test("exports the bounded ERC-4337 preparation and submission operations", () => {
  assert.equal(typeof prepareEnterpriseUserOperation, "function");
  assert.equal(typeof executeEnterpriseUserOperation, "function");
});

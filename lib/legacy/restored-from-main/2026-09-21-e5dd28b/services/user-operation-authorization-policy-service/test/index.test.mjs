import assert from "node:assert/strict";
import test from "node:test";
import { createUserOperationAuthorizationPolicy } from "../src/index.mjs";
test("bounds one named ERC-7769 account and contract", () => {
  const policy = createUserOperationAuthorizationPolicy({ chainId: 1, account: "0x1111111111111111111111111111111111111111", contracts: ["0x2222222222222222222222222222222222222222"] });
  assert.equal(typeof policy.authorize, "function");
});

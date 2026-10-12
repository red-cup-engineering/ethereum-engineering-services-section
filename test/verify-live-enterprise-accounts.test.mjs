import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("account verification imports without external executables or network", () => {
  const moduleUrl = new URL("../scripts/verify-live-enterprise-accounts.mjs", import.meta.url).href;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e",
    "globalThis.fetch=()=>{throw new Error('unexpected network')};const m=await import(" + JSON.stringify(moduleUrl) + ");if(typeof m.verifyLiveEnterpriseAccounts!=='function')process.exit(1);"],
  { env: { ...process.env, PATH: "" }, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
});

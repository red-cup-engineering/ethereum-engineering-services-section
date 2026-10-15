import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { readFileSync, mkdtempSync, writeFileSync, chmodSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const deploy = join(root,"..","scripts","deploy-integration-settlement-token.mjs");
const rawKey = "0x" + "f".repeat(64);
const args = ["--rpc-url","http://127.0.0.1:1","--network","eip155:5615611",
  "--initial-holder","0x1111111111111111111111111111111111111111"];

function run(...extra) {
  return spawnSync(process.execPath, [deploy,...args,...extra], {
    encoding: "utf8", timeout: 5000,
    env: { ...process.env, UNION_EVM_DEPLOYER_PRIVATE_KEY: rawKey },
  });
}
test("an ambient raw key cannot authorize integration-token deployment",()=>{
  const r=run();
  assert.equal(r.status,1);
  assert.match(r.stderr,/--keystore.*--password-file/u);
  assert.doesNotMatch(r.stderr,new RegExp(rawKey,"u"));
  const source=readFileSync(deploy,"utf8");
  assert.doesNotMatch(source,/"--private-key"/u);
});
test("encrypted custody requires exact owner-only non-symlink files before any RPC",()=>{
  const dir=mkdtempSync(join(tmpdir(),"uic-custody-"));
  try {
    const key=join(dir,"key.json"),pass=join(dir,"password"),link=join(dir,"link");
    writeFileSync(key,"{}",{mode:0o600});writeFileSync(pass,"secret",{mode:0o600});
    symlinkSync(key,link);
    const withLink=run("--keystore",link,"--password-file",pass);
    assert.equal(withLink.status,1);
    assert.match(withLink.stderr,/owner-only regular file without symlink/u);
    chmodSync(key,0o644);
    const withUnsafe=run("--keystore",key,"--password-file",pass);
    assert.equal(withUnsafe.status,1);
    assert.match(withUnsafe.stderr,/owner-only regular file without symlink/u);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

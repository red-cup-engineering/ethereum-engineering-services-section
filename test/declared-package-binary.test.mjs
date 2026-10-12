import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { resolveDeclaredPackageBinary } from "../src/declared-package-binary.mjs";

const PACKAGE = "@foundry-rs/forge";

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value)}\n`);
}

async function fixture({ hoisted = false, dependencyVersion = "1.7.1", bin = "bin.mjs" } = {}) {
  const root = await mkdtemp(join(tmpdir(), "declared-package-binary-"));
  const owner = hoisted
    ? join(root, "node_modules", "@red-cup-engineering", "ethereum-services-section")
    : join(root, "ethereum-services-section");
  const dependency = hoisted
    ? join(root, "node_modules", "@foundry-rs", "forge")
    : join(owner, "node_modules", "@foundry-rs", "forge");
  await writeJson(join(owner, "package.json"), { name: "@red-cup-engineering/ethereum-engineering-services-section",
    dependencies: { [PACKAGE]: "1.7.1" } });
  await writeJson(join(dependency, "package.json"), { name: PACKAGE, version: dependencyVersion,
    bin: { forge: bin } });
  await mkdir(dependency, { recursive: true });
  await writeFile(join(dependency, "bin.mjs"), "#!/usr/bin/env node\n");
  return { root, owner, dependency };
}

test("resolves the exact package-local Forge wrapper in a source layout", async () => {
  const { owner, dependency } = await fixture();
  const result = resolveDeclaredPackageBinary({ ownerRoot: owner, packageName: PACKAGE, binaryName: "forge" });
  assert.deepEqual({ packageName: result.packageName, version: result.version, binaryName: result.binaryName },
    { packageName: PACKAGE, version: "1.7.1", binaryName: "forge" });
  assert.equal(result.path, join(dependency, "bin.mjs"));
});

test("resolves the exact npm-hoisted Forge wrapper without PATH lookup", async () => {
  const { owner, dependency } = await fixture({ hoisted: true });
  const previousPath = process.env.PATH;
  process.env.PATH = "";
  try {
    const result = resolveDeclaredPackageBinary({ ownerRoot: owner, packageName: PACKAGE, binaryName: "forge" });
    assert.equal(result.path, join(dependency, "bin.mjs"));
  } finally {
    process.env.PATH = previousPath;
  }
});

test("refuses version drift and a binary that escapes the resolved package", async () => {
  const drift = await fixture({ dependencyVersion: "1.7.2" });
  assert.throws(() => resolveDeclaredPackageBinary({ ownerRoot: drift.owner, packageName: PACKAGE, binaryName: "forge" }),
    /resolved identity differs/u);
  const escaped = await fixture({ bin: "../outside.mjs" });
  const outside = join(escaped.dependency, "..", "outside.mjs");
  await writeFile(outside, "#!/usr/bin/env node\n");
  assert.throws(() => resolveDeclaredPackageBinary({ ownerRoot: escaped.owner, packageName: PACKAGE, binaryName: "forge" }),
    /escapes its resolved package/u);
});

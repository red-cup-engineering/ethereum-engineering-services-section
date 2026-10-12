#!/usr/bin/env node
// snapshot-development-chain.mjs — copy the live anvil state file to an
// service-owned snapshot pool, skipping unchanged state and pruning old copies.

import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { argument as option } from "@red-cup-engineering/javascript-node-services-section/argv";
import { writeFileBytesSync } from "@red-cup-engineering/computer-file-engineering-services-section/write-file";
import { sha256Hex } from "@red-cup-engineering/cryptographic-computer-data-engineering-services-section/integrity";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const chainId = option("--chain-id") ?? "31337";
const state = resolve(option("--state") ?? resolve(ROOT, "data", "state", "development-chain-state", `eip155-${chainId}.json`));
const pool = resolve(option("--pool") ?? join(ROOT, "data", "state", "devchain-snapshots", `eip155-${chainId}`));
const keep = Number(option("--keep") ?? "96");
if (!Number.isInteger(keep) || keep < 1) throw new Error("--keep must be a positive integer");

mkdirSync(pool, { recursive: true });

const bytes = readFileSync(state);

// anvil writes this file in place on its own --state-interval clock, with no
// atomicity guarantee against a concurrent reader; a read that lands mid-write
// can observe a torn, truncated JSON document (2026-07-23: this is exactly how
// the live devchain state was displaced and the chain silently reset). Refuse
// to carry a torn read forward into the recovery pool -- a future timer tick
// will see the settled write. This does not fix anvil's own writer; it keeps
// this settlement's own recovery copies from ever being corrupt.
try {
  JSON.parse(bytes.toString("utf8"));
} catch (error) {
  process.stdout.write(`refusing snapshot: source state file failed to parse as JSON (likely read mid-write): ${error.message}\n`);
  process.exit(0);
}

const digest = sha256Hex(bytes).slice(0, 12);

const existing = readdirSync(pool).filter((name) => name.endsWith(".json")).sort();
const newest = existing.at(-1);
if (newest?.includes(digest)) {
  process.stdout.write(`unchanged since ${newest}; no snapshot taken\n`);
  process.exit(0);
}

const stamp = new Date(statSync(state).mtimeMs).toISOString().replace(/[:.]/g, "-");
const target = join(pool, `${stamp}.${digest}.json`);
// Write-to-temp-then-rename: a same-directory rename() is atomic on POSIX, so
// a snapshot is either fully present under its final name or not present at
// all -- never partially written -- even if this process is killed mid-copy.
writeFileBytesSync(target, bytes);

const all = readdirSync(pool).filter((name) => name.endsWith(".json")).sort();
for (const name of all.slice(0, Math.max(0, all.length - keep))) rmSync(join(pool, name));

process.stdout.write(`snapshot ${target} (${bytes.length} bytes, ${all.length > keep ? keep : all.length} kept)\n`);

// Off-box replication over plain HTTPS (GitHub contents API via gh). This
// path deliberately involves neither the git binary (banned toward the
// corpus) nor the Union's own chain-settled git ingress: a recovery copy
// must not depend on the health of the thing it recovers.
const remote = option("--remote") ?? "repos/emsenn/union-devchain-snapshots/contents";
if (remote !== "none") {
  const name = target.split("/").at(-1);
  const body = JSON.stringify({ message: `snapshot ${name}`, content: bytes.toString("base64") });
  const push = spawnSync("gh", ["api", "-X", "PUT", `${remote}/eip155-${chainId}/${name}`, "--input", "-"], { input: body, encoding: "utf8", timeout: 120_000 });
  if (push.status === 0) process.stdout.write(`replicated off-box: ${remote}/eip155-${chainId}/${name}\n`);
  else process.stdout.write(`WARNING off-box replication failed (local snapshot kept): ${String(push.stderr).slice(0, 300)}\n`);
}

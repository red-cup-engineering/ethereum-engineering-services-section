// Actual Guile -> Node typed execution, followed by the Ethereum ABI projection.
// Forge's FFI receives only ABI bytes; temporary work traces are removed afterward.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AbiCoder } from "ethers";
import { prepareTypedCommitment } from "../../src/typed-commitment.mjs";

const deployEngine = dirname(fileURLToPath(import.meta.resolve("@red-cup-engineering/computer-deployment-engine/package.json")));
const scratch = mkdtempSync(join(tmpdir(), "guile-typed-work-"));
try {
  const source = `
    (use-modules (node-worker) (json))
    (define worker (open-worker))
    (define input '(("row" . (("e" . "task:typed-work") ("a" . "objective") ("v" . "Address this work request") ("t" . 1)))))
    (define receipt-context (list (cons "path" (getenv "TYPED_WORK_TRACE")) (cons "actor" "actor:integration-test") (cons "t" 2)))
    (define output (call-worker worker "row-id" input 'session receipt-context))
    (define rows (call-worker worker "read" (list (cons "path" (getenv "TYPED_WORK_TRACE"))) 'local))
    (define witness (call-worker worker "row-id" (list (cons "row" (vector-ref rows 0))) 'local))
    (display (scm->json-string
      (list (cons "catalog" (worker-type-system worker))
            (cons "operation" (assoc-ref (worker-verb-spec worker "row-id") "operation"))
            (cons "input" input) (cons "output" output) (cons "evidenceRoot" witness))))
    (newline)
    (close-worker worker)`;
  const run = spawnSync("guile", ["--no-auto-compile", "-L", join(deployEngine, "src"), "-c", source], {
    encoding: "utf8", timeout: 30_000, maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, LAGOON_APP_ROOT: deployEngine, TYPED_WORK_TRACE: join(scratch, "work.eavt") },
  });
  if (run.error || run.status !== 0) throw new Error(run.error?.message ?? run.stderr);
  const projection = prepareTypedCommitment(JSON.parse(run.stdout));
  const values = [projection.typeSystem, projection.senAct, projection.predicate, projection.subject, projection.object, projection.evidenceRoot];
  process.stdout.write(AbiCoder.defaultAbiCoder().encode(values.map(() => "bytes32"), values.map(id => `0x${Buffer.from(id.slice("ni:///sha-256;".length), "base64url").toString("hex")}`)));
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

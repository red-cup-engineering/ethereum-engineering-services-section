import { readFile } from "node:fs/promises";

const artifactUrl = new URL("../out/StablePoolRecoveryExecutor.sol/StablePoolRecoveryExecutor.json", import.meta.url);

/** Read the compiler-produced, shipped helper artifact without requiring Forge. */
export async function loadStablePoolRecoveryExecutorArtifact() {
  const artifact = JSON.parse(await readFile(artifactUrl, "utf8"));
  if (!artifact?.abi || !artifact?.bytecode?.object || !artifact?.deployedBytecode?.object) throw new TypeError("shipped helper artifact is incomplete");
  return artifact;
}

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { encodeArticulatingRequestRmn } from "@lenticule-science/articulating-language-cone-service/rmn";
import { projectArticulatingRmnToEvm } from "../src/articulating-rmn-evm-projection.mjs";

const evidence = (letter) => `urn:sha256:${letter.repeat(64)}`;
const hash = (letter) => `0x${letter.repeat(64)}`;
const address = (letter) => `0x${letter.repeat(40)}`;
const standards = [
  ["org.emsenn.evm.semiotic-mark.v1", "Mark"],
  ["org.emsenn.evm.semiotic-utterance.v1", "Utterance"],
  ["org.emsenn.evm.semiotic-articulating.v1", "Articulating"],
  ["org.emsenn.evm.semiotic-articulation-cell.v1", "ArticulationCell"],
];

function verifiedManifest() {
  return {
    profile: "org.emsenn.evm.verified-deployment-manifest.v1",
    version: 1,
    receipt: evidence("a"),
    chain: { caip2: "eip155:5615611", genesisHash: "unknown" },
    contracts: standards.map(([standard, contractName], index) => {
      const letter = String.fromCharCode("1".charCodeAt(0) + index);
      return {
        standard,
        contractName,
        address: address(letter),
        deployer: "unknown",
        transactionHash: "unknown",
        blockNumber: "unknown",
        runtimeBytecodeHash: hash(letter),
        verification: { addressEvidence: evidence(letter), runtimeBytecodeEvidence: evidence(letter) },
      };
    }),
  };
}

test("canonical RMN compiles deterministically into the live articulating EVM move", () => {
  const request = encodeArticulatingRequestRmn({ tokenMark: "sword", claimMark: "drawn" });
  const first = projectArticulatingRmnToEvm(request.bytes, { deploymentManifest: verifiedManifest() });
  const second = projectArticulatingRmnToEvm(request.bytes, { deploymentManifest: verifiedManifest() });
  assert.deepEqual(first, second);
  assert.equal(first.rmnSemanticId, request.semanticId);
  assert.equal(first.chainId, "eip155:5615611");
  assert.match(first.rmnSemanticDigest, /^0x[0-9a-f]{64}$/u);
  assert.deepEqual(first.restrictedArena.map(({ move }) => move), [
    "admit-token-mark", "admit-claim-mark", "form-utterance", "seat-articulation-cell",
  ]);
  assert.deepEqual(first.enterpriseAccountEffect.calls, first.restrictedArena.map(({ target, value, data }) => ({ target, value, data })));
  assert.equal(first.deterministicCutover.order.length, 4);
  assert.equal(new Set(first.deterministicCutover.order.map(({ address }) => address)).size, 4);
  for (const member of first.deterministicCutover.order) {
    assert.match(member.address, /^0x[0-9a-f]{40}$/iu);
    assert.match(member.initCodeHash, /^0x[0-9a-f]{64}$/u);
  }
});

test("equal token and claim marks admit once but retain both utterance positions", () => {
  const request = encodeArticulatingRequestRmn({ tokenMark: "one", claimMark: "one" });
  const projected = projectArticulatingRmnToEvm(request.bytes, { deploymentManifest: verifiedManifest() });
  assert.deepEqual(projected.restrictedArena.map(({ move }) => move), [
    "admit-token-mark", "form-utterance", "seat-articulation-cell",
  ]);
  assert.equal(projected.identities.tokenMark, projected.identities.claimMark);
});

test("noncanonical or foreign RMN cannot reach the EVM fabricator", () => {
  assert.throws(
    () => projectArticulatingRmnToEvm(Buffer.from([0xa0]), { deploymentManifest: verifiedManifest() }),
    /canonical|term|operation|RMN/iu,
  );
});

test("projection refuses absent, incomplete, or wrong-chain deployment manifests", () => {
  const request = encodeArticulatingRequestRmn({ tokenMark: "sword", claimMark: "drawn" });
  assert.throws(() => projectArticulatingRmnToEvm(request.bytes), /manifest/i);

  const missingRuntimeBytecode = verifiedManifest();
  missingRuntimeBytecode.contracts[0].runtimeBytecodeHash = "unknown";
  assert.throws(
    () => projectArticulatingRmnToEvm(request.bytes, { deploymentManifest: missingRuntimeBytecode }),
    /undeployed|unverified/i,
  );

  const wrongChain = verifiedManifest();
  wrongChain.chain.caip2 = "eip155:5615610";
  assert.throws(
    () => projectArticulatingRmnToEvm(request.bytes, { deploymentManifest: wrongChain }),
    /eip155:5615611/i,
  );
});

test("the archived predecessor-chain receipt remains historical evidence, not an active fallback", async () => {
  const archivedReceipt = new URL("../content/deployments/eip155-5615610.json", import.meta.url);
  const before = await readFile(archivedReceipt, "utf8");
  const request = encodeArticulatingRequestRmn({ tokenMark: "sword", claimMark: "drawn" });
  assert.throws(() => projectArticulatingRmnToEvm(request.bytes), /manifest/i);
  assert.equal(await readFile(archivedReceipt, "utf8"), before);
});

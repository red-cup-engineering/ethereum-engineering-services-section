import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { AbiCoder, Interface, sha256 } from "ethers";
import { projectTypedCommitment } from "../src/typed-commitment.mjs";
import { makeNiUri } from "@red-cup-engineering/uri-services-section/ni-uri";

const account = `0x${"11".repeat(20)}`;
const projection = `0x${"22".repeat(20)}`;
const transactionHash = `0x${"33".repeat(32)}`;
const blockHash = `0x${"44".repeat(32)}`;
const ni = (value) => makeNiUri(Buffer.from(value, "utf8"));
const projectionInterface = new Interface([
  "event TypedCommitment(bytes32 indexed rmnAct,address indexed accountableSettlement,bytes32 indexed predicate,bytes32 subject,bytes32 object,bytes32 evidenceRoot,bytes32 commitmentId)",
]);

test("a typed commitment reports inclusion and requires a separate finality assay", async () => {
  const root = mkdtempSync(join(tmpdir(), "typed-commitment-"));
  const bindingPath = join(root, "binding.json");
  const deploymentPath = join(root, "deployment.json");
  writeFileSync(bindingPath, JSON.stringify({ account: { address: account } }));
  writeFileSync(deploymentPath, JSON.stringify({ deployments: [{ standard: "org.emsenn.evm.typed-commitment-projection.v1", address: projection }] }));
  const values = {
    rmnAct: ni("act"),
    predicate: ni("predicate"),
    subject: ni("subject"),
    object: ni("object"),
    evidenceRoot: ni("evidence"),
  };
  const bytes32 = (value) => `0x${Buffer.from(value.slice("ni:///sha-256;".length), "base64url").toString("hex")}`;
  const commitmentId = sha256(AbiCoder.defaultAbiCoder().encode(
    ["bytes32", "address", "bytes32", "bytes32", "bytes32", "bytes32"],
    [bytes32(values.rmnAct), account, bytes32(values.predicate), bytes32(values.subject), bytes32(values.object), bytes32(values.evidenceRoot)],
  ));
  const encoded = projectionInterface.encodeEventLog(
    projectionInterface.getEvent("TypedCommitment"),
    [bytes32(values.rmnAct), account, bytes32(values.predicate), bytes32(values.subject), bytes32(values.object), bytes32(values.evidenceRoot), commitmentId],
  );
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ result: { blockHash, logs: [{ address: projection, topics: encoded.topics, data: encoded.data, logIndex: "0x3" }] } }),
  });
  try {
    const result = await projectTypedCommitment({
      bindingPath,
      deploymentPath,
      keystorePath: "unused",
      passwordFile: "unused",
      rpcUrl: "https://rpc.example",
      bundlerUrl: "https://bundler.example",
      ...values,
      execute: async () => ({ account, chainId: "eip155:8453", transactionHash }),
    });
    assert.deepEqual(result.includedReceipt, { chainId: "eip155:8453", blockHash, transactionHash, logIndex: 3 });
    assert.equal(result.finalizedReceipt, undefined);
    assert.deepEqual(result.finality, {
      status: "assay-required",
      demandType: "ReceiptFinalityPolicyAssayDemand",
      providerKind: "independently-hireable-multi-chain-finality-service",
    });
  } finally {
    globalThis.fetch = priorFetch;
    rmSync(root, { recursive: true, force: true });
  }
});

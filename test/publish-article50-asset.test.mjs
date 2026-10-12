import assert from "node:assert/strict";
import test from "node:test";
import { C2PA_BINDING_PREDICATE } from "@red-cup-engineering/c2pa-services-section";
import { makeNiUri, niUriDigestBytes } from "@red-cup-engineering/uri-services-section/ni-uri";
import { publishArticle50Asset } from "../src/publish-article50-asset.mjs";

const CALLER = `eip155:31337:0x${"44".repeat(20)}`;
const ni = (value) => makeNiUri(Buffer.from(value));
const signedFixture = () => {
  const signedAsset = Buffer.from("asset"), manifest = Buffer.from("manifest");
  return { act: ni("act"), signedAsset, manifest, reportBytes: Buffer.from("report"), assetNi: ni(signedAsset), manifestNi: ni(manifest) };
};
const digest = (act) => `0x${Buffer.from(niUriDigestBytes(act)).toString("hex")}`;

test("the publisher binds the signed asset to its manifest on chain", async () => {
  let projected;
  const signed = signedFixture();
  const result = await publishArticle50Asset({
    signing: { caller: CALLER },
    anchor: {},
    sign: async () => signed,
    project: async (request) => {
      projected = request;
      return { account: CALLER, senSemanticDigest: digest(request.senAct), finality: { status: "assay-required" } };
    },
  });
  assert.equal(projected.senAct, signed.act); assert.equal(projected.predicate, C2PA_BINDING_PREDICATE);
  assert.equal(projected.subject, signed.assetNi); assert.equal(projected.object, signed.manifestNi);
  assert.equal(projected.evidenceRoot, ni("report")); assert.equal(result.evidenceRoot, projected.evidenceRoot);
  assert.equal(result.commitment.finality.status, "assay-required");
});

test("an anchor not authorized by the accountable publisher for the exact act is refused", async () => {
  const signed = signedFixture();
  await assert.rejects(
    publishArticle50Asset({ signing: { caller: CALLER }, anchor: {}, sign: async () => signed, project: async () => ({ account: "eip155:31337:0xother", senSemanticDigest: digest(signed.act) }) }),
    /not authorized by the accountable publisher/,
  );
});

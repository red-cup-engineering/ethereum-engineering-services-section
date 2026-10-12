import { C2PA_BINDING_PREDICATE, signAiAsset } from "@red-cup-engineering/c2pa-services-section";
import { makeNiUri, niUriDigestBytes } from "@red-cup-engineering/uri-services-section/ni-uri";
import { projectTypedCommitment } from "./typed-commitment.mjs";

/**
 * Complete an Article 50 media publication: sign, then require the accountable
 * publisher's own account to commit the exact asset/manifest/act/evidence
 * relation on chain. There is no C2PA-only success path. Signing and the
 * binding vocabulary are the C2PA package's; the on-chain commitment is this
 * package's effect.
 */
export async function publishArticle50Asset({ signing, anchor, project = projectTypedCommitment, sign = signAiAsset }) {
  const signed = await sign(signing);
  const evidenceRoot = makeNiUri(Buffer.from(signed.reportBytes));
  const commitment = await project({ ...anchor, senAct: signed.act, predicate: C2PA_BINDING_PREDICATE, subject: signed.assetNi, object: signed.manifestNi, evidenceRoot });
  if (commitment?.account !== signing.caller || commitment?.senSemanticDigest !== `0x${Buffer.from(niUriDigestBytes(signed.act)).toString("hex")}`) {
    throw new Error("EVM receipt was not authorized by the accountable publisher for the exact act");
  }
  return Object.freeze({ ...signed, evidenceRoot, commitment });
}

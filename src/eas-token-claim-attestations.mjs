import { spawnSync } from "node:child_process";

export const TOKEN_CLAIM_EAS_SCHEMA = "bytes32 tokenCommitment,bytes32 claimCommitment,bytes32 lotCommitment,bytes32 witnessProductionCommitment,bytes32 relationCommitment,uint8 articulation";
export const EAS_ATTEST_SIGNATURE = "attest((bytes32,(address,uint64,bool,bytes32,bytes,uint256)))(bytes32)";
export const EAS_REGISTER_SCHEMA_SIGNATURE = "register(string,address,bool)(bytes32)";
const ZERO_ADDRESS = `0x${"00".repeat(20)}`;
const ZERO_WORD = `0x${"00".repeat(32)}`;
const ARTICULATION = Object.freeze({ potential: 0, active: 1, stable: 2, absurd: 3 });

function word(value, label) { if (!/^0x[0-9a-fA-F]{64}$/u.test(value ?? "")) throw new TypeError(`${label} must be bytes32`); return value.toLowerCase(); }
function address(value, label) { if (!/^0x[0-9a-fA-F]{40}$/u.test(value ?? "")) throw new TypeError(`${label} must be an EVM address`); return value.toLowerCase(); }
function cast(args) {
  const result = spawnSync("cast", args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`cast-refused:${(result.stderr || result.stdout).trim()}`);
  return result.stdout.trim();
}

export function prepareTokenClaimEasSchemaRegistration({ schemaRegistry }) {
  return Object.freeze({
    type: "EasTokenClaimSchemaRegistrationRequest",
    protocol: "Ethereum Attestation Service",
    schemaRegistry: address(schemaRegistry, "schemaRegistry"),
    schema: TOKEN_CLAIM_EAS_SCHEMA,
    resolver: ZERO_ADDRESS,
    revocable: false,
    calldata: cast(["calldata", EAS_REGISTER_SCHEMA_SIGNATURE, TOKEN_CLAIM_EAS_SCHEMA, ZERO_ADDRESS, "false"]),
  });
}

export function prepareTokenClaimEasAttestation({ eas, schemaUID, tokenCommitment, claimCommitment, lotCommitment, witnessProductionCommitment, relationCommitment = ZERO_WORD, articulation, refUID = ZERO_WORD, recipient = ZERO_ADDRESS, expirationTime = 0 }) {
  const corner = ARTICULATION[articulation];
  if (corner === undefined) throw new TypeError("articulation must name one FOUR corner");
  if (!Number.isSafeInteger(expirationTime) || expirationTime < 0) throw new TypeError("expirationTime must be a nonnegative safe integer");
  const data = cast(["abi-encode", "f(bytes32,bytes32,bytes32,bytes32,bytes32,uint8)", word(tokenCommitment, "tokenCommitment"), word(claimCommitment, "claimCommitment"), word(lotCommitment, "lotCommitment"), word(witnessProductionCommitment, "witnessProductionCommitment"), word(relationCommitment, "relationCommitment"), String(corner)]);
  const request = { schema: word(schemaUID, "schemaUID"), data: { recipient: address(recipient, "recipient"), expirationTime: String(expirationTime), revocable: false, refUID: word(refUID, "refUID"), data, value: "0" } };
  const tuple = `(${request.schema},(${request.data.recipient},${request.data.expirationTime},false,${request.data.refUID},${request.data.data},0))`;
  return Object.freeze({ type: "EasTokenClaimAttestationRequest", protocol: "Ethereum Attestation Service", eas: address(eas, "eas"), schema: TOKEN_CLAIM_EAS_SCHEMA, request, call: { signature: EAS_ATTEST_SIGNATURE, tuple }, monetaryValue: "0", truthClaimed: false, customerAcceptanceClaimed: false });
}

export function isTokenClaimAttestationValid({ eas, uid, rpcUrl }) {
  if (typeof rpcUrl !== "string" || !rpcUrl) return false;
  return cast(["call", address(eas, "eas"), "isAttestationValid(bytes32)(bool)", word(uid, "uid"), "--rpc-url", rpcUrl]) === "true";
}

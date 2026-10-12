import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { prepareTokenClaimEasAttestation } from "./eas-token-claim-attestations.mjs";
import { executeEnterpriseUserOperation } from "./enterprise-user-operation.mjs";
import { createLocalSettlementUserOperationAuthority } from "./local-settlement-user-operation-authority.mjs";

const ATTESTED_EVENT = "Attested(address,address,bytes32,bytes32)";

function cast(args, { json = false } = {}) {
  const result = spawnSync("cast", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`cast ${args[0]} refused: ${(result.stderr || result.stdout).trim()}`);
  return json ? JSON.parse(result.stdout) : result.stdout.trim();
}

function address(value, label) {
  if (!/^0x[0-9a-fA-F]{40}$/u.test(value ?? "")) throw new TypeError(`${label} must be an EVM address`);
  return value.toLowerCase();
}

function bytes32(value, label) {
  if (!/^0x[0-9a-fA-F]{64}$/u.test(value ?? "")) throw new TypeError(`${label} must be bytes32`);
  return value.toLowerCase();
}

function topicAddress(topic, label) {
  return address(`0x${bytes32(topic, label).slice(-40)}`, label);
}

export async function attestTokenClaimThroughEnterpriseAccount({
  bindingPath,
  keystorePath,
  passwordFile,
  rpcUrl,
  bundlerUrl,
  rmnSemanticDigest,
  attestation,
}) {
  const binding = JSON.parse(readFileSync(bindingPath, "utf8"));
  const authority = await createLocalSettlementUserOperationAuthority({ keystorePath, passwordFile, policySigner: binding.policy?.signer });
  const prepared = prepareTokenClaimEasAttestation(attestation);
  const calldata = cast(["calldata", prepared.call.signature, prepared.call.tuple]);
  const operation = await executeEnterpriseUserOperation({
    bindingPath,
    rpcUrl,
    bundlerUrl,
    target: prepared.eas,
    calldata,
    rmnSemanticDigest,
    ...authority,
  });

  const receipt = cast(["receipt", operation.transactionHash, "--rpc-url", rpcUrl, "--json"], { json: true });
  const eventTopic = cast(["keccak", ATTESTED_EVENT]).toLowerCase();
  const eas = address(prepared.eas, "EAS");
  const log = (receipt.logs ?? []).find((candidate) =>
    address(candidate.address, "receipt log address") === eas && candidate.topics?.[0]?.toLowerCase() === eventTopic,
  );
  if (!log) throw new Error("authorized account transaction emitted no EAS Attested event");
  const uid = bytes32(log.data?.slice(0, 66), "attestation UID");
  const schemaUID = bytes32(log.topics?.[3], "event schema UID");
  const attester = topicAddress(log.topics?.[2], "event attester");
  const expectedAttester = address(binding.account?.address, "binding account");
  if (attester !== expectedAttester) throw new Error("EAS attester is not the owning enterprise account");
  if (schemaUID !== prepared.request.schema) throw new Error("EAS event schema does not match the prepared claim schema");
  const valid = cast(["call", eas, "isAttestationValid(bytes32)(bool)", uid, "--rpc-url", rpcUrl]) === "true";
  if (!valid) throw new Error("EAS refused the emitted attestation UID during independent read-back");

  return Object.freeze({
    type: "EnterpriseTokenClaimEasAttestationReceipt",
    protocol: "Ethereum Attestation Service",
    chainId: operation.chainId,
    enterpriseAccount: operation.account,
    attester,
    eas,
    schemaUID,
    uid,
    refUID: prepared.request.data.refUID,
    rmnSemanticDigest: operation.rmnSemanticDigest,
    transactionHash: operation.transactionHash,
    blockNumber: operation.blockNumber,
    userOpHash: operation.userOpHash,
    valid,
    directEoaExecution: operation.directEoaExecution,
    truthClaimed: prepared.truthClaimed,
    customerAcceptanceClaimed: prepared.customerAcceptanceClaimed,
  });
}

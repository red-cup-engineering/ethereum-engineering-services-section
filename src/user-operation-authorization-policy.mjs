import { semanticIdentity } from "./semantic-content.mjs";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const BYTES = /^0x(?:[0-9a-fA-F]{2})*$/u;
const QUANTITY = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/u;

function address(value, label) {
  if (typeof value !== "string" || !ADDRESS.test(value)) throw new TypeError(`${label} must be an EVM address`);
  return value.toLowerCase();
}
function quantity(value, label) {
  if (typeof value !== "string" || !QUANTITY.test(value)) throw new TypeError(`${label} must be a canonical EVM quantity`);
  return BigInt(value);
}
function bytes(value, label) {
  if (typeof value !== "string" || !BYTES.test(value)) throw new TypeError(`${label} must be hexadecimal bytes`);
  return value.toLowerCase();
}
function exactKeys(value, required, optional = []) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const permitted = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => permitted.has(key));
}

/**
 * Provider-neutral authorization gate for an ERC-7769 shaped UserOperation.
 * It authorizes one account and bounded call-data commitments; it never signs.
 */
export function createUserOperationAuthorizationPolicy(input) {
  if (!exactKeys(input, ["account", "contracts"], ["chainId", "chainIds", "callDataDigests", "maxSignatures"])) throw new TypeError("UserOperation authorization policy has an invalid topology");
  if ((input.chainId === undefined) === (input.chainIds === undefined)) throw new TypeError("authorization policy requires exactly one chainId or chainIds set");
  const chainIds = new Set(input.chainIds ?? [input.chainId]);
  if ([...chainIds].some((chainId) => !Number.isSafeInteger(chainId) || chainId < 1)) throw new TypeError("authorization policy chainId must be positive");
  if (!Array.isArray(input.contracts) || input.contracts.length === 0) throw new TypeError("authorization policy contracts must be nonempty");
  const contracts = new Set(input.contracts.map((value) => address(value, "authorization contract")));
  const callDataDigests = input.callDataDigests === undefined ? null : new Set(input.callDataDigests);
  if (callDataDigests && [...callDataDigests].some((value) => !/^ni:\/\/\/sha-256;[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u.test(value))) throw new TypeError("authorization policy callDataDigests must be SHA-256 ni URIs");
  if (input.maxSignatures !== undefined && (!Number.isSafeInteger(input.maxSignatures) || input.maxSignatures < 1)) throw new TypeError("authorization policy maxSignatures is invalid");
  let signatures = 0;
  return Object.freeze({
    authorize({ chainId, contract, userOperation }) {
      if (!chainIds.has(chainId)) throw new Error(`authorization policy refuses chain ${chainId}`);
      if (!contracts.has(address(contract, "authorization contract"))) throw new Error(`authorization policy refuses contract ${contract}`);
      const required = ["sender", "nonce", "call_data", "call_gas_limit", "verification_gas_limit", "pre_verification_gas", "max_fee_per_gas", "max_priority_fee_per_gas", "paymaster", "paymaster_data"];
      const optional = ["paymaster_verification_gas_limit", "paymaster_post_op_gas_limit"];
      if (!exactKeys(userOperation, required, optional)) throw new TypeError("user operation has an invalid topology");
      if (address(userOperation.sender, "user operation sender") !== address(input.account, "authorization account")) throw new Error("authorization policy refuses the user operation sender");
      quantity(userOperation.nonce, "user operation nonce");
      const callData = bytes(userOperation.call_data, "user operation call_data");
      for (const field of ["call_gas_limit", "verification_gas_limit", "pre_verification_gas", "max_fee_per_gas", "max_priority_fee_per_gas"]) quantity(userOperation[field], `user operation ${field}`);
      if (userOperation.paymaster !== "0x") address(userOperation.paymaster, "user operation paymaster");
      bytes(userOperation.paymaster_data, "user operation paymaster_data");
      for (const field of optional) if (userOperation[field] !== undefined) quantity(userOperation[field], `user operation ${field}`);
      const digest = semanticIdentity("ethereum.evm-call-data", { encoding: "hex", data: callData });
      if (callDataDigests && !callDataDigests.has(digest)) throw new Error("authorization policy refuses the user operation call data");
      if (input.maxSignatures !== undefined && signatures >= input.maxSignatures) throw new Error("authorization policy signature limit is exhausted");
      signatures += 1;
      return Object.freeze({ chainId, account: address(input.account, "authorization account"), contract: address(contract, "authorization contract"), callDataDigest: digest });
    },
  });
}

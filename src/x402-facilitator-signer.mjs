import { readFileSync } from "node:fs";
import { Interface } from "ethers";
import { createPublicClient, http } from "viem";

import { executeEnterpriseUserOperation } from "./enterprise-user-operation.mjs";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/u;
const BYTES = /^0x(?:[0-9a-fA-F]{2})*$/u;

function receiptTimeout(value) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError("facilitator receipt timeout must be a positive safe integer in milliseconds");
  return value;
}

/**
 * Realize the official x402 FacilitatorEvmSigner interface through exactly one
 * sovereign ERC-4337 account. Every mutation must first receive a normalized
 * RMN semantic digest from the caller-supplied gate.
 */
export function createEnterpriseAccountFacilitatorSigner({
  bindingPath,
  authority,
  rpcUrl,
  bundlerUrl,
  semanticDigest,
  confirmationTimeoutMs = 120_000,
  publicClient = createPublicClient({ transport: http(rpcUrl) }),
  execute = executeEnterpriseUserOperation,
}) {
  const binding = JSON.parse(readFileSync(bindingPath, "utf8"));
  const account = binding.account?.address?.toLowerCase();
  if (!ADDRESS.test(account ?? "")) throw new TypeError("facilitator binding must name one enterprise smart account");
  if (typeof semanticDigest !== "function") throw new TypeError("facilitator signer requires an RMN semantic-digest gate");
  if (typeof authority?.signUserOperationHash !== "function" || typeof authority?.authorizeUserOperation !== "function") throw new TypeError("facilitator signer requires an explicit UserOperation authority");
  // Preserve custody/policy options, but never let them replace the gated call.
  const executionAuthority = Object.freeze({ ...authority });
  const confirmationTimeout = receiptTimeout(confirmationTimeoutMs);

  async function mutate(target, calldata, value = 0n) {
    if (!ADDRESS.test(target ?? "")) throw new TypeError("facilitator mutation target must be an EVM address");
    if (typeof calldata !== "string" || !BYTES.test(calldata)) throw new TypeError("facilitator mutation calldata must be bytes");
    const normalizedValue = BigInt(value);
    if (normalizedValue < 0n || normalizedValue >= (1n << 256n)) throw new RangeError("facilitator mutation value must be uint256");
    const call = Object.freeze({ account, target: target.toLowerCase(), calldata: calldata.toLowerCase(), value: normalizedValue });
    const digest = await semanticDigest(call);
    if (!BYTES32.test(digest ?? "")) throw new TypeError("RMN semantic-digest gate must return bytes32");
    const receipt = await execute({ ...executionAuthority, bindingPath, rpcUrl, bundlerUrl, target: call.target, calldata: call.calldata, value: call.value, rmnSemanticDigest: digest, receiptWaitMs: confirmationTimeout });
    if (!BYTES32.test(receipt?.transactionHash ?? "")) throw new TypeError("facilitator execution receipt must contain a transaction hash");
    return receipt.transactionHash;
  }

  return Object.freeze({
    executionProfile: "ERC-4337",
    getAddresses: () => Object.freeze([account]),
    readContract: (arguments_) => publicClient.readContract(arguments_),
    verifyTypedData: (arguments_) => publicClient.verifyTypedData(arguments_),
    async writeContract({ address, abi, functionName, args = [], dataSuffix, value = 0n }) {
      const contractInterface = new Interface(abi);
      const fragment = contractInterface.getFunction(functionName, args);
      if (fragment === null) throw new TypeError(`facilitator mutation ABI does not contain ${functionName}`);
      let calldata = contractInterface.encodeFunctionData(fragment, args);
      if (dataSuffix !== undefined) {
        if (typeof dataSuffix !== "string" || !BYTES.test(dataSuffix)) throw new TypeError("facilitator dataSuffix must be bytes");
        calldata = `${calldata}${dataSuffix.slice(2)}`;
      }
      return mutate(address, calldata, value);
    },
    sendTransaction: ({ to, data, value = 0n }) => mutate(to, data, value),
    async waitForTransactionReceipt({ hash, timeout = confirmationTimeout }) {
      if (!BYTES32.test(hash ?? "")) throw new TypeError("facilitator receipt lookup requires a transaction hash");
      const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: Math.min(receiptTimeout(timeout), confirmationTimeout) });
      return { status: receipt.status, logs: receipt.logs };
    },
    getCode: ({ address }) => publicClient.getCode({ address }),
  });
}


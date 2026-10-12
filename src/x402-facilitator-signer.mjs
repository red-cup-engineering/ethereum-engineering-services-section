import { readFileSync } from "node:fs";
import { Interface } from "ethers";
import { createPublicClient, http } from "viem";

import { executeEnterpriseUserOperation } from "./enterprise-user-operation.mjs";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/u;

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
  publicClient = createPublicClient({ transport: http(rpcUrl) }),
  execute = executeEnterpriseUserOperation,
}) {
  const binding = JSON.parse(readFileSync(bindingPath, "utf8"));
  const account = binding.account?.address?.toLowerCase();
  if (!ADDRESS.test(account ?? "")) throw new TypeError("facilitator binding must name one enterprise smart account");
  if (typeof semanticDigest !== "function") throw new TypeError("facilitator signer requires an RMN semantic-digest gate");
  if (typeof authority?.signUserOperationHash !== "function" || typeof authority?.authorizeUserOperation !== "function") throw new TypeError("facilitator signer requires an explicit UserOperation authority");

  async function mutate(target, calldata, value = 0n) {
    if (!ADDRESS.test(target ?? "")) throw new TypeError("facilitator mutation target must be an EVM address");
    if (!/^0x(?:[0-9a-fA-F]{2})*$/u.test(calldata ?? "")) throw new TypeError("facilitator mutation calldata must be bytes");
    const digest = await semanticDigest(Object.freeze({ account, target: target.toLowerCase(), calldata, value: BigInt(value) }));
    if (!BYTES32.test(digest ?? "")) throw new TypeError("RMN semantic-digest gate must return bytes32");
    const receipt = await execute({ bindingPath, rpcUrl, bundlerUrl, target, calldata, value, rmnSemanticDigest: digest, ...authority });
    return receipt.transactionHash;
  }

  return Object.freeze({
    executionProfile: "ERC-4337",
    getAddresses: () => Object.freeze([account]),
    readContract: (arguments_) => publicClient.readContract(arguments_),
    verifyTypedData: (arguments_) => publicClient.verifyTypedData(arguments_),
    async writeContract({ address, abi, functionName, args = [], dataSuffix }) {
      const contractInterface = new Interface(abi);
      const fragment = contractInterface.getFunction(functionName, args);
      if (fragment === null) throw new TypeError(`facilitator mutation ABI does not contain ${functionName}`);
      let calldata = contractInterface.encodeFunctionData(fragment, args);
      if (dataSuffix !== undefined) calldata = `${calldata}${dataSuffix.slice(2)}`;
      return mutate(address, calldata);
    },
    sendTransaction: ({ to, data }) => mutate(to, data),
    async waitForTransactionReceipt({ hash }) {
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      return { status: receipt.status, logs: receipt.logs };
    },
    getCode: ({ address }) => publicClient.getCode({ address }),
  });
}

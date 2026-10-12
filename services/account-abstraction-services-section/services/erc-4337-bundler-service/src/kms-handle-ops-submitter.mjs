import { Interface, Transaction } from "ethers";

const ENTRY_POINT = new Interface(["function handleOps((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature)[] ops,address beneficiary)"]);
const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;

/** Atomic outer-bundle submission: a remote signer authorizes only EntryPoint.handleOps. */
export async function submitUserOperationBundleToEntryPoint({ rpc, chainId, entryPoint, beneficiary, operation, signer, gasLimit, maxFeePerGas, maxPriorityFeePerGas, nonce }) {
  if (typeof rpc !== "function" || !Number.isSafeInteger(chainId) || !ADDRESS.test(entryPoint ?? "") || !ADDRESS.test(beneficiary ?? "") || !signer?.signDigest || !ADDRESS.test(signer.address ?? "")) throw new TypeError("validated RPC, chain, EntryPoint, beneficiary, and remote signer are required");
  const data = ENTRY_POINT.encodeFunctionData("handleOps", [[operation], beneficiary]);
  const unsigned = Transaction.from({ chainId, to: entryPoint, data, nonce: BigInt(nonce), gasLimit: BigInt(gasLimit), maxFeePerGas: BigInt(maxFeePerGas), maxPriorityFeePerGas: BigInt(maxPriorityFeePerGas), type: 2 });
  const signature = await signer.signDigest(unsigned.unsignedHash);
  const raw = Transaction.from({ ...unsigned, signature }).serialized;
  const transactionHash = await rpc("eth_sendRawTransaction", [raw]);
  if (!/^0x[0-9a-fA-F]{64}$/u.test(transactionHash ?? "")) throw new Error("chain refused handleOps bundle");
  return Object.freeze({ transactionHash: transactionHash.toLowerCase(), entryPoint: entryPoint.toLowerCase(), beneficiary: beneficiary.toLowerCase(), signer: signer.address.toLowerCase() });
}

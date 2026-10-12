import { readFileSync } from "node:fs";
import { Interface, recoverAddress } from "ethers";
import { toPackedUserOperation } from "viem/account-abstraction";

const ACCOUNT_ABI = new Interface([
  "function entryPoint() view returns (address)",
  "function executeRmn(bytes32 rmnSemanticDigest, (address target, uint256 value, bytes data)[] calls)",
  "function validateUserOp((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature) userOp, bytes32 userOpHash, uint256 missingAccountFunds) returns (uint256)",
]);
const ENTRY_POINT_ABI = new Interface([
  "function getNonce(address sender, uint192 key) view returns (uint256)",
  "function getUserOpHash((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature) userOp) view returns (bytes32)",
]);

let nextRpcId = 0;

async function rpc(url, method, params = []) {
  let response;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++nextRpcId, method, params }),
      });
      break;
    } catch (error) {
      if (attempt === 7) throw error;
      await new Promise((resolveWait) => setTimeout(resolveWait, 125 * (attempt + 1)));
    }
  }
  const raw = await response.text();
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new Error(`${method} HTTP ${response.status} returned a non-JSON response`);
  }
  if (body.error) throw new Error(`${method} refused (${body.error.code}): ${body.error.message}`);
  if (!response.ok) throw new Error(`${method} HTTP ${response.status}`);
  return body.result;
}

function bytes32(value, label) {
  if (!/^0x[0-9a-fA-F]{64}$/u.test(value ?? "")) throw new Error(`${label} must be bytes32`);
  return value.toLowerCase();
}
function address(value, label) {
  if (!/^0x[0-9a-fA-F]{40}$/u.test(value ?? "")) throw new Error(`${label} must be an EVM address`);
  return value.toLowerCase();
}
function hex(value, label) {
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/u.test(value)) throw new Error(`${label} must be even-length hex`);
  return value.toLowerCase();
}
const quantity = (value) => `0x${BigInt(value).toString(16)}`;
const STUB_SIGNATURE = `0x${"00".repeat(64)}01`;

async function waitForUserOperationReceipt(bundlerUrl, userOpHash, waitMs) {
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    const receipt = await rpc(bundlerUrl, "eth_getUserOperationReceipt", [userOpHash]);
    if (receipt) return receipt;
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`bundler did not return a receipt for ${userOpHash} within ${waitMs}ms`);
}

/**
 * Prepare one locally-valid ERC-4337 operation without admitting it to a
 * bundler.  The caller retains the signed packed operation for a separately
 * authorized outer `handleOps` submitter.
 */
export async function prepareEnterpriseUserOperation({
  bindingPath,
  rpcUrl,
  bundlerUrl,
  target,
  calldata,
  rmnSemanticDigest,
  value = 0n,
  maxFeePerGas,
  maxPriorityFeePerGas,
  signUserOperationHash,
  paymaster,
  forbidPaymaster = false,
  preparationProfile,
  authorizeUserOperation,
}) {
  if (typeof signUserOperationHash !== "function") throw new TypeError("signUserOperationHash authority is required");
  if (typeof authorizeUserOperation !== "function") throw new TypeError("authorizeUserOperation authority is required");
  if (!bundlerUrl && preparationProfile === undefined) throw new Error("bundlerUrl is required unless a bounded preparationProfile replaces bundler estimation");
  const binding = JSON.parse(readFileSync(bindingPath, "utf8"));
  const account = address(binding.account?.address, "binding account");
  const policySigner = address(binding.policy?.signer, "binding policy signer");
  const callTarget = address(target, "target");
  const initCode = binding.account?.initCode === undefined ? null : hex(binding.account.initCode, "binding account initCode");
  if (initCode !== null && initCode.length < 42) throw new Error("counterfactual initCode must prefix factory address and factory calldata");
  const factory = initCode === null ? null : address(initCode.slice(0, 42), "counterfactual factory");
  const factoryData = initCode === null ? null : `0x${initCode.slice(42)}`;

  const chainCall = ({ to, from, data }) => rpc(rpcUrl, "eth_call", [{ to, ...(from ? { from } : {}), data }, "latest"]);
  // A counterfactual account has no code to ask yet.  Its binding pins the
  // EntryPoint; deployed accounts continue to prove it from the account.
  const deployedCode = await rpc(rpcUrl, "eth_getCode", [account, "latest"]);
  const counterfactual = deployedCode === "0x";
  if (counterfactual !== (initCode !== null)) throw new Error("binding initCode must agree with counterfactual account code");
  const entryPoint = counterfactual
    ? address(binding.account?.entryPoint, "counterfactual binding entryPoint")
    : address(ACCOUNT_ABI.decodeFunctionResult("entryPoint", await chainCall({ to: account, data: ACCOUNT_ABI.encodeFunctionData("entryPoint") }))[0], "entry point");
  if (preparationProfile !== undefined && (!preparationProfile || typeof preparationProfile !== "object" || Array.isArray(preparationProfile))) throw new TypeError("preparationProfile must be one bounded manifest");
  const profileQuantity = (field) => {
    const value = preparationProfile?.[field];
    if (!/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/u.test(value ?? "")) throw new TypeError(`preparationProfile.${field} must be a hex quantity`);
    return BigInt(value);
  };
  if (preparationProfile === undefined) {
    const supported = await rpc(bundlerUrl, "eth_supportedEntryPoints");
    if (!Array.isArray(supported) || !supported.some((candidate) => candidate.toLowerCase() === entryPoint)) {
      throw new Error("the contracted bundler does not support the account EntryPoint");
    }
  } else if (address(preparationProfile.entryPoint, "preparationProfile entryPoint") !== entryPoint) {
    throw new Error("preparationProfile does not bind the account EntryPoint");
  }
  const chainId = Number(BigInt(await rpc(rpcUrl, "eth_chainId")));
  if (chainId !== binding.chain.chainId) throw new Error("RPC chain and account binding drifted");

  const accountCallData = ACCOUNT_ABI.encodeFunctionData("executeRmn", [bytes32(rmnSemanticDigest, "rmnSemanticDigest"), [{ target: callTarget, value: BigInt(value), data: calldata }]]);
  const nonce = BigInt(ENTRY_POINT_ABI.decodeFunctionResult("getNonce", await chainCall({ to: entryPoint, data: ENTRY_POINT_ABI.encodeFunctionData("getNonce", [account, 0]) }))[0]);
  const observedGasPrice = BigInt(await rpc(rpcUrl, "eth_gasPrice"));
  const priorityFee = maxPriorityFeePerGas === undefined ? (preparationProfile ? profileQuantity("maxPriorityFeePerGas") : observedGasPrice) : BigInt(maxPriorityFeePerGas);
  const maximumFee = maxFeePerGas === undefined ? (preparationProfile ? profileQuantity("maxFeePerGas") : observedGasPrice * 2n) : BigInt(maxFeePerGas);
  if (maximumFee < priorityFee) throw new Error("maxFeePerGas must cover maxPriorityFeePerGas");

  const draft = {
    sender: account,
    nonce: quantity(nonce),
    factory,
    factoryData,
    callData: accountCallData,
    callGasLimit: "0x0",
    verificationGasLimit: "0x0",
    preVerificationGas: "0x0",
    maxFeePerGas: quantity(maximumFee),
    maxPriorityFeePerGas: quantity(priorityFee),
    paymaster: null,
    paymasterData: null,
    paymasterVerificationGasLimit: null,
    paymasterPostOpGasLimit: null,
    signature: STUB_SIGNATURE,
  };
  if (forbidPaymaster && paymaster) throw new Error("this transition forbids paymaster sponsorship");
  const stubbed = paymaster ? { ...draft, ...await paymaster.stub({ operation: draft, entryPoint, chainId }) } : draft;
  const estimate = preparationProfile ?? await rpc(bundlerUrl, "eth_estimateUserOperationGas", [stubbed, entryPoint]);
  const callGasLimit = preparationProfile ? profileQuantity("callGasLimit") : BigInt(estimate.callGasLimit);
  const verificationGasLimit = preparationProfile ? profileQuantity("verificationGasLimit") : BigInt(estimate.verificationGasLimit);
  const preVerificationGas = preparationProfile ? profileQuantity("preVerificationGas") : BigInt(estimate.preVerificationGas);
  let operation = {
    ...stubbed,
    callGasLimit: quantity(callGasLimit),
    verificationGasLimit: quantity(verificationGasLimit),
    preVerificationGas: quantity(preVerificationGas),
  };
  if (paymaster) operation = { ...operation, ...await paymaster.final({ operation, entryPoint, chainId }) };
  const unsignedPacked = toPackedUserOperation({
    sender: account, factory, factoryData,
    nonce,
    callData: accountCallData,
    callGasLimit,
    verificationGasLimit,
    preVerificationGas,
    maxFeePerGas: maximumFee,
    maxPriorityFeePerGas: priorityFee,
    paymaster: operation.paymaster,
    paymasterData: operation.paymasterData,
    paymasterVerificationGasLimit: operation.paymasterVerificationGasLimit === null ? undefined : BigInt(operation.paymasterVerificationGasLimit),
    paymasterPostOpGasLimit: operation.paymasterPostOpGasLimit === null ? undefined : BigInt(operation.paymasterPostOpGasLimit),
    signature: "0x",
  });
  const userOpHash = bytes32(ENTRY_POINT_ABI.decodeFunctionResult("getUserOpHash", await chainCall({
    to: entryPoint,
    data: ENTRY_POINT_ABI.encodeFunctionData("getUserOpHash", [[
      unsignedPacked.sender,
      unsignedPacked.nonce,
      unsignedPacked.initCode,
      unsignedPacked.callData,
      unsignedPacked.accountGasLimits,
      unsignedPacked.preVerificationGas,
      unsignedPacked.gasFees,
      unsignedPacked.paymasterAndData,
      unsignedPacked.signature,
    ]]),
  }))[0], "EntryPoint user operation hash");
  await authorizeUserOperation(Object.freeze({ chainId, entryPoint, account, operation, userOpHash }));
  const signature = await signUserOperationHash(userOpHash);
  if (recoverAddress(userOpHash, signature).toLowerCase() !== policySigner) throw new Error("UserOperation signer does not match the bound policy signer");
  const packed = { ...unsignedPacked, signature };
  if (!counterfactual) {
    const validationCall = ACCOUNT_ABI.encodeFunctionData("validateUserOp", [[packed.sender, packed.nonce, packed.initCode, packed.callData, packed.accountGasLimits, packed.preVerificationGas, packed.gasFees, packed.paymasterAndData, packed.signature], userOpHash, 0]);
    const validationData = BigInt(ACCOUNT_ABI.decodeFunctionResult("validateUserOp", await chainCall({ to: account, from: entryPoint, data: validationCall }))[0]);
    if (validationData !== 0n) throw new Error("enterprise account refused its locally prepared UserOperation signature");
  }
  operation = { ...operation, signature };
  return Object.freeze({
    type: "PreparedEnterpriseUserOperation",
    protocol: "ERC-4337/ERC-7769",
    chainId: `eip155:${chainId}`,
    account: binding.account.caip10,
    entryPoint,
    target: callTarget,
    rmnSemanticDigest: rmnSemanticDigest.toLowerCase(),
    userOpHash,
    policySigner,
    operation: Object.freeze(operation),
    packedOperation: Object.freeze(packed),
    fees: Object.freeze({ maxFeePerGas: maximumFee.toString(), maxPriorityFeePerGas: priorityFee.toString() }),
    directEoaExecution: false,
    counterfactual,
  });
}

export async function executeEnterpriseUserOperation(input) {
  const prepared = await prepareEnterpriseUserOperation(input);
  const admittedHash = bytes32(await rpc(input.bundlerUrl, "eth_sendUserOperation", [prepared.operation, prepared.entryPoint]), "bundler user operation hash");
  if (admittedHash !== prepared.userOpHash) throw new Error("bundler returned a different UserOperation hash");
  const receipt = await waitForUserOperationReceipt(input.bundlerUrl, admittedHash, input.receiptWaitMs ?? 120_000);
  if (receipt.success !== true) throw new Error(`UserOperation execution failed: ${receipt.reason ?? "no reason supplied"}`);
  return Object.freeze({
    type: "EnterpriseUserOperationReceipt", protocol: prepared.protocol, chainId: prepared.chainId,
    account: prepared.account, entryPoint: prepared.entryPoint, target: prepared.target,
    rmnSemanticDigest: prepared.rmnSemanticDigest, userOpHash: prepared.userOpHash,
    transactionHash: bytes32(receipt.receipt?.transactionHash, "bundle transaction hash"),
    blockNumber: Number(BigInt(receipt.receipt?.blockNumber)), policySigner: prepared.policySigner,
    directEoaExecution: false,
  });
}

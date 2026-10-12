import { randomBytes } from "node:crypto";

import {
  Interface,
  JsonRpcProvider,
  Signature,
  Transaction,
  getAddress,
  keccak256,
  toUtf8Bytes,
  zeroPadValue,
} from "ethers";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/u;
const FACTORY = new Interface([
  "function accountAddress(bytes32 enterpriseId,address policySigner,bytes32 userSalt) view returns (address)",
  "function deploy(bytes32 enterpriseId,address policySigner,bytes32 userSalt) payable returns (address)",
  "event EnterpriseAccountDeployed(bytes32 indexed enterpriseId,address indexed account,address indexed policySigner,bytes32 userSalt)",
]);

function address(value, label) {
  if (!ADDRESS.test(value ?? "")) throw new TypeError(`${label} must be an EVM address`);
  return getAddress(value).toLowerCase();
}

function bytes32(value, label) {
  if (!BYTES32.test(value ?? "")) throw new TypeError(`${label} must be bytes32`);
  return value.toLowerCase();
}

function standard(deployment, identity) {
  const matches = deployment?.deployments?.filter((entry) => entry.standard === identity) ?? [];
  if (matches.length !== 1) throw new TypeError(`deployment must name exactly one ${identity}`);
  return matches[0];
}

function deploymentLogFilter({ factory, enterpriseId, account, policySigner, fromBlock }) {
  return {
    address: factory,
    fromBlock,
    toBlock: "latest",
    topics: [
      FACTORY.getEvent("EnterpriseAccountDeployed").topicHash,
      enterpriseId,
      zeroPadValue(account, 32),
      zeroPadValue(policySigner, 32),
    ],
  };
}

function deploymentWitness(logs, userSalt) {
  const matches = logs.filter((log) => {
    try {
      return FACTORY.parseLog(log)?.args.userSalt.toLowerCase() === userSalt;
    } catch {
      return false;
    }
  });
  if (matches.length !== 1) throw new Error("the chain must contain exactly one matching enterprise-account deployment event");
  return matches[0];
}

async function signedTransaction({ provider, signer, to, data = "0x", value = 0n }) {
  const chainId = Number((await provider.getNetwork()).chainId);
  const [nonce, fee, estimate] = await Promise.all([
    provider.getTransactionCount(signer.address, "pending"),
    provider.getFeeData(),
    provider.estimateGas({ from: signer.address, to, data, value }),
  ]);
  const gasPrice = fee.gasPrice ?? fee.maxFeePerGas;
  if (gasPrice === null || gasPrice === undefined) throw new Error("settlement RPC returned no transaction gas price");
  const transaction = Transaction.from({
    type: 0,
    chainId,
    nonce,
    to,
    data,
    value,
    gasLimit: estimate + estimate / 5n,
    gasPrice,
  });
  transaction.signature = Signature.from(await signer.signDigest(transaction.unsignedHash));
  const sent = await provider.broadcastTransaction(transaction.serialized);
  const receipt = await sent.wait(1, 120_000);
  if (!receipt || receipt.status !== 1) throw new Error(`enterprise-account transaction failed: ${sent.hash}`);
  return receipt;
}

/**
 * Reconcile one stable enterprise URN to one funded EnterpriseAccount on the
 * Union settlement chain.  Signing authority is injected and may live in a
 * remote HSM; this operation never reads or writes private key material.
 */
export async function provisionEnterpriseAccount({
  rpcUrl,
  provider = rpcUrl ? new JsonRpcProvider(rpcUrl, undefined, { batchMaxCount: 1 }) : undefined,
  deployment,
  urn,
  policySigner,
  deployerSigner,
  minimumFundingWei = 0n,
  userSalt,
}) {
  if (!provider) throw new TypeError("settlement RPC provider is required");
  if (typeof urn !== "string" || !urn.startsWith("urn:")) throw new TypeError("enterprise URN must be stable");
  if (!deployerSigner || typeof deployerSigner.signDigest !== "function") throw new TypeError("remote deployer signing authority is required");
  const signer = address(policySigner, "policy signer");
  const deployer = address(deployerSigner.address, "deployer signer");
  const funding = BigInt(minimumFundingWei);
  if (funding < 0n) throw new TypeError("minimum account funding must be nonnegative");

  const chainId = Number((await provider.getNetwork()).chainId);
  if (!Number.isSafeInteger(chainId) || chainId < 1 || deployment?.chainId !== `eip155:${chainId}`) {
    throw new Error("standards deployment and live settlement chain disagree");
  }
  const entryPointDeployment = standard(deployment, "org.ethereum.erc-4337.entry-point.v0.8");
  const factoryDeployment = standard(deployment, "org.emsenn.evm.sovereign-enterprise-account.v3");
  const entryPoint = address(entryPointDeployment.address, "EntryPoint");
  const factory = address(factoryDeployment.address, "EnterpriseAccount factory");
  const [entryPointCode, factoryCode] = await Promise.all([provider.getCode(entryPoint), provider.getCode(factory)]);
  if (entryPointCode === "0x" || factoryCode === "0x") throw new Error("canonical EntryPoint or EnterpriseAccount factory is absent");

  const enterpriseId = keccak256(toUtf8Bytes(urn)).toLowerCase();
  const salt = bytes32(userSalt ?? keccak256(toUtf8Bytes([
    "org.emsenn.evm.enterprise-account.v3",
    `eip155:${chainId}`,
    urn,
    signer,
  ].join("\n"))), "enterprise account salt");
  const encodedAddress = await provider.call({
    to: factory,
    data: FACTORY.encodeFunctionData("accountAddress", [enterpriseId, signer, salt]),
  });
  const account = address(FACTORY.decodeFunctionResult("accountAddress", encodedAddress)[0], "predicted EnterpriseAccount");
  const filter = deploymentLogFilter({
    factory,
    enterpriseId,
    account,
    policySigner: signer,
    fromBlock: factoryDeployment.blockNumber ?? 0,
  });

  let deploymentReceipt = null;
  let accountCode = await provider.getCode(account);
  if (accountCode === "0x") {
    deploymentReceipt = await signedTransaction({
      provider,
      signer: { address: deployer, signDigest: deployerSigner.signDigest.bind(deployerSigner) },
      to: factory,
      data: FACTORY.encodeFunctionData("deploy", [enterpriseId, signer, salt]),
      value: funding,
    });
    accountCode = await provider.getCode(account);
    if (accountCode === "0x") throw new Error("factory receipt succeeded without deploying the EnterpriseAccount");
  }

  let balance = await provider.getBalance(account);
  const fundingReceipts = [];
  if (balance < funding) {
    const receipt = await signedTransaction({ provider, signer: { address: deployer, signDigest: deployerSigner.signDigest.bind(deployerSigner) }, to: account, value: funding - balance });
    fundingReceipts.push(receipt.hash);
    balance = await provider.getBalance(account);
  }
  if (balance < funding) throw new Error("EnterpriseAccount remains below its required funding floor");

  const witness = deploymentWitness(await provider.getLogs(filter), salt);
  const transaction = (witness.transactionHash ?? deploymentReceipt?.hash)?.toLowerCase();
  const block = Number(witness.blockNumber ?? deploymentReceipt?.blockNumber);
  if (!BYTES32.test(transaction ?? "") || !Number.isSafeInteger(block) || block < 0) {
    throw new Error("enterprise-account deployment event has no durable transaction coordinate");
  }
  return Object.freeze({
    type: "EnterpriseAccountProvisioningReceipt",
    chain: `eip155:${chainId}`,
    chainId,
    urn,
    enterpriseId,
    entryPoint,
    factory,
    account,
    policySigner: signer,
    userSalt: salt,
    deployment: Object.freeze({ transaction, block }),
    balanceWei: balance.toString(),
    fundingTransactions: Object.freeze(fundingReceipts),
    deployer,
    custody: deployerSigner.custody ?? "injected-remote-signer",
    idempotent: deploymentReceipt === null,
    authority: Object.freeze({ enterpriseUrn: urn, enterpriseId }),
    policyCapability: Object.freeze({ signer }),
    funding: Object.freeze({
      source: "remote-cloud-kms-treasury",
      treasury: deployer,
      custody: deployerSigner.custody ?? "injected-remote-signer",
      keyVersion: deployerSigner.keyVersion ?? null,
      minimumWei: funding.toString(),
      balanceWei: balance.toString(),
      transactions: Object.freeze(fundingReceipts),
    }),
    chainAccounting: Object.freeze({
      deployment: Object.freeze({ transaction, block }),
      idempotentReconciliation: deploymentReceipt === null,
    }),
  });
}

export function randomEnterpriseAccountSalt() {
  return `0x${randomBytes(32).toString("hex")}`;
}

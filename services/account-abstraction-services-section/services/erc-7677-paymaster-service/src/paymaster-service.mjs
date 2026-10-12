import { readFileSync, statSync } from "node:fs";
import { AbiCoder, Interface, Wallet, decryptKeystoreJson, isKeystoreJson, recoverAddress } from "ethers";
import { toPackedUserOperation } from "viem/account-abstraction";

export const PAYMASTER_SERVICE_PROFILE = "org.emsenn.evm.enterprise-provisioning-sponsorship.v1";
const CAIP10 = /^eip155:([0-9]+):(0x[0-9a-fA-F]{40})$/u;
const NI = /^ni:\/\/\/sha-256;([A-Za-z0-9_-]{42}[AEIMQUYcgkosw048])$/u;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const QUANTITY = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/u;
const PAYMASTER_VALIDATION_GAS = 200_000n;
const PAYMASTER_POST_OP_GAS = 1n;
const VALIDITY_SECONDS = 3_600;

const factoryInterface = new Interface([
  "function accountAddress(bytes32 enterpriseId,address policySigner,bytes32 userSalt) view returns (address)",
  "function deploy(bytes32 enterpriseId,address policySigner,bytes32 userSalt) returns (address)",
]);
const accountInterface = new Interface([
  "function executeSen(bytes32 senSemanticDigest,(address target,uint256 value,bytes data)[] calls)",
]);
const paymasterInterface = new Interface([
  "function sponsorAccount() view returns (address)",
  "function entryPoint() view returns (address)",
  "function factory() view returns (address)",
  "function provisioningLawDigest() view returns (bytes32)",
  "function getDeposit() view returns (uint256)",
  "function sponsorshipDigest((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature) userOp,uint48 validUntil,uint48 validAfter) view returns (bytes32)",
]);

function exactKeys(value, keys) {
  return value && Object.getPrototypeOf(value) === Object.prototype
    && Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}
function address(value, field) {
  if (typeof value !== "string" || !ADDRESS.test(value)) throw new Error(`${field} must be an EVM address`);
  return value.toLowerCase();
}
function quantity(value, field) {
  if (typeof value !== "string" || !QUANTITY.test(value)) throw new Error(`${field} must be a canonical EVM quantity`);
  return BigInt(value);
}
function niDigest(value, field) {
  const match = typeof value === "string" ? NI.exec(value) : null;
  if (!match) throw new Error(`${field} must be a SHA-256 ni URI`);
  return `0x${Buffer.from(match[1], "base64url").toString("hex")}`;
}
function loadSigner(keystorePath, passwordFile) {
  for (const [path, field] of [[keystorePath, "keystore"], [passwordFile, "password file"]]) {
    if ((statSync(path).mode & 0o077) !== 0) throw new Error(`${field} must be private`);
  }
  const keystore = readFileSync(keystorePath, "utf8");
  if (!isKeystoreJson(keystore)) throw new Error("sponsor custody must use Ethereum Secret Storage v3");
  const passwordBytes = readFileSync(passwordFile);
  const password = passwordBytes.toString("utf8").replace(/[\r\n]+$/u, "");
  passwordBytes.fill(0);
  if (password.length < 16) throw new Error("sponsor password must contain at least 16 characters");
  return decryptKeystoreJson(keystore, password).then(({ privateKey }) => new Wallet(privateKey));
}

let rpcId = 0;
async function rpc(url, method, params = []) {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", connection: "close" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }) });
  const body = await response.json();
  if (!response.ok || body.error) throw new Error(`${method} refused: ${body.error?.message ?? `HTTP ${response.status}`}`);
  return body.result;
}

function deploymentByStandard(deployment, standard) {
  const matches = deployment.deployments?.filter((entry) => entry.standard === standard) ?? [];
  if (matches.length !== 1) throw new Error(`deployment must name exactly one ${standard}`);
  return matches[0];
}

export async function createEnterpriseProvisioningPaymasterService({
  rpcUrl,
  expectedChainId,
  bindingPath,
  keystorePath,
  passwordFile,
  deploymentPath,
  now,
}) {
  if (!rpcUrl) throw new Error("rpcUrl is required");
  if (typeof expectedChainId !== "string" || !/^eip155:[0-9]+$/u.test(expectedChainId)) throw new Error("expectedChainId must be a CAIP-2 EVM chain identifier");
  const binding = JSON.parse(readFileSync(bindingPath, "utf8"));
  const deployment = JSON.parse(readFileSync(deploymentPath, "utf8"));
  const chainId = Number(BigInt(await rpc(rpcUrl, "eth_chainId")));
  const observedChainId = `eip155:${chainId}`;
  if (expectedChainId !== observedChainId) throw new Error(`unexpected chain: expected ${expectedChainId}, observed ${observedChainId}`);
  if (deployment.chainId !== observedChainId || binding.chain?.chainId !== chainId) throw new Error("chain identity drift");
  const entryPoint = address(deploymentByStandard(deployment, "org.ethereum.erc-4337.entry-point.v0.8").address, "EntryPoint");
  const factory = address(deploymentByStandard(deployment, "org.emsenn.evm.sovereign-enterprise-account.v3").address, "factory");
  const paymasterDeployment = deploymentByStandard(deployment, "org.emsenn.evm.enterprise-provisioning-paymaster.v1");
  const paymaster = address(paymasterDeployment.address, "paymaster");
  const sponsorAccount = address(binding.account?.address, "sponsor account");
  const sponsorSigner = address(binding.policy?.signer, "sponsor policy signer");
  const provisioningLaw = paymasterDeployment.provisioningLaw;
  const provisioningLawDigest = niDigest(provisioningLaw, "provisioning law");
  const signer = await loadSigner(keystorePath, passwordFile);
  if (signer.address.toLowerCase() !== sponsorSigner) throw new Error("sponsor keystore does not match account policy");

  const chainCall = async (to, data) => rpc(rpcUrl, "eth_call", [{ to, data }, "latest"]);
  const chainTime = now
    ? async () => now()
    : async () => Number(BigInt((await rpc(rpcUrl, "eth_getBlockByNumber", ["latest", false])).timestamp));
  const readPaymaster = async (name) => paymasterInterface.decodeFunctionResult(name, await chainCall(paymaster, paymasterInterface.encodeFunctionData(name)))[0];
  if (address(await readPaymaster("sponsorAccount"), "observed sponsor") !== sponsorAccount) throw new Error("paymaster sponsor account drift");
  if (address(await readPaymaster("entryPoint"), "observed EntryPoint") !== entryPoint) throw new Error("paymaster EntryPoint drift");
  if (address(await readPaymaster("factory"), "observed factory") !== factory) throw new Error("paymaster factory drift");
  if (String(await readPaymaster("provisioningLawDigest")).toLowerCase() !== provisioningLawDigest) throw new Error("paymaster provisioning law drift");
  if (BigInt(await readPaymaster("getDeposit")) === 0n) throw new Error("paymaster has no EntryPoint deposit");

  function inspectRequest(params) {
    if (!Array.isArray(params) || params.length !== 4) throw new Error("ERC-7677 requires [userOp, entryPoint, chainId, context]");
    const [userOp, requestedEntryPoint, requestedChain, context] = params;
    if (address(requestedEntryPoint, "requested EntryPoint") !== entryPoint) throw new Error("unsupported EntryPoint");
    if (quantity(requestedChain, "requested chain") !== BigInt(chainId)) throw new Error("unsupported chain");
    if (!exactKeys(context, ["customer", "law", "profile"]) || context.profile !== PAYMASTER_SERVICE_PROFILE || context.law !== provisioningLaw) throw new Error("invalid provisioning sponsorship context");
    const customer = CAIP10.exec(context.customer);
    if (!customer || Number(customer[1]) !== chainId || address(customer[2], "customer account") !== address(userOp.sender, "sender")) throw new Error("customer account does not match counterfactual sender");
    if (address(userOp.factory, "UserOperation factory") !== factory) throw new Error("noncanonical account factory");
    const deploy = factoryInterface.decodeFunctionData("deploy", userOp.factoryData);
    const predictedData = factoryInterface.encodeFunctionData("accountAddress", deploy);
    return { userOp, deploy, predictedData, sender: address(userOp.sender, "sender") };
  }

  async function sponsor(params, stub) {
    const inspected = inspectRequest(params);
    const predictedResult = await chainCall(factory, inspected.predictedData);
    const predicted = address(factoryInterface.decodeFunctionResult("accountAddress", predictedResult)[0], "predicted account");
    if (predicted !== inspected.sender) throw new Error("factory prediction does not match sender");
    const execution = accountInterface.decodeFunctionData("executeSen", inspected.userOp.callData);
    if (String(execution[0]).toLowerCase() !== provisioningLawDigest || execution[1].length === 0) throw new Error("UserOperation is not the exact provisioning SEN act");
    const observedChainTime = await chainTime();
    const validAfter = Math.max(0, observedChainTime - 5);
    const validUntil = Math.max(observedChainTime, Math.floor(Date.now() / 1000)) + VALIDITY_SECONDS;
    const paymasterVerificationGasLimit = inspected.userOp.paymasterVerificationGasLimit == null
      ? PAYMASTER_VALIDATION_GAS : quantity(inspected.userOp.paymasterVerificationGasLimit, "paymasterVerificationGasLimit");
    const paymasterPostOpGasLimit = inspected.userOp.paymasterPostOpGasLimit == null
      ? PAYMASTER_POST_OP_GAS : quantity(inspected.userOp.paymasterPostOpGasLimit, "paymasterPostOpGasLimit");
    const unpacked = {
      sender: inspected.sender,
      nonce: quantity(inspected.userOp.nonce, "nonce"),
      factory,
      factoryData: inspected.userOp.factoryData,
      callData: inspected.userOp.callData,
      callGasLimit: quantity(inspected.userOp.callGasLimit, "callGasLimit"),
      verificationGasLimit: quantity(inspected.userOp.verificationGasLimit, "verificationGasLimit"),
      preVerificationGas: quantity(inspected.userOp.preVerificationGas, "preVerificationGas"),
      maxFeePerGas: quantity(inspected.userOp.maxFeePerGas, "maxFeePerGas"),
      maxPriorityFeePerGas: quantity(inspected.userOp.maxPriorityFeePerGas, "maxPriorityFeePerGas"),
      paymaster,
      paymasterData: "0x",
      paymasterVerificationGasLimit,
      paymasterPostOpGasLimit,
      signature: "0x",
    };
    const packed = toPackedUserOperation(unpacked);
    const digestResult = await chainCall(paymaster, paymasterInterface.encodeFunctionData("sponsorshipDigest", [packed, validUntil, validAfter]));
    const digest = paymasterInterface.decodeFunctionResult("sponsorshipDigest", digestResult)[0];
    const signature = signer.signingKey.sign(digest).serialized;
    if (recoverAddress(digest, signature).toLowerCase() !== sponsorSigner) throw new Error("sponsorship signature self-check failed");
    const paymasterData = AbiCoder.defaultAbiCoder().encode(["uint48", "uint48", "bytes"], [validUntil, validAfter, signature]);
    return {
      paymaster,
      paymasterData,
      ...(stub ? {
        paymasterVerificationGasLimit: `0x${paymasterVerificationGasLimit.toString(16)}`,
        paymasterPostOpGasLimit: `0x${paymasterPostOpGasLimit.toString(16)}`,
        sponsor: { name: "ERC-7677 Enterprise Provisioning Paymaster" },
        isFinal: false,
      } : {}),
    };
  }

  return Object.freeze({
    profile: PAYMASTER_SERVICE_PROFILE,
    chainId: `eip155:${chainId}`,
    entryPoint,
    factory,
    paymaster,
    sponsorAccount: binding.account.caip10,
    provisioningLaw,
    invoke(method, params) {
      if (method === "pm_getPaymasterStubData") return sponsor(params, true);
      if (method === "pm_getPaymasterData") return sponsor(params, false);
      throw Object.assign(new Error("method not found"), { rpcCode: -32601 });
    },
  });
}

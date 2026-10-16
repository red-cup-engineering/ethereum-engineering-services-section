import { Interface, TypedDataEncoder, keccak256, toUtf8Bytes } from "ethers";
import { EMPTY_WITNESS_ROOT, identifyJsonSemanticContent } from "@red-cup-engineering/computer-data-engineering-services-section/semiotic-expression-notation/semantic-content-identity";
import { NI_URI_PATTERN } from "@red-cup-engineering/uri-services-section/ni-uri";

const PROFILE = "org.emsenn.evm.enterprise-account-controller-binding.v1";
const MAGIC = "0x1626ba7e";
const HASH = /^0x[0-9a-fA-F]{64}$/u;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const DID_KEY = /^did:key:z[1-9A-HJ-NP-Za-km-z]{16,512}$/u;
const CID = /^b[a-z2-7]{16,512}$/u;
const accountInterface = new Interface([
  "function eip712Domain() view returns (bytes1 fields,string name,string version,uint256 chainId,address verifyingContract,bytes32 salt,uint256[] extensions)",
  "function policySigner() view returns (address)",
  "function entryPoint() view returns (address)",
  "function isValidSignature(bytes32 hash,bytes signature) view returns (bytes4)",
]);
const entryPointInterface = new Interface([
  "function getNonce(address sender,uint192 key) view returns (uint256)",
]);
const TYPES = Object.freeze({ EnterpriseAccountControllerBinding: Object.freeze([
  Object.freeze({ name: "delegationCidHash", type: "bytes32" }),
  Object.freeze({ name: "invocationCidHash", type: "bytes32" }),
  Object.freeze({ name: "controllerDidHash", type: "bytes32" }),
  Object.freeze({ name: "actorDidHash", type: "bytes32" }),
  Object.freeze({ name: "resourceDidHash", type: "bytes32" }),
  Object.freeze({ name: "capabilityHash", type: "bytes32" }),
  Object.freeze({ name: "senSemanticDigest", type: "bytes32" }),
  Object.freeze({ name: "a2aCorrelationHash", type: "bytes32" }),
  Object.freeze({ name: "userOpNonce", type: "uint256" }),
  Object.freeze({ name: "notBefore", type: "uint64" }),
  Object.freeze({ name: "expiration", type: "uint64" }),
  Object.freeze({ name: "challengeNonce", type: "bytes32" }),
]) });

function record(value, name) {
  if (value == null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${name} must be an object`);
  return value;
}
function exactKeys(value, keys, name) {
  record(value, name);
  if (Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) throw new TypeError(`${name} has the wrong fields`);
}
function text(value, pattern, name) {
  if (typeof value !== "string" || !pattern.test(value)) throw new TypeError(`${name} is malformed`);
  return value;
}
function uint(value, name, maximum = (1n << 256n) - 1n) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/u.test(value)) throw new TypeError(`${name} must be canonical decimal text`);
  const parsed = BigInt(value);
  if (parsed > maximum) throw new TypeError(`${name} is out of range`);
  return parsed;
}
function lowerAddress(value, name) { return text(value, ADDRESS, name).toLowerCase(); }
function hashText(value) { return keccak256(toUtf8Bytes(value)); }
function identify(value) {
  return identifyJsonSemanticContent({ objectKind: "ethereum.enterprise-account-controller-binding", value, witnessRoot: EMPTY_WITNESS_ROOT }).token;
}
function blockTag(value) { return `0x${value.toString(16)}`; }

function normalizeInput(raw) {
  const input = record(raw, "input");
  exactKeys(input, ["profile", "chain", "account", "resource", "controller", "actor", "delegationCid",
    "invocationCid", "capability", "capabilityNi", "senSemanticDigest", "a2aCorrelation", "userOpNonce", "notBefore",
    "expiration", "challengeNonce", "signature", "block", "blockHash"], "input");
  if (input.profile !== PROFILE) throw new TypeError(`profile must equal ${PROFILE}`);
  const chainMatch = /^eip155:([1-9][0-9]*)$/u.exec(input.chain ?? "");
  if (!chainMatch) throw new TypeError("chain must be a canonical EIP-155 CAIP-2 identifier");
  const chainId = BigInt(chainMatch[1]);
  const account = lowerAddress(input.account, "account");
  const resource = text(input.resource, /^did:pkh:eip155:[1-9][0-9]*:0x[0-9a-fA-F]{40}$/u, "resource");
  if (resource.toLowerCase() !== `did:pkh:${input.chain}:${account}`) throw new TypeError("resource must name the exact chain account");
  const controller = text(input.controller, DID_KEY, "controller");
  const actor = text(input.actor, DID_KEY, "actor");
  if (controller === actor) throw new TypeError("controller and pairwise actor must be distinct principals");
  const delegationCid = text(input.delegationCid, CID, "delegationCid");
  const invocationCid = text(input.invocationCid, CID, "invocationCid");
  const capability = record(input.capability, "capability");
  exactKeys(capability, ["with", "can", "nb"], "capability");
  if (capability.with !== resource || typeof capability.can !== "string" || capability.can.length === 0) throw new TypeError("capability must use the exact resource and a nonempty ability");
  record(capability.nb, "capability.nb");
  // The UCAN verifier owns this capability address. A binding receipt binds it
  // into ERC-1271 context; it must not mint a second address under this
  // receipt's distinct object kind.
  const capabilityNi = text(input.capabilityNi, NI_URI_PATTERN, "capabilityNi");
  const senSemanticDigest = text(input.senSemanticDigest, HASH, "senSemanticDigest").toLowerCase();
  const a2aCorrelation = text(input.a2aCorrelation, /^.{1,512}$/u, "a2aCorrelation");
  const userOpNonce = uint(input.userOpNonce, "userOpNonce");
  const max64 = (1n << 64n) - 1n;
  const notBefore = uint(input.notBefore, "notBefore", max64);
  const expiration = uint(input.expiration, "expiration", max64);
  if (expiration <= notBefore) throw new TypeError("expiration must follow notBefore");
  const challengeNonce = text(input.challengeNonce, HASH, "challengeNonce").toLowerCase();
  const signature = text(input.signature, /^0x(?:[0-9a-fA-F]{2})+$/u, "signature").toLowerCase();
  const block = uint(input.block, "block");
  const blockHash = text(input.blockHash, HASH, "blockHash").toLowerCase();
  return { chain: input.chain, chainId, account, resource: resource.toLowerCase(), controller, actor,
    delegationCid, invocationCid, capability, capabilityNi, senSemanticDigest, a2aCorrelation,
    userOpNonce, notBefore, expiration, challengeNonce, signature, block, blockHash };
}

function bindingMessage(input) {
  return Object.freeze({
    delegationCidHash: hashText(input.delegationCid), invocationCidHash: hashText(input.invocationCid),
    controllerDidHash: hashText(input.controller), actorDidHash: hashText(input.actor),
    resourceDidHash: hashText(input.resource), capabilityHash: hashText(input.capabilityNi),
    senSemanticDigest: input.senSemanticDigest, a2aCorrelationHash: hashText(input.a2aCorrelation),
    userOpNonce: input.userOpNonce, notBefore: input.notBefore, expiration: input.expiration,
    challengeNonce: input.challengeNonce,
  });
}

/** Observe a context-bound EnterpriseAccount controller statement at finalized chain state. */
export async function observeEnterpriseAccountControllerBinding(rawInput, options = {}) {
  const input = normalizeInput(rawInput);
  if (typeof options.rpc !== "function") throw new TypeError("an injected read-only JSON-RPC observer is required");
  const rpc = options.rpc;
  const observedChain = BigInt(await rpc("eth_chainId", []));
  if (observedChain !== input.chainId) throw new TypeError("RPC chain identity differs from the binding chain");
  const finalized = await rpc("eth_getBlockByNumber", ["finalized", false]);
  const exactBlock = await rpc("eth_getBlockByNumber", [blockTag(input.block), false]);
  if (finalized == null || exactBlock == null || BigInt(finalized.number) < input.block
    || BigInt(exactBlock.number) !== input.block || exactBlock.hash?.toLowerCase() !== input.blockHash) {
    throw new TypeError("binding block is not an exact finalized block on the observed chain");
  }
  const timestamp = BigInt(exactBlock.timestamp);
  if (timestamp < input.notBefore || timestamp >= input.expiration) throw new TypeError("binding is outside its signed validity interval");
  const tag = blockTag(input.block);
  const [code, rawDomain, rawPolicySigner, rawEntryPoint] = await Promise.all([
    rpc("eth_getCode", [input.account, tag]),
    rpc("eth_call", [{ to: input.account, data: accountInterface.encodeFunctionData("eip712Domain") }, tag]),
    rpc("eth_call", [{ to: input.account, data: accountInterface.encodeFunctionData("policySigner") }, tag]),
    rpc("eth_call", [{ to: input.account, data: accountInterface.encodeFunctionData("entryPoint") }, tag]),
  ]);
  if (!/^0x(?:[0-9a-fA-F]{2})+$/u.test(code ?? "") || code === "0x") throw new TypeError("EnterpriseAccount runtime code is absent");
  const domainResult = accountInterface.decodeFunctionResult("eip712Domain", rawDomain);
  const domain = Object.freeze({ name: domainResult.name, version: domainResult.version,
    chainId: BigInt(domainResult.chainId), verifyingContract: String(domainResult.verifyingContract).toLowerCase() });
  if (domainResult.fields !== "0x0f" || domain.name !== "Union Sovereign Enterprise Account"
    || domain.version !== "3" || domain.chainId !== input.chainId || domain.verifyingContract !== input.account
    || domainResult.salt !== `0x${"0".repeat(64)}` || domainResult.extensions.length !== 0) {
    throw new TypeError("EnterpriseAccount EIP-5267 domain differs from the admitted account law");
  }
  const policySigner = lowerAddress(accountInterface.decodeFunctionResult("policySigner", rawPolicySigner)[0], "policySigner");
  const entryPoint = lowerAddress(accountInterface.decodeFunctionResult("entryPoint", rawEntryPoint)[0], "entryPoint");
  const rawNonce = await rpc("eth_call", [{ to: entryPoint,
    data: entryPointInterface.encodeFunctionData("getNonce", [input.account, 0]) }, tag]);
  const observedNonce = BigInt(entryPointInterface.decodeFunctionResult("getNonce", rawNonce)[0]);
  if (observedNonce !== input.userOpNonce) throw new TypeError("intended UserOperation nonce is not current at the binding block");
  const message = bindingMessage(input);
  const typedDigest = TypedDataEncoder.hash(domain, TYPES, message).toLowerCase();
  const rawValidity = await rpc("eth_call", [{ to: input.account,
    data: accountInterface.encodeFunctionData("isValidSignature", [typedDigest, input.signature]) }, tag]);
  const magic = String(accountInterface.decodeFunctionResult("isValidSignature", rawValidity)[0]).toLowerCase();
  if (magic !== MAGIC) throw new TypeError("EnterpriseAccount refused the controller binding signature through ERC-1271");
  const body = Object.freeze({ type: "EnterpriseAccountControllerBindingReceipt", version: 1, profile: PROFILE,
    protocol: "ERC-1271", chain: input.chain, account: input.account, resource: input.resource,
    controller: input.controller, actor: input.actor, delegationCid: input.delegationCid,
    invocationCid: input.invocationCid, capability: input.capability, capabilityNi: input.capabilityNi,
    senSemanticDigest: input.senSemanticDigest, a2aCorrelation: input.a2aCorrelation,
    userOpNonce: input.userOpNonce.toString(), notBefore: input.notBefore.toString(),
    expiration: input.expiration.toString(), challengeNonce: input.challengeNonce,
    typedData: Object.freeze({ domain: Object.freeze({ ...domain, chainId: domain.chainId.toString() }),
      primaryType: "EnterpriseAccountControllerBinding", digest: typedDigest, signature: input.signature }),
    observation: Object.freeze({ block: input.block.toString(), blockHash: input.blockHash,
      timestamp: timestamp.toString(), finalizedHead: BigInt(finalized.number).toString(),
      finalizedHeadHash: String(finalized.hash).toLowerCase(), accountCodeHash: keccak256(code),
      policySigner, entryPoint, erc1271Magic: magic }),
    admissionPolicy: "reverify-erc1271-and-userop-nonce-at-every-admission",
    disposition: "bound",
  });
  return Object.freeze({ id: identify(body), ...body });
}

export { PROFILE as ENTERPRISE_ACCOUNT_CONTROLLER_BINDING_PROFILE, TYPES as ENTERPRISE_ACCOUNT_CONTROLLER_BINDING_TYPES };

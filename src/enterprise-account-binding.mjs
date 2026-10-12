import { keccak256, toUtf8Bytes } from "ethers";

export const ENTERPRISE_ACCOUNT_BINDING_PROFILE = "org.emsenn.evm.sovereign-enterprise-account.v3";
const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/u;
const KMS_KEY_VERSION = /^projects\/[^/]+\/locations\/[^/]+\/keyRings\/[^/]+\/cryptoKeys\/[^/]+\/cryptoKeyVersions\/[^/]+$/u;
function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}
export function validateEnterpriseAccountBinding(binding, nodeId) {
  const failures = [];
  const topology = Object.keys(binding ?? {}).sort();
  const legacyTopology = ["account", "chain", "deployment", "enterprise", "factory", "policy", "profile"].sort();
  const accountedTopology = [...legacyTopology, "accounting"].sort();
  if (topology.join("\0") !== legacyTopology.join("\0") && topology.join("\0") !== accountedTopology.join("\0")) failures.push("topology");
  if (binding?.profile !== ENTERPRISE_ACCOUNT_BINDING_PROFILE) failures.push("profile");
  const expectedEnterpriseId = binding?.enterprise?.urn ? keccak256(toUtf8Bytes(binding.enterprise.urn)).toLowerCase() : "";
  if (!exactKeys(binding?.enterprise, ["enterpriseId", "nodeId", "urn"]) || binding.enterprise.nodeId !== nodeId || !binding.enterprise.urn?.startsWith("urn:") || !/^0x[0-9a-fA-F]{64}$/u.test(binding.enterprise.enterpriseId ?? "") || binding.enterprise.enterpriseId.toLowerCase() !== expectedEnterpriseId) failures.push("enterprise");
  if (!exactKeys(binding?.chain, ["caip2", "chainId"]) || !Number.isSafeInteger(binding.chain.chainId) || binding.chain.chainId < 1 || binding.chain.caip2 !== `eip155:${binding.chain.chainId}`) failures.push("CAIP-2");
  if (!exactKeys(binding?.account, ["address", "caip10"]) || !/^0x[0-9a-fA-F]{40}$/u.test(binding.account.address ?? "") || binding.account.caip10 !== `${binding.chain?.caip2}:${binding.account.address}`) failures.push("CAIP-10");
  if (!exactKeys(binding?.factory, ["address", "userSalt"]) || !/^0x[0-9a-fA-F]{40}$/u.test(binding.factory.address ?? "") || !/^0x[0-9a-fA-F]{64}$/u.test(binding.factory.userSalt ?? "")) failures.push("factory");
  const localPolicy = exactKeys(binding?.policy, ["custody", "signer"])
    && binding?.policy?.custody === "settlement-private";
  const cloudKmsPolicy = exactKeys(binding?.policy, ["custody", "keyVersion", "signer"])
    && binding?.policy?.custody === "remote-cloud-kms-hsm"
    && KMS_KEY_VERSION.test(binding?.policy?.keyVersion ?? "");
  if ((!localPolicy && !cloudKmsPolicy) || !ADDRESS.test(binding?.policy?.signer ?? "")) failures.push("policy");
  if (binding?.policy?.signer?.toLowerCase() === binding?.account?.address?.toLowerCase()) failures.push("self-policy");
  if (!exactKeys(binding?.deployment, ["block", "transaction"]) || !Number.isSafeInteger(binding.deployment.block) || binding.deployment.block < 0 || !/^0x[0-9a-fA-F]{64}$/u.test(binding.deployment.transaction ?? "")) failures.push("deployment");
  if (binding?.accounting !== undefined) {
    const accounting = binding.accounting;
    const validAuthority = exactKeys(accounting?.authority, ["enterpriseUrn", "nodeId"])
      && accounting.authority.enterpriseUrn === binding.enterprise?.urn
      && accounting.authority.nodeId === binding.enterprise?.nodeId;
    const validFunding = exactKeys(accounting?.funding, ["balanceWei", "custody", "keyVersion", "minimumWei", "source", "transactions", "treasury"])
      && ADDRESS.test(accounting.funding.treasury ?? "")
      && ((accounting.funding.source === "remote-cloud-kms-treasury"
        && accounting.funding.custody === "remote-cloud-kms-hsm"
        && KMS_KEY_VERSION.test(accounting.funding.keyVersion ?? ""))
        || (accounting.funding.source === "injected-signer-treasury"
          && accounting.funding.custody === "local-settlement-keystore"
          && accounting.funding.keyVersion === null))
      && /^\d+$/u.test(accounting.funding.minimumWei ?? "")
      && /^\d+$/u.test(accounting.funding.balanceWei ?? "")
      && Array.isArray(accounting.funding.transactions)
      && accounting.funding.transactions.every((transaction) => BYTES32.test(transaction));
    const validChain = exactKeys(accounting?.chain, ["deployment", "idempotentReconciliation"])
      && accounting.chain.deployment?.transaction === binding.deployment?.transaction
      && accounting.chain.deployment?.block === binding.deployment?.block
      && typeof accounting.chain.idempotentReconciliation === "boolean";
    if (!exactKeys(accounting, ["authority", "chain", "funding"]) || !validAuthority || !validFunding || !validChain) failures.push("accounting");
  }
  return failures;
}

export function createEnterpriseAccountBinding({
  nodeId,
  urn,
  chainId,
  account,
  factory,
  policySigner,
  policyCustody,
  policyKeyVersion,
  userSalt,
  transaction,
  block,
  accounting,
}) {
  const policy = policyCustody === "remote-cloud-kms-hsm"
    ? { signer: policySigner.toLowerCase(), custody: policyCustody, keyVersion: policyKeyVersion }
    : { signer: policySigner.toLowerCase(), custody: policyCustody };
  const binding = {
    profile: ENTERPRISE_ACCOUNT_BINDING_PROFILE,
    enterprise: { nodeId, urn, enterpriseId: keccak256(toUtf8Bytes(urn)).toLowerCase() },
    chain: { chainId, caip2: `eip155:${chainId}` },
    account: { address: account.toLowerCase(), caip10: `eip155:${chainId}:${account.toLowerCase()}` },
    factory: { address: factory.toLowerCase(), userSalt: userSalt.toLowerCase() },
    policy,
    deployment: { transaction: transaction.toLowerCase(), block },
  };
  if (accounting !== undefined) binding.accounting = accounting;
  const failures = validateEnterpriseAccountBinding(binding, nodeId);
  if (failures.length !== 0) throw new TypeError(`enterprise account binding is invalid: ${failures.join(",")}`);
  return Object.freeze(binding);
}

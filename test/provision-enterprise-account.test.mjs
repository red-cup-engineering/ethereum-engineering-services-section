import assert from "node:assert/strict";
import test from "node:test";

import { Interface, keccak256, toUtf8Bytes } from "ethers";

import { createEnterpriseAccountBinding } from "../src/enterprise-account-binding.mjs";
import { provisionEnterpriseAccount } from "../src/provision-enterprise-account.mjs";

const factory = "0x000000000000000000000000000000000000f001";
const entryPoint = "0x000000000000000000000000000000000000e001";
const account = "0x0000000000000000000000000000000000000acc";
const policySigner = "0x0000000000000000000000000000000000000b0b";
const urn = "urn:ame:modern-enterprise";
const contract = new Interface([
  "function accountAddress(bytes32 enterpriseId,address policySigner,bytes32 userSalt) view returns (address)",
  "event EnterpriseAccountDeployed(bytes32 indexed enterpriseId,address indexed account,address indexed policySigner,bytes32 userSalt)",
]);

for (const custody of ["remote-cloud-kms-hsm", "local-settlement-keystore"]) test(`reconciles an already deployed deterministic account with ${custody} without signing`, async () => {
  const enterpriseId = keccak256(toUtf8Bytes(urn));
  const userSalt = keccak256(toUtf8Bytes("deterministic-test-salt"));
  const encoded = contract.encodeFunctionResult("accountAddress", [account]);
  const event = contract.encodeEventLog(contract.getEvent("EnterpriseAccountDeployed"), [enterpriseId, account, policySigner, userSalt]);
  const provider = {
    async getNetwork() { return { chainId: 5615611n }; },
    async getCode(address) { return address.toLowerCase() === account.toLowerCase() ? "0x6000" : "0x6001"; },
    async call() { return encoded; },
    async getBalance() { return 42n; },
    async getLogs() { return [{ address: factory, topics: event.topics, data: event.data, transactionHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", blockNumber: 71 }]; },
  };
  const receipt = await provisionEnterpriseAccount({
    provider,
    deployment: { chainId: "eip155:5615611", deployments: [
      { standard: "org.ethereum.erc-4337.entry-point.v0.8", address: entryPoint },
      { standard: "org.emsenn.evm.sovereign-enterprise-account.v3", address: factory, blockNumber: 69 },
    ] },
    urn,
    policySigner,
    deployerSigner: { address: "0x0000000000000000000000000000000000000de1", custody, keyVersion: custody === "remote-cloud-kms-hsm" ? "projects/test/locations/us/keyRings/enterprise/cryptoKeys/deployer/cryptoKeyVersions/1" : null, async signDigest() { throw new Error("idempotent reconciliation must not sign"); } },
    minimumFundingWei: 42n,
    userSalt,
  });
  assert.equal(receipt.account, account.toLowerCase());
  assert.equal(receipt.idempotent, true);
  assert.deepEqual(receipt.fundingTransactions, []);
  assert.equal(receipt.deployment.block, 71);
  assert.deepEqual(receipt.authority, { enterpriseUrn: urn, enterpriseId });
  assert.deepEqual(receipt.policyCapability, { signer: policySigner });
  assert.equal(receipt.funding.source, custody === "remote-cloud-kms-hsm" ? "remote-cloud-kms-treasury" : "injected-signer-treasury");
  const binding = createEnterpriseAccountBinding({ nodeId: "local-provisioner", urn, chainId: receipt.chainId, account: receipt.account, factory, policySigner, policyCustody: "settlement-private", userSalt, transaction: receipt.deployment.transaction, block: receipt.deployment.block, accounting: { authority: { enterpriseUrn: urn, nodeId: "local-provisioner" }, funding: receipt.funding, chain: receipt.chainAccounting } });
  assert.equal(binding.accounting.funding.custody, custody);
  assert.equal(receipt.funding.transactions.length, 0);
  assert.equal(receipt.chainAccounting.idempotentReconciliation, true);
});

test("writes a binding that records remote Cloud KMS policy custody", () => {
  const binding = createEnterpriseAccountBinding({
    nodeId: "enterprise-account-provisioning-service",
    urn,
    chainId: 5615611,
    account,
    factory,
    policySigner,
    policyCustody: "remote-cloud-kms-hsm",
    policyKeyVersion: "projects/test/locations/us/keyRings/enterprise/cryptoKeys/policy/cryptoKeyVersions/1",
    userSalt: `0x${"bb".repeat(32)}`,
    transaction: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    block: 71,
    accounting: {
      authority: { enterpriseUrn: urn, nodeId: "enterprise-account-provisioning-service" },
      funding: {
        source: "remote-cloud-kms-treasury",
        treasury: "0x0000000000000000000000000000000000000de1",
        custody: "remote-cloud-kms-hsm",
        keyVersion: "projects/test/locations/us/keyRings/enterprise/cryptoKeys/deployer/cryptoKeyVersions/1",
        minimumWei: "0",
        balanceWei: "0",
        transactions: [],
      },
      chain: { deployment: { transaction: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", block: 71 }, idempotentReconciliation: true },
    },
  });
  assert.deepEqual(binding.policy, {
    signer: policySigner.toLowerCase(),
    custody: "remote-cloud-kms-hsm",
    keyVersion: "projects/test/locations/us/keyRings/enterprise/cryptoKeys/policy/cryptoKeyVersions/1",
  });
  assert.equal(binding.accounting.funding.treasury, "0x0000000000000000000000000000000000000de1");
});

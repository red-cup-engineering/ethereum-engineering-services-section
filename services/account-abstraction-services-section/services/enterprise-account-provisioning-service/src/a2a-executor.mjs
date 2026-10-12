import { Message, Role } from "@a2a-js/sdk";
import { createEnterpriseAccountBinding } from "./account-binding.mjs";
import { provisionEnterpriseAccount } from "./provision-enterprise-account.mjs";
export async function executeA2aMessage(source, options = {}) {
  const message = Message.fromJSON(source); if (message.role !== Role.ROLE_USER) throw new Error("enterprise provisioning requires an A2A user message");
  const request = JSON.parse(message.parts?.find((part) => part?.text)?.text ?? "null");
  if (!request || request.type !== "EnterpriseAccountProvisioningTask" || request.chain !== "eip155:5615611" || !/^urn:/.test(request.urn ?? "") || !/^[A-Za-z0-9._-]+$/.test(request.nodeId ?? "") || !/^0x[0-9a-fA-F]{40}$/.test(request.policySigner ?? "") || !/^projects\/[^/]+\/locations\/[^/]+\/keyRings\/[^/]+\/cryptoKeys\/[^/]+\/cryptoKeyVersions\/[^/]+$/.test(request.policyKeyVersion ?? "") || !/^\d+$/.test(String(request.minimumFundingWei)) || request.authority?.type !== "ScopedLeaderUcan") throw new Error("one canonical enterprise provisioning task is required");
  const receipt = await (options.provision ?? provisionEnterpriseAccount)({ rpcUrl: options.rpcUrl ?? process.env.RPC_URL, deployment: options.deployment, urn: request.urn, policySigner: request.policySigner, deployerSigner: options.deployerSigner, minimumFundingWei: BigInt(request.minimumFundingWei) });
  const binding = createEnterpriseAccountBinding({ nodeId: request.nodeId, urn: request.urn, chainId: receipt.chainId, account: receipt.account, factory: receipt.factory, policySigner: receipt.policySigner, policyCustody: "remote-cloud-kms-hsm", policyKeyVersion: request.policyKeyVersion, userSalt: receipt.userSalt, transaction: receipt.deployment.transaction, block: receipt.deployment.block });
  return Message.toJSON({ messageId:"", contextId:message.contextId??"", taskId:message.taskId??"", role:Role.ROLE_AGENT, parts:[{text:JSON.stringify({type:"EnterpriseAccountProvisioningResult",authority:request.authority,binding,chain:receipt.deployment})}], metadata:{provider:"urn:ame:enterprise-account-provisioning-service"}, extensions:[], referenceTaskIds:[] });
}

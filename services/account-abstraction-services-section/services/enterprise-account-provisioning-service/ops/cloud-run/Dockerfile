FROM node:24-slim

WORKDIR /app
RUN npm init -y && npm install --omit=dev ethers@6.17.0
COPY services/sign-ethereum-digest-with-cloud-kms-services-section /app/node_modules/@red-cup-engineering/sign-ethereum-digest-with-cloud-kms-services-section

WORKDIR /app/services/account-abstraction-services-section/services/enterprise-account-provisioning-service
COPY services/account-abstraction-services-section/services/enterprise-account-provisioning-service/bin ./bin
COPY services/account-abstraction-services-section/services/enterprise-account-provisioning-service/src ./src
COPY services/account-abstraction-services-section/services/enterprise-account-provisioning-service/content ./content
COPY data/deployments /app/data/deployments

# A Cloud Run Job supplies RPC_URL, URN, POLICY_SIGNER, POLICY_KEY_VERSION,
# DEPLOYER_ADDRESS, DEPLOYER_KMS_KEY_VERSION, SETTLEMENT, and WORKSPACE. The
# attached service account provides the metadata-server token used for KMS.
ENTRYPOINT ["node", "bin/provision-enterprise-account.mjs", "--receipt-only"]

const PRODUCT_PROFILE = "org.emsenn.public-service-product-declaration.v1";

function deepFreeze(value) {
  if (value != null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export const PUBLIC_EVM_WALLET_OBSERVATION_PRODUCT = deepFreeze({
  profile: PRODUCT_PROFILE,
  provider: "urn:ame:ethereum-services-section",
  skill: {
    id: "observe-public-evm-wallet",
    name: "Observe a public EVM wallet",
  },
  epistemicStatus: "deterministic-public-observation",
  reproducibility: "exact-sources-and-chain-snapshots",
  credentialAccess: false,
  inference: false,
  custody: "none",
  settlementPolicy: "deployment-supplied-never-inferred",
});

export const PUBLIC_SERVICE_PRODUCT_DECLARATION_PROFILE = PRODUCT_PROFILE;

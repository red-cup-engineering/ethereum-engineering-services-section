import { isNiUri } from "@red-cup-engineering/uri-services-section/ni-uri";

const MANIFEST_PROFILE = "org.emsenn.evm.verified-deployment-manifest.v1";
const ACTIVE_CHAIN = "eip155:5615611";
const UNKNOWN = "unknown";
const ADDRESS = /^0x[0-9a-f]{40}$/iu;
const HASH = /^0x[0-9a-f]{64}$/iu;
const CAIP2 = /^eip155:[1-9][0-9]*$/u;
const SHA256_URN = /^urn:sha256:[0-9a-f]{64}$/iu;

function requiredString(value, name) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`deployment manifest requires ${name}`);
  return value;
}

function evidenceId(value, name) {
  const id = requiredString(value, name);
  if (!SHA256_URN.test(id) && !isNiUri(id)) throw new Error(`deployment manifest has invalid ${name}`);
  return id;
}

function explicitUnknownOr(value, name, pattern) {
  const field = requiredString(value, name);
  if (field !== UNKNOWN && !pattern.test(field)) throw new Error(`deployment manifest has invalid ${name}`);
  return field;
}

function blockNumber(value, name) {
  if (value === UNKNOWN) return UNKNOWN;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`deployment manifest has invalid ${name}`);
  return value;
}

function normalizeContract(contract) {
  if (contract === null || typeof contract !== "object" || Array.isArray(contract)) {
    throw new Error("deployment manifest requires contract records");
  }
  const address = explicitUnknownOr(contract.address, `contract ${contract.standard ?? "unknown"} address`, ADDRESS);
  const runtimeBytecodeHash = explicitUnknownOr(
    contract.runtimeBytecodeHash,
    `contract ${contract.standard ?? "unknown"} runtimeBytecodeHash`,
    HASH,
  );
  return Object.freeze({
    standard: requiredString(contract.standard, "contract standard"),
    contractName: requiredString(contract.contractName, "contract name"),
    address,
    deployer: explicitUnknownOr(contract.deployer, `contract ${contract.standard} deployer`, ADDRESS),
    transactionHash: explicitUnknownOr(contract.transactionHash, `contract ${contract.standard} transactionHash`, HASH),
    blockNumber: blockNumber(contract.blockNumber, `contract ${contract.standard} blockNumber`),
    runtimeBytecodeHash,
    verification: Object.freeze({
      addressEvidence: evidenceId(contract.verification?.addressEvidence, `contract ${contract.standard} address evidence`),
      runtimeBytecodeEvidence: evidenceId(contract.verification?.runtimeBytecodeEvidence, `contract ${contract.standard} runtime bytecode evidence`),
    }),
  });
}

/**
 * Validate and normalize the one versioned receipt shape accepted by active
 * EVM projections. Unknown historical fields remain explicit; active targets
 * cannot use an unknown address or runtime bytecode hash.
 */
export function loadVerifiedDeploymentManifest(manifest, { requiredStandards = [] } = {}) {
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("deployment manifest must be an object");
  }
  if (manifest.profile !== MANIFEST_PROFILE || manifest.version !== 1) {
    throw new Error("deployment manifest has an unsupported profile or version");
  }
  if (manifest.chain?.caip2 !== ACTIVE_CHAIN || !CAIP2.test(manifest.chain.caip2)) {
    throw new Error(`deployment manifest must target ${ACTIVE_CHAIN}`);
  }
  const genesisHash = explicitUnknownOr(manifest.chain.genesisHash, "chain genesisHash", HASH);
  const receipt = evidenceId(manifest.receipt, "verified receipt");
  if (!Array.isArray(manifest.contracts) || manifest.contracts.length === 0) {
    throw new Error("deployment manifest requires contracts");
  }

  const contracts = manifest.contracts.map(normalizeContract);
  const byStandard = new Map();
  for (const contract of contracts) {
    if (byStandard.has(contract.standard)) throw new Error(`deployment manifest repeats ${contract.standard}`);
    byStandard.set(contract.standard, contract);
  }
  for (const standard of requiredStandards) {
    const contract = byStandard.get(standard);
    if (contract === undefined) throw new Error(`deployment manifest lacks ${standard}`);
    if (contract.address === UNKNOWN || contract.runtimeBytecodeHash === UNKNOWN) {
      throw new Error(`deployment manifest has undeployed or unverified ${standard}`);
    }
  }

  return Object.freeze({
    profile: MANIFEST_PROFILE,
    version: 1,
    receipt,
    chain: Object.freeze({ caip2: ACTIVE_CHAIN, genesisHash }),
    contracts: Object.freeze(contracts),
  });
}

export { ACTIVE_CHAIN, MANIFEST_PROFILE, UNKNOWN };

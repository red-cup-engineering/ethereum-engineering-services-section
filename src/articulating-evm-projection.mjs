import articulationCellArtifact from "../dist/articulating/ArticulationCell.json" with { type: "json" };
import articulatingArtifact from "../dist/articulating/Articulating.json" with { type: "json" };
import markArtifact from "../dist/articulating/Mark.json" with { type: "json" };
import utteranceArtifact from "../dist/articulating/Utterance.json" with { type: "json" };
import { semanticBytes } from "@red-cup-engineering/computer-content-address-engineering-services-section/semiotic-content-address";
import { decodeArticulatingRequest } from "@red-cup-engineering/signcell/articulating";
import { loadVerifiedDeploymentManifest } from "./versioned-deployment-manifest.mjs";
import {
  encodeAbiParameters,
  encodeDeployData,
  encodeFunctionData,
  getCreate2Address,
  keccak256,
  sha256,
  stringToHex,
  toHex,
} from "viem";

const CREATE2_DEPLOYER = "0x4e59b44847b379578588920ca78fbf26c0b4956c";
const STANDARDS = Object.freeze({
  mark: "org.emsenn.evm.semiotic-mark.v1",
  utterance: "org.emsenn.evm.semiotic-utterance.v1",
  articulating: "org.emsenn.evm.semiotic-articulating.v1",
  cell: "org.emsenn.evm.semiotic-articulation-cell.v1",
});

const artifacts = Object.freeze({
  mark: markArtifact,
  utterance: utteranceArtifact,
  articulating: articulatingArtifact,
  cell: articulationCellArtifact,
});

function artifactBytecode(artifact) {
  const bytecode = artifact?.bytecode?.object;
  if (!/^0x[0-9a-f]+$/iu.test(bytecode ?? "")) throw new Error("canonical compiler artifact has no creation bytecode");
  return bytecode;
}

function addressByStandard(manifest, standard) {
  const entry = manifest.contracts.find((candidate) => candidate.standard === standard);
  if (entry === undefined) throw new Error(`deployment manifest lacks ${standard}`);
  return entry.address;
}

function canonicalMarkSurface(value) {
  const bytes = semanticBytes(value);
  const carrier = toHex(bytes);
  return Object.freeze({ bytes, carrier, mark: sha256(carrier) });
}

function stackMember(key, constructorArguments, deployer) {
  const artifact = artifacts[key];
  const bytecode = artifactBytecode(artifact);
  const initCode = encodeDeployData({ abi: artifact.abi, bytecode, args: constructorArguments });
  const salt = keccak256(stringToHex(`${STANDARDS[key]}:${keccak256(bytecode)}`));
  return Object.freeze({
    standard: STANDARDS[key],
    contract: key === "cell" ? "ArticulationCell" : `${key[0].toUpperCase()}${key.slice(1)}`,
    salt,
    initCode,
    initCodeHash: keccak256(initCode),
    creationBytecodeHash: keccak256(bytecode),
    address: getCreate2Address({ from: deployer, salt, bytecodeHash: keccak256(initCode) }),
    constructorArguments: Object.freeze([...constructorArguments]),
  });
}

/**
 * Compile one canonical articulating request into its EVM state-transition die.
 *
 * This is a projection, not another semantic implementation. The request decoder
 * recovers the operation and values; the source-owned compiler artifacts supply the
 * ABI and bytecode. Callers must resolve the declared reads at one witnessed
 * block and retain only presently lawful writes before submitting the calls
 * through EnterpriseAccount.executeSen.
 */
export function projectArticulatingRequestToEvm(
  requestBytes,
  { deploymentManifest, create2Deployer = CREATE2_DEPLOYER } = {},
) {
  const deployment = loadVerifiedDeploymentManifest(deploymentManifest, { requiredStandards: Object.values(STANDARDS) });
  const source = Buffer.from(requestBytes);
  const decoded = decodeArticulatingRequest(source);
  const token = canonicalMarkSurface(decoded.request.input.tokenMark);
  const claim = canonicalMarkSurface(decoded.request.input.claimMark);
  const utterance = sha256(encodeAbiParameters(
    [{ type: "bytes32" }, { type: "bytes32" }],
    [token.mark, claim.mark],
  ));
  const senSemanticDigest = sha256(toHex(source));

  const addresses = Object.freeze({
    mark: addressByStandard(deployment, STANDARDS.mark),
    utterance: addressByStandard(deployment, STANDARDS.utterance),
    articulating: addressByStandard(deployment, STANDARDS.articulating),
    cell: addressByStandard(deployment, STANDARDS.cell),
  });

  const distinctMarks = token.mark === claim.mark ? [token] : [token, claim];
  const moves = [
    ...distinctMarks.map((surface, index) => Object.freeze({
      move: index === 0 ? "admit-token-mark" : "admit-claim-mark",
      target: addresses.mark,
      value: 0n,
      data: encodeFunctionData({ abi: markArtifact.abi, functionName: "admit", args: [surface.carrier] }),
      enabledWhen: Object.freeze({ target: addresses.mark, functionName: "admitted", args: [surface.mark], equals: false }),
    })),
    Object.freeze({
      move: "form-utterance",
      target: addresses.utterance,
      value: 0n,
      data: encodeFunctionData({ abi: utteranceArtifact.abi, functionName: "form", args: [token.mark, claim.mark] }),
      enabledWhen: Object.freeze({ target: addresses.utterance, functionName: "formed", args: [utterance], equals: false }),
    }),
    Object.freeze({
      move: "seat-articulation-cell",
      target: addresses.cell,
      value: 0n,
      data: encodeFunctionData({ abi: articulationCellArtifact.abi, functionName: "seat", args: [utterance] }),
      enabledWhen: Object.freeze({ target: addresses.cell, functionName: "seated", args: [utterance], equals: false }),
    }),
  ];

  const markStack = stackMember("mark", [], create2Deployer);
  const utteranceStack = stackMember("utterance", [markStack.address], create2Deployer);
  const articulatingStack = stackMember("articulating", [utteranceStack.address], create2Deployer);
  const cellStack = stackMember("cell", [utteranceStack.address], create2Deployer);

  return Object.freeze({
    type: "ArticulatingEvmProjection",
    chainId: deployment.chain.caip2,
    semanticId: decoded.semanticId,
    senSemanticDigest,
    identities: Object.freeze({ tokenMark: token.mark, claimMark: claim.mark, utterance }),
    carriers: Object.freeze({ tokenMark: token.carrier, claimMark: claim.carrier }),
    addresses,
    topologyReads: Object.freeze([
      Object.freeze({ target: addresses.utterance, functionName: "mark", args: [], equals: addresses.mark }),
      Object.freeze({ target: addresses.articulating, functionName: "utterance", args: [], equals: addresses.utterance }),
      Object.freeze({ target: addresses.cell, functionName: "utterance", args: [], equals: addresses.utterance }),
    ]),
    restrictedArena: Object.freeze(moves),
    enterpriseAccountEffect: Object.freeze({
      functionName: "executeSen",
      senSemanticDigest,
      calls: Object.freeze(moves.map(({ target, value, data }) => Object.freeze({ target, value, data }))),
    }),
    deterministicCutover: Object.freeze({
      deployer: create2Deployer,
      order: Object.freeze([markStack, utteranceStack, articulatingStack, cellStack]),
    }),
  });
}

export { CREATE2_DEPLOYER };

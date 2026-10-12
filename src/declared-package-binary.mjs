import { readFileSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const EXACT_VERSION = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$/u;

function manifest(path, label) {
  const value = JSON.parse(readFileSync(path, "utf8"));
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} package manifest must be an object`);
  }
  return value;
}

export function resolveDeclaredPackageBinary({ ownerRoot, packageName, binaryName }) {
  const owner = realpathSync(resolve(ownerRoot));
  const ownerManifestPath = join(owner, "package.json");
  const ownerManifest = manifest(ownerManifestPath, "owner");
  const declaredVersion = ownerManifest.dependencies?.[packageName];
  if (typeof declaredVersion !== "string" || !EXACT_VERSION.test(declaredVersion)) {
    throw new TypeError(`${packageName} must be an exact declared runtime dependency`);
  }

  const requireFromOwner = createRequire(ownerManifestPath);
  const dependencyManifestPath = realpathSync(requireFromOwner.resolve(`${packageName}/package.json`));
  const dependencyRoot = dirname(dependencyManifestPath);
  const dependencyManifest = manifest(dependencyManifestPath, packageName);
  if (dependencyManifest.name !== packageName || dependencyManifest.version !== declaredVersion) {
    throw new TypeError(`${packageName} resolved identity differs from its exact declaration`);
  }
  const bin = typeof dependencyManifest.bin === "string"
    ? dependencyManifest.bin
    : dependencyManifest.bin?.[binaryName];
  if (typeof bin !== "string" || bin.length === 0 || isAbsolute(bin)) {
    throw new TypeError(`${packageName} does not declare the ${binaryName} package binary`);
  }
  const binaryPath = realpathSync(resolve(dependencyRoot, bin));
  const fromDependency = relative(dependencyRoot, binaryPath);
  if (fromDependency === ".." || fromDependency.startsWith(`..${sep}`) || statSync(binaryPath).isFile() !== true) {
    throw new TypeError(`${packageName} ${binaryName} binary escapes its resolved package`);
  }
  return Object.freeze({ packageName, version: declaredVersion, binaryName, path: binaryPath });
}

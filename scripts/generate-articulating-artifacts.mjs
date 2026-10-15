import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import solc from "solc";
import { planArticulatingCompilation } from "../src/plan-articulating-compilation.mjs";

/** Compile the authored contract set through Code's authenticated input/output contract. */
export async function generateArticulatingArtifacts({ sourceRoot, ownerRoot, read }) {
  if (typeof sourceRoot !== "string" || !sourceRoot || (ownerRoot !== undefined && (typeof ownerRoot !== "string" || !ownerRoot))) {
    throw new TypeError("the source and supplied producing-owner roots must be explicit paths");
  }
  const owner = ownerRoot === undefined ? resolve(dirname(fileURLToPath(import.meta.url)), "..") : resolve(ownerRoot);
  const relativeOwner = relative(sourceRoot, owner).split(sep).join("/");
  if (relativeOwner === ".." || relativeOwner.startsWith("../")) {
    throw new TypeError("the contract producer must belong to the selected source");
  }
  const prefix = relativeOwner === "." ? "" : relativeOwner;
  const sourcePath = (path) => prefix ? `${prefix}/${path}` : path;

  const declarationPath = sourcePath("data/records/articulating-compilation.json");
  const declaration = JSON.parse(await read(declarationPath));
  const manifest = JSON.parse(await read(sourcePath("package.json")));
  const plan = planArticulatingCompilation(declaration, manifest);
  if (!solc.version().startsWith("0.8.28+")) {
    throw new TypeError("the authored compiler declaration does not match the installed compiler");
  }
  const sources = Object.create(null), outputSelection = Object.create(null);
  for (const path of plan.sourcePaths) sources[path] = { content: await read(sourcePath(path)) };
  for (const contract of plan.contracts) {
    outputSelection[contract.source] = {
      ...(outputSelection[contract.source] ?? {}),
      [contract.name]: ["abi", "evm.bytecode", "metadata"],
    };
  }

  const input = {
    language: "Solidity",
    sources,
    settings: { ...plan.settings, outputSelection },
  };
  const inputText = JSON.stringify(input);
  const compilation = JSON.parse(solc.compile(inputText));
  const errors = (compilation.errors ?? []).filter(({ severity }) => severity === "error");
  if (errors.length) throw new Error(`Solidity compilation failed: ${errors.map(({ formattedMessage }) => formattedMessage).join("\n")}`);

  const inputSha256 = createHash("sha256").update(inputText).digest("hex");
  return {
    files: plan.contracts.map((contract) => {
      const result = compilation.contracts?.[contract.source]?.[contract.name];
      const bytecode = result?.evm?.bytecode;
      if (!Array.isArray(result?.abi) || typeof bytecode?.object !== "string" || !/^[0-9a-f]+$/iu.test(bytecode.object)) {
        throw new TypeError(`the compiler did not emit the complete declared product for ${contract.name}`);
      }
      const artifact = {
        abi: result.abi,
        bytecode: { ...bytecode, object: `0x${bytecode.object}` },
        metadata: result.metadata,
        compiler: solc.version(),
        inputSha256,
      };
      return { path: contract.output, text: `${JSON.stringify(artifact, null, 2)}\n` };
    }),
  };
}

// Ordinary package build entrance; compilation writes only its declared products.
if (import.meta.main) {
  const { values } = parseArgs({ options: { "source-root": { type: "string" } } });
  if (!values["source-root"]) throw new TypeError("--source-root is required");
  const sourceRoot = resolve(values["source-root"]);
  const owner = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const { files } = await generateArticulatingArtifacts({
    sourceRoot, read: file => readFile(resolve(sourceRoot, file), "utf8"),
  });
  for (const file of files) {
    const output = resolve(owner, file.path);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, file.text);
  }
  process.stdout.write(JSON.stringify({ built: files.map(file => file.path) }) + "\n");
}

import { createHash } from "node:crypto";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import solc from "solc";

/** Compile the authored contract set through Code's authenticated input/output contract. */
export async function generateArticulatingArtifacts({ sourceRoot, read }) {
  const owner = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const relativeOwner = relative(sourceRoot, owner).split(sep).join("/");
  if (relativeOwner === ".." || relativeOwner.startsWith("../")) {
    throw new TypeError("the contract producer must belong to the selected source");
  }
  const prefix = relativeOwner === "." ? "" : relativeOwner;
  const sourcePath = (path) => prefix ? `${prefix}/${path}` : path;

  const declarationPath = sourcePath("data/records/articulating-compilation.json");
  const declaration = JSON.parse(await read(declarationPath));
  if (declaration.type !== "ArticulatingSolidityCompilation"
      || declaration.version !== 1
      || declaration.compiler !== "solc@0.8.28"
      || !solc.version().startsWith("0.8.28+")) {
    throw new TypeError("the authored articulating compiler declaration does not match the installed compiler");
  }
  if (!Array.isArray(declaration.contracts) || declaration.contracts.length !== 4) {
    throw new TypeError("the authored articulating contract set must declare four products");
  }

  const sources = {};
  const outputSelection = {};
  for (const contract of declaration.contracts) {
    if (typeof contract.source !== "string" || typeof contract.name !== "string"
        || typeof contract.output !== "string" || contract.output.startsWith("/")) {
      throw new TypeError("the authored articulating contract declaration is malformed");
    }
    if (!(contract.source in sources)) {
      sources[contract.source] = { content: await read(sourcePath(contract.source)) };
    }
    outputSelection[contract.source] = {
      ...(outputSelection[contract.source] ?? {}),
      [contract.name]: ["abi", "evm.bytecode", "metadata"],
    };
  }

  const input = {
    language: "Solidity",
    sources,
    settings: { ...declaration.settings, outputSelection },
  };
  const inputText = JSON.stringify(input);
  const compilation = JSON.parse(solc.compile(inputText));
  const errors = (compilation.errors ?? []).filter(({ severity }) => severity === "error");
  if (errors.length) throw new Error(`Solidity compilation failed: ${errors.map(({ formattedMessage }) => formattedMessage).join("\n")}`);

  const inputSha256 = createHash("sha256").update(inputText).digest("hex");
  return {
    files: declaration.contracts.map((contract) => {
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

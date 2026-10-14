import { relative, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileSolidity } from '@red-cup-engineering/solidity-services-section/compile';

/** The native Code writer authenticates each input and owns every product write. */
export async function generateArticulatingArtifacts({sourceRoot, read}) {
  const owner = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const prefix = relative(sourceRoot, owner).split(sep).join('/');
  if (!prefix || prefix.startsWith('../')) throw new TypeError('the contract producer must belong to the selected source');
  const config = JSON.parse(await read(prefix + '/data/records/articulating-compilation.json'));
  if (config.type !== 'ArticulatingSolidityCompilation' || config.version !== 1 || config.compiler !== 'solc@0.8.28')
    throw new TypeError('the authored articulating compiler declaration is invalid');
  const sources = {}, outputSelection = {};
  for (const contract of config.contracts) {
    sources[contract.source] = {content: await read(prefix + '/' + contract.source)};
    outputSelection[contract.source] = {[contract.name]: ['abi', 'evm.bytecode', 'metadata']};
  }
  const compilation = compileSolidity({language:'Solidity', sources, settings:{...config.settings, outputSelection}});
  return {files: config.contracts.map(contract => {
    const result = compilation.output.contracts?.[contract.source]?.[contract.name];
    if (!Array.isArray(result?.abi) || !/^[0-9a-f]+$/iu.test(result?.evm?.bytecode?.object ?? ''))
      throw new TypeError('the compiler did not emit the complete declared contract product');
    const artifact = {abi:result.abi, bytecode:{...result.evm.bytecode,object:'0x'+result.evm.bytecode.object},
      metadata:result.metadata, compiler:compilation.compiler, inputSha256:compilation.inputSha256};
    return {path:contract.output, text:JSON.stringify(artifact,null,2)+'\n'};
  })};
}

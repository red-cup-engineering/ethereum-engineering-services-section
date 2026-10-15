const ownerPath = value => typeof value === 'string' && value.length > 0
  && !/[\\\0]/u.test(value) && value.split('/').every(part=>part && part!=='.' && part!=='..');
const identifier = value => typeof value === 'string' && /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(value);

/** Admit the existing four-contract source declaration before compiler work.
 * The owning manifest supplies the accepted output set and compiler dependency;
 * this pure operation returns the complete input/source/output relation. */
export function planArticulatingCompilation(declaration, manifest) {
  if(declaration?.type!=='ArticulatingSolidityCompilation'||declaration.version!==1
    ||declaration.compiler!=='solc@0.8.28'||manifest?.devDependencies?.solc!=='0.8.28')
    throw new TypeError('the authored compiler declaration and owning dependency must agree');
  const generation=manifest.nodeRuntimeGeneration;
  if(generation?.module!=='scripts/generate-articulating-artifacts.mjs'||generation.export!=='generateArticulatingArtifacts'
    ||!Array.isArray(generation.outputs)||generation.outputs.length!==4||generation.outputs.some(path=>!ownerPath(path)||!path.endsWith('.json'))
    ||new Set(generation.outputs).size!==4)
    throw new TypeError('the owner must declare four distinct articulating JSON products');
  if(!declaration.settings||typeof declaration.settings!=='object'||Array.isArray(declaration.settings)
    ||!Array.isArray(declaration.contracts)||declaration.contracts.length!==4)
    throw new TypeError('the compilation needs its authored settings and four contract selections');
  const outputs=new Set(),selections=new Set(),sources=new Set(),contracts=[];
  for(const contract of declaration.contracts){
    if(!contract||!ownerPath(contract.source)||!contract.source.endsWith('.sol')||!identifier(contract.name)
      ||!ownerPath(contract.output)||!generation.outputs.includes(contract.output))
      throw new TypeError('contract selections must bind an owned Solidity source and declared JSON product');
    const selection=contract.source+'\0'+contract.name;
    if(outputs.has(contract.output)||selections.has(selection))throw new TypeError('contract selections and products must be unique');
    outputs.add(contract.output);selections.add(selection);sources.add(contract.source);
    contracts.push({source:contract.source,name:contract.name,output:contract.output});
  }
  if(generation.outputs.some(path=>!outputs.has(path)))throw new TypeError('the contract set must cover every declared product');
  return {compiler:declaration.compiler,settings:declaration.settings,contracts,
    sourcePaths:[...sources],inputPaths:['package.json','data/records/articulating-compilation.json',...sources],
    outputPaths:contracts.map(contract=>contract.output)};
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {planArticulatingCompilation} from '../src/plan-articulating-compilation.mjs';
const manifest=JSON.parse(readFileSync(new URL('../package.json',import.meta.url)));
const declaration=JSON.parse(readFileSync(new URL('../data/records/articulating-compilation.json',import.meta.url)));
const clone=value=>JSON.parse(JSON.stringify(value));

test('authored four-contract graph covers exactly its actual published product declaration',()=>{
 const before=JSON.stringify({declaration,manifest}),plan=planArticulatingCompilation(declaration,manifest);
 assert.deepEqual(plan.contracts.map(row=>row.name),['ArticulationCell','Articulating','Mark','Utterance']);
 assert.deepEqual(plan.sourcePaths,['src/ArticulationCell.sol','src/Articulating.sol','src/ArticulatingMark.sol','src/ArticulatingUtterance.sol']);
 assert.deepEqual([...plan.outputPaths].sort(),[...manifest.nodeRuntimeGeneration.outputs].sort());
 assert.deepEqual(plan.inputPaths,['package.json','data/records/articulating-compilation.json',...plan.sourcePaths]);
 assert.equal(JSON.stringify({declaration,manifest}),before);
});
test('duplicate contract selection or output refuses before construction',()=>{
 const duplicate=clone(declaration);duplicate.contracts[1].output=duplicate.contracts[0].output;
 assert.throws(()=>planArticulatingCompilation(duplicate,manifest),/unique/);
 const selection=clone(declaration);Object.assign(selection.contracts[1],{source:selection.contracts[0].source,name:selection.contracts[0].name});
 assert.throws(()=>planArticulatingCompilation(selection,manifest),/unique/);
});
test('missing product, foreign product and escaping source identities refuse',()=>{
 const missing=clone(declaration);missing.contracts.pop();assert.throws(()=>planArticulatingCompilation(missing,manifest),/four/);
 for(const path of ['../outside.sol','/absolute.sol','src/../outside.sol','src\\outside.sol']){
  const changed=clone(declaration);changed.contracts[0].source=path;assert.throws(()=>planArticulatingCompilation(changed,manifest),/owned Solidity source/);
 }
 const foreign=clone(declaration);foreign.contracts[0].output='dist/other.json';assert.throws(()=>planArticulatingCompilation(foreign,manifest),/declared JSON product/);
});
test('compiler selection and manifest producer remain the authored contract',()=>{
 const changed=clone(manifest);changed.devDependencies.solc='latest';assert.throws(()=>planArticulatingCompilation(declaration,changed),/compiler declaration/);
 const wrong=clone(declaration);wrong.compiler='solc@0.8.29';assert.throws(()=>planArticulatingCompilation(wrong,manifest),/compiler declaration/);
 const producer=clone(manifest);producer.nodeRuntimeGeneration.export='anotherProducer';assert.throws(()=>planArticulatingCompilation(declaration,producer),/owner must declare/);
 const outputs=clone(manifest);outputs.nodeRuntimeGeneration.outputs[0]=outputs.nodeRuntimeGeneration.outputs[1];assert.throws(()=>planArticulatingCompilation(declaration,outputs),/distinct/);
});
test('one authored Solidity source can supply distinct selected contracts',()=>{
 const shared=clone(declaration);shared.contracts[1].source=shared.contracts[0].source;
 const plan=planArticulatingCompilation(shared,manifest);
 assert.equal(plan.sourcePaths.length,3);assert.equal(plan.outputPaths.length,4);
});

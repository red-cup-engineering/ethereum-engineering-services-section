import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {generateArticulatingArtifacts} from '../scripts/generate-articulating-artifacts.mjs';

const ownerRoot=fileURLToPath(new URL('..',import.meta.url));
const read=path=>readFile(resolve(ownerRoot,path),'utf8');
const inputs={sourceRoot:ownerRoot,ownerRoot,read};

test('the exact authored contracts produce all four declared ABI/bytecode artifacts deterministically',async()=>{
  const manifest=JSON.parse(await read('package.json'));
  const first=await generateArticulatingArtifacts(inputs);
  const second=await generateArticulatingArtifacts(inputs);
  assert.deepEqual(first,second);
  assert.deepEqual(first.files.map(file=>file.path),manifest.nodeRuntimeGeneration.outputs);
  const digests=new Set();
  for(const file of first.files){
    const artifact=JSON.parse(file.text);
    assert.match(artifact.compiler,/^0\.8\.28\+/u);
    assert.ok(Array.isArray(artifact.abi)&&artifact.abi.length>0);
    assert.match(artifact.bytecode.object,/^0x[0-9a-f]+$/iu);
    assert.match(artifact.inputSha256,/^[0-9a-f]{64}$/u);
    assert.equal(JSON.parse(artifact.metadata).language,'Solidity');
    digests.add(artifact.inputSha256);
  }
  assert.equal(digests.size,1);
});

test('invalid authored Solidity refuses the entire product set',async()=>{
  await assert.rejects(generateArticulatingArtifacts({...inputs,
    read:path=>path==='src/ArticulatingMark.sol'
      ?Promise.resolve('pragma solidity 0.8.28; invalid;'):read(path),
  }),/Solidity compilation failed/u);
});

test('a producing owner outside the selected source is refused before input reads',async()=>{
  let reads=0;
  await assert.rejects(generateArticulatingArtifacts({...inputs,
    ownerRoot:resolve(ownerRoot,'..'),read:async()=>{reads++;throw Error('unexpected read');},
  }),/must belong to the selected source/u);
  assert.equal(reads,0);
});

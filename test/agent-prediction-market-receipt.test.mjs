import test from 'node:test';
import assert from 'node:assert/strict';
import {createIndependentAgentPredictionReceipt, MARKET_RECEIPT_ABI, ASSET_RECEIPT_ABI}
  from '../src/agent-prediction-market-receipt.mjs';
const A=c=>'0x'+c.repeat(40),N=c=>'0x'+c.repeat(64),S=c=>'0x'+c.repeat(130);
const market=A('c'),asset=A('e'),buyer=A('b'),network='eip155:84532',txhash=N('6');
const marketCode='0x60016000',assetCode='0x60026000';
const expected={requirement:{network,payTo:market,asset,amount:'1111000',
  extra:{marketId:'12',askId:'42',lots:'2',outcome:0,maker:A('2'),provider:A('1'),
    protocolRecipient:A('3'),makerAmount:'1100000',providerFee:'4400',protocolFee:'6600'}},
  packet:{payload:{buyIntent:{buyer,askId:'42',lots:'2',maxTotal:'1111000',
    deadline:'1792000010',nonce:N('4'),paymentNonce:N('5')},buySignature:S('a'),
    authorization:{from:buyer,to:market,value:'1111000',validAfter:'1791999950',
      validBefore:'1792000040',nonce:N('5'),signature:S('b')}}}};
function txPayload(){const {buyIntent:i,authorization:a,buySignature}=expected.packet.payload;
  return {name:'takeAskAuthorized',args:[i,buySignature,a]};}
const log=(source,name,args)=>({source,name,args});
function filledEvents(){return [
  log('asset','AuthorizationUsed',{authorizer:buyer,nonce:N('5')}),
  log('asset','AuthorizationTransferExecuted',{authorizer:buyer,recipient:market,
    submitter:market,nonce:N('5'),value:1111000n}),
  log('asset','Transfer',{from:buyer,to:market,value:1111000n}),
  log('asset','Transfer',{from:market,to:A('2'),value:1100000n}),
  log('asset','Transfer',{from:market,to:A('1'),value:4400n}),
  log('asset','Transfer',{from:market,to:A('3'),value:6600n}),
  log('market','AskFilled',{askId:42n,buyer,provider:A('1'),lots:2n,
    makerAmount:1100000n,providerFee:4400n,protocolFee:6600n,buyerIntentNonce:N('4')}),
  log('market','TransferSingle',{from:market,to:buyer,id:36n,value:2n}),
];}
function fixture(overrides={}){
  const events=overrides.logs??filledEvents();
  const rawLogs=events.map((event,index)=>({
    address:event.source==='market'?market:asset,index,
    blockHash:N('8'),transactionHash:txhash,
  }));
  const provider={
    getNetwork:async()=>({chainId:84532n}),
    getTransactionReceipt:async()=>({hash:txhash,status:1,blockHash:N('8'),blockNumber:125,logs:rawLogs}),
    getTransaction:async()=>({hash:txhash,to:market,blockNumber:125,value:0n,data:'0x123456'}),
    getBlock:async b=>({number:b==='finalized'?126:125,hash:b==='finalized'?N('7'):N('8')}),
    getCode:async a=>a===market?marketCode:assetCode,
    ...overrides.provider,
  };
  const caller=createIndependentAgentPredictionReceipt({
    provider,network,marketAddress:market,assetAddress:asset,
    marketCodeHash:N('8'),assetCodeHash:N('9'),
    hashCode:code=>code===marketCode?N('8'):N('9'),
    decodeTransaction:()=>overrides.tx??txPayload(),
    decodeLogs:overrides.decodeLogs??(()=>events.map((event,index)=>({...event,index}))),
    readState:async()=>overrides.state??{
      tokenNonce:true,intentNonce:true,shares:2n,collateralBalance:24000000n,
      backingLots:24n,collateralPerLot:1000000n,
    },
  });
  return {caller,provider,events};
}
const read=caller=>caller({transactionHash:txhash,expected});

test('EVM receipt reader has the real contract-event and global-backing interfaces',()=>{
  assert.ok(MARKET_RECEIPT_ABI.some(v=>v.includes('AskFilled')));
  assert.ok(MARKET_RECEIPT_ABI.some(v=>v.includes('totalOutstandingBackingLots')));
  assert.ok(ASSET_RECEIPT_ABI.some(v=>v.includes('AuthorizationTransferExecuted')));
});
test('finalized position, nonce and four exact transfers are consumed as one market effect',async()=>{
  const {caller}=fixture();const r=await read(caller);
  assert.equal(r.finalized,true);assert.equal(r.transactionStatus,1);
  assert.equal(r.buyer,buyer);assert.equal(r.amount,'1111000');
  assert.equal(r.sharesReceived,true);assert.equal(r.backingConserved,true);
  assert.equal(r.providerFee,'4400');assert.equal(r.protocolFee,'6600');
  assert.deepEqual(r.sourceEconomicEvent,{
    type:'EvmAgentPredictionAskFilled',chain:network,blockNumber:125,
    blockHash:N('8'),transactionHash:txhash,logIndex:6,emitter:market,event:'AskFilled',
  });
});
test('unfinalized or absent transactions stay pending rather than inventing shares',async()=>{
  for(const provider of [
    {getTransactionReceipt:async()=>null},
    {getBlock:async b=>({number:b==='finalized'?124:125,hash:N('8')})},
  ]) assert.equal(await read(fixture({provider}).caller),null);
});
test('a forged market call, changed chain, or block reorganization never receives position',async()=>{
  for(const overrides of [
    {provider:{getNetwork:async()=>({chainId:1n})}},
    {provider:{getTransaction:async()=>({hash:txhash,to:A('9'),blockNumber:125,value:0n})}},
    {provider:{getBlock:async()=>({number:126,hash:N('9')})}},
    {tx:{name:'takeAsk',args:[]}},
    {tx:{...txPayload(),args:[{...expected.packet.payload.buyIntent,askId:'43'},
      expected.packet.payload.buySignature,expected.packet.payload.authorization]}},
  ]) await assert.rejects(read(fixture(overrides).caller),/independent market receipt/u);
});
test('missing buyer payment, fee conservation, authorizations or minted shares refuse',async()=>{
  for(const remove of [
    x=>x.name==='AuthorizationUsed',x=>x.name==='AskFilled',
    x=>x.name==='TransferSingle',x=>x.name==='Transfer'&&x.args.to===A('3'),
  ]){
    const events=filledEvents().filter(x=>!remove(x));
    await assert.rejects(read(fixture({logs:events}).caller),/independent market receipt/u);
  }
  const bad=filledEvents().map(x=>x.name==='Transfer'&&x.args.to===A('1')?
    {...x,args:{...x.args,value:4401n}}:x);
  await assert.rejects(read(fixture({logs:bad}).caller),/independent market receipt/u);
});
test('no global collateral backing or no consumed nonce refuses settlement',async()=>{
  for(const state of [
    {tokenNonce:false,intentNonce:true,shares:2n,collateralBalance:24000000n,backingLots:24n,collateralPerLot:1000000n},
    {tokenNonce:true,intentNonce:false,shares:2n,collateralBalance:24000000n,backingLots:24n,collateralPerLot:1000000n},
    {tokenNonce:true,intentNonce:true,shares:1n,collateralBalance:24000000n,backingLots:24n,collateralPerLot:1000000n},
    {tokenNonce:true,intentNonce:true,shares:2n,collateralBalance:23000000n,backingLots:24n,collateralPerLot:1000000n},
  ]) await assert.rejects(read(fixture({state}).caller),/independent market receipt/u);
});

test('decoded economic event preserves original emitted EVM log index even with unrelated earlier logs',async()=>{
  const e=filledEvents();
  const raw=[{address:A('1'),index:9,blockHash:N('8'),transactionHash:txhash},
    ...e.map((event,i)=>({address:event.source==='market'?market:asset,
      index:10+i,blockHash:N('8'),transactionHash:txhash}))];
  const f=fixture({provider:{getTransactionReceipt:async()=>({hash:txhash,status:1,
    blockHash:N('8'),blockNumber:125,logs:raw})},
    decodeLogs:()=>e.map((event,i)=>({...event,index:10+i}))});
  const result=await read(f.caller);
  assert.equal(result.sourceEconomicEvent.logIndex,16,
    'event identity comes from the chain receipt, not position in decoded array');
});

test('changed or duplicated raw log origins never authenticate an economic event',async()=>{
  const baseline=filledEvents();
  const exactLogs=baseline.map((event,index)=>({address:event.source==='market'?market:asset,
    index,blockHash:N('8'),transactionHash:txhash}));
  const variants=[
    exactLogs.map((log,i)=>i===6?{...log,address:asset}:log),
    exactLogs.map((log,i)=>i===6?{...log,index:5}:log),
    exactLogs.map((log,i)=>i===6?{...log,transactionHash:N('3')}:log),
    exactLogs.map((log,i)=>i===6?{...log,blockHash:N('4')}:log),
  ];
  for(const logs of variants){
    const f=fixture({provider:{getTransactionReceipt:async()=>({hash:txhash,status:1,
      blockHash:N('8'),blockNumber:125,logs})}});
    await assert.rejects(read(f.caller),/independent market receipt/u);
  }
});

/** EVM source-owner's read-only market receiving adapter. It returns one
 * economic observation to the already owning market service; there is no new
 * ledger, token, signer, custody, oracle or ActivityPub publisher here.
 * A caller must bind a provider independent of the market facilitator.
 */
export const MARKET_RECEIPT_ABI=Object.freeze([
  'function takeAskAuthorized((address buyer,uint256 askId,uint256 lots,uint256 maxTotal,uint256 deadline,bytes32 nonce,bytes32 paymentNonce) intent,bytes buySignature,(uint256 validAfter,uint256 validBefore,bytes32 nonce,bytes signature) payment)',
  'event AskFilled(uint256 indexed askId,address indexed buyer,address indexed provider,uint256 lots,uint256 makerAmount,uint256 providerFee,uint256 protocolFee,bytes32 buyerIntentNonce)',
  'event TransferSingle(address indexed operator,address indexed from,address indexed to,uint256 id,uint256 value)',
  'function totalOutstandingBackingLots() view returns(uint256)',
  'function collateralPerLot() view returns(uint256)',
  'function usedBuyIntents(address,bytes32) view returns(bool)',
  'function balanceOf(address,uint256) view returns(uint256)',
]);
export const ASSET_RECEIPT_ABI=Object.freeze([
  'event AuthorizationUsed(address indexed authorizer,bytes32 indexed nonce)',
  'event AuthorizationTransferExecuted(bytes32 indexed authorizationDigest,address indexed authorizer,address indexed recipient,bytes32 nonce,uint256 value,uint256 validAfter,uint256 validBefore,address submitter,bytes32 signatureHash)',
  'event Transfer(address indexed from,address indexed to,uint256 value)',
  'function authorizationState(address,bytes32) view returns(bool)',
  'function balanceOf(address) view returns(uint256)',
]);
const ADDR=/^0x[0-9a-fA-F]{40}$/u,HASH=/^0x[0-9a-fA-F]{64}$/u;
const lower=x=>typeof x==='string'?x.toLowerCase():'';
const n=x=>BigInt(x);
const assert=(ok,message)=>{if(!ok)throw new Error('independent market receipt: '+message);};
const equal=(a,b)=>lower(a)===lower(b);
const count=(events,predicate)=>events.filter(predicate).length;
const matches=(e,source,name)=>e.source===source&&e.name===name;
const canonical=address=>{assert(ADDR.test(address??''),'invalid contract address');return address.toLowerCase();};
// Keep the original EVM log's globally unique position; unlike an array index,
// this survives decoding, sorting and another contract's intervening event.
const logPosition=log=>{
  const index=log?.index??log?.logIndex;
  assert(Number.isSafeInteger(index)&&index>=0,'original EVM log requires a safe nonnegative index');
  return index;
};

/** readFinalizedAgentPredictionFill({transactionHash,expected}) supplies the
 * exact output of the custom x402 settleAgentOrder independentReceipt hook.
 * A success requires original chain tx, canonical finality, contract code,
 * token and share logs, both nonces, and post-transaction backing solvency.
 */
export function createIndependentAgentPredictionReceipt({
  provider, network,marketAddress,assetAddress,marketCodeHash,assetCodeHash,
  decodeTransaction,decodeLogs,readState,hashCode,
}={}) {
  const market=canonical(marketAddress),asset=canonical(assetAddress);
  assert(HASH.test(marketCodeHash??'')&&HASH.test(assetCodeHash??''),'pin two runtime code hashes');
  assert(/^eip155:[1-9][0-9]*$/u.test(network??''),'pin EVM network');
  assert(provider&&['getNetwork','getTransaction','getTransactionReceipt','getBlock','getCode']
    .every(fn=>typeof provider[fn]==='function'),'independent EVM read interface required');

  return async function readFinalizedAgentPredictionFill({transactionHash,expected}={}) {
    assert(HASH.test(transactionHash??''),'transaction hash required');
    const {packet,requirement}=expected??{};
    const intent=packet?.payload?.buyIntent,authorization=packet?.payload?.authorization;
    assert(intent&&authorization&&requirement?.extra,'exactly one signed buyer order required');
    const e=requirement.extra;
    assert(requirement.network===network&&equal(requirement.payTo,market)&&equal(requirement.asset,asset),
      'source chain, market or collateral differ from accepted terms');
    assert(lower(intent.paymentNonce)===lower(authorization.nonce),'buyer intent and funding nonces differ');
    const namedChain='eip155:'+String(BigInt((await provider.getNetwork()).chainId));
    assert(namedChain===network,'independent EVM source is on the wrong chain');
    const [receipt,transaction]=await Promise.all([
      provider.getTransactionReceipt(transactionHash),provider.getTransaction(transactionHash),
    ]);
    if(!receipt||!transaction)return null;
    assert(receipt.status===1 && equal(receipt.hash??receipt.transactionHash,transactionHash) &&
      HASH.test(receipt.blockHash??'') && Number.isSafeInteger(receipt.blockNumber),
      'transaction was not successfully recorded');
    assert(equal(transaction.to,market)&&equal(transaction.hash,transactionHash)&&
      n(transaction.value)===0n && transaction.blockNumber===receipt.blockNumber,
      'executed operation is not the authorized market transaction');
    const [finalized,canonicalBlock]=await Promise.all([
      provider.getBlock('finalized'),provider.getBlock(receipt.blockNumber),
    ]);
    if(!finalized||finalized.number<receipt.blockNumber)return null;
    assert(equal(canonicalBlock?.hash,receipt.blockHash),'settlement block was reorganized');
    const [marketCode,assetCode]=await Promise.all([
      provider.getCode(market,receipt.blockNumber),provider.getCode(asset,receipt.blockNumber),
    ]);
    const libs=await ((decodeTransaction&&decodeLogs&&readState&&hashCode)?Promise.resolve(null):import('ethers'));
    const digest=hashCode??libs.keccak256;
    assert(equal(digest(marketCode),marketCodeHash)&&equal(digest(assetCode),assetCodeHash),
      'a deployed runtime differs from admitted source');
    const transactionDecoder=decodeTransaction??(raw=>{
      const I=new libs.Interface(MARKET_RECEIPT_ABI);
      return I.parseTransaction({data:raw.data,value:raw.value});
    });
    const decoded=await transactionDecoder(transaction);
    assert(decoded?.name==='takeAskAuthorized','transaction executed a different entrypoint');
    const [executed,signature,payment]=decoded.args;
    assert(equal(executed.buyer,intent.buyer)&&n(executed.askId)===n(intent.askId)&&
      n(executed.lots)===n(intent.lots)&&n(executed.maxTotal)===n(intent.maxTotal)&&
      n(executed.deadline)===n(intent.deadline)&&equal(executed.nonce,intent.nonce)&&
      equal(executed.paymentNonce,intent.paymentNonce)&&
      lower(signature)===lower(packet.payload.buySignature)&&
      n(payment.validAfter)===n(authorization.validAfter)&&
      n(payment.validBefore)===n(authorization.validBefore)&&
      equal(payment.nonce,authorization.nonce)&&
      lower(payment.signature)===lower(authorization.signature),
      'recorded execution does not have both original signatures and exact order');
    const logDecoder=decodeLogs??(logs=>{
      const marketI=new libs.Interface(MARKET_RECEIPT_ABI);
      const assetI=new libs.Interface(ASSET_RECEIPT_ABI);
      return logs.flatMap(log=>{
        const source=equal(log.address,market)?'market':equal(log.address,asset)?'asset':null;
        if(!source)return[];
        try{
          const event=(source==='market'?marketI:assetI).parseLog(log);
          return event?[{source,name:event.name,args:event.args,index:logPosition(log)}]:[];
        }catch{return[];}
      });
    });
    // Parsed events are only evidence when each retains its source log's
    // original index and contract emitter in the finalized transaction.
    assert(Array.isArray(receipt.logs),'finalized transaction must retain its original log array');
    const originalLogs=new Map();
    for(const log of receipt.logs){
      const index=logPosition(log);
      assert(!originalLogs.has(index),'original receipt duplicates an EVM log index');
      if(log.transactionHash!==undefined)assert(equal(log.transactionHash,transactionHash),
        'receipt log belongs to another transaction');
      if(log.blockHash!==undefined)assert(equal(log.blockHash,receipt.blockHash),
        'receipt log belongs to another block');
      originalLogs.set(index,log);
    }
    const events=await logDecoder(receipt.logs,market,asset);
    assert(Array.isArray(events)&&events.every(x=>x&&['market','asset'].includes(x.source)),
      'decoder must bind original log emitters');
    const seenDecoded=new Set();
    for(const event of events){
      const index=logPosition(event),origin=originalLogs.get(index);
      assert(origin&&equal(origin.address,event.source==='market'?market:asset),
        'decoded event has no matching original emitting contract and log index');
      assert(!seenDecoded.has(index),'one original EVM log cannot be decoded twice');
      seenDecoded.add(index);
    }
    const has=(source,name,predicate)=>count(events,x=>matches(x,source,name)&&predicate(x.args))===1;
    const transfers=events.filter(x=>matches(x,'asset','Transfer'));
    const expectedTransfers=[
      [lower(intent.buyer),market,n(requirement.amount)],
      [market,lower(e.maker),n(e.makerAmount)],
      ...(n(e.providerFee)===0n?[]:[[market,lower(e.provider),n(e.providerFee)]]),
      ...(n(e.protocolFee)===0n?[]:[[market,lower(e.protocolRecipient),n(e.protocolFee)]]),
    ];
    assert(transfers.length===expectedTransfers.length,'collateral transfers differ from quote');
    for(const wanted of expectedTransfers){
      const pos=transfers.findIndex(t=>equal(t.args.from,wanted[0])&&equal(t.args.to,wanted[1])&&
        n(t.args.value)===wanted[2]);
      assert(pos>=0,'maker, provider, protocol or buyer consideration differs');
      transfers.splice(pos,1);
    }
    assert(has('asset','AuthorizationUsed',a=>equal(a.authorizer,intent.buyer)&&
      equal(a.nonce,authorization.nonce)),'payment authorization nonce was not used once');
    assert(has('asset','AuthorizationTransferExecuted',a=>equal(a.authorizer,intent.buyer)&&
      equal(a.recipient,market)&&equal(a.submitter,market)&&
      equal(a.nonce,authorization.nonce)&&n(a.value)===n(requirement.amount)),
      'contract did not atomically execute receiver-only token authorization');
    const askEvents=events.filter(x=>matches(x,'market','AskFilled'));
    assert(askEvents.length===1,'an atomic purchase must emit one original AskFilled event');
    const filled=askEvents[0];
    assert(has('market','AskFilled',a=>n(a.askId)===n(e.askId)&&equal(a.buyer,intent.buyer)&&
      equal(a.provider,e.provider)&&n(a.lots)===n(e.lots)&&
      n(a.makerAmount)===n(e.makerAmount)&&n(a.providerFee)===n(e.providerFee)&&
      n(a.protocolFee)===n(e.protocolFee)&&equal(a.buyerIntentNonce,intent.nonce)),
      'market did not deliver exactly the signed economic fill');
    const positionId=n(e.marketId)*3n+n(e.outcome);
    assert(has('market','TransferSingle',a=>equal(a.from,market)&&
      equal(a.to,intent.buyer)&&n(a.id)===positionId&&n(a.value)===n(e.lots)),
      'buyer did not receive ERC-1155 outcome shares');
    const states=readState??(async({blockTag,buyer,paymentNonce,buyNonce,positionId})=>{
      const m=new libs.Contract(market,MARKET_RECEIPT_ABI,provider),a=new libs.Contract(asset,ASSET_RECEIPT_ABI,provider);
      const opts={blockTag};
      const [tokenNonce,intentNonce,shares,collateralBalance,backingLots,collateralPerLot]=await Promise.all([
        a.authorizationState(buyer,paymentNonce,opts),m.usedBuyIntents(buyer,buyNonce,opts),
        m.balanceOf(buyer,positionId,opts),a.balanceOf(market,opts),
        m.totalOutstandingBackingLots(opts),m.collateralPerLot(opts),
      ]);
      return {tokenNonce,intentNonce,shares,collateralBalance,backingLots,collateralPerLot};
    });
    const state=await states({blockTag:receipt.blockNumber,buyer:intent.buyer,
      paymentNonce:authorization.nonce,buyNonce:intent.nonce,positionId});
    assert(state?.tokenNonce===true && state.intentNonce===true&&n(state.shares)>=n(e.lots) &&
      n(state.collateralPerLot)>0n&&n(state.collateralBalance)>=n(state.backingLots)*n(state.collateralPerLot),
      'post-settlement nonces, shares or global collateral backing were not retained');
    return Object.freeze({
      finalized:true,transactionStatus:1,network,transactionHash:transactionHash.toLowerCase(),
      // This identifies an actual on-chain economic fill, not a TypedCommitment
      // or a recipient acceptance. Downstream offices can cite this source.
      sourceEconomicEvent:Object.freeze({type:'EvmAgentPredictionAskFilled',
        chain:network,blockNumber:receipt.blockNumber,blockHash:lower(receipt.blockHash),
        transactionHash:transactionHash.toLowerCase(),logIndex:filled.index,
        emitter:market,event:'AskFilled'}),
      market,asset,buyer:lower(intent.buyer),askId:e.askId,marketId:e.marketId,
      lots:e.lots,outcome:e.outcome,paymentNonce:lower(authorization.nonce),
      buyNonce:lower(intent.nonce),amount:requirement.amount,
      maker:lower(e.maker),provider:lower(e.provider),
      protocolRecipient:lower(e.protocolRecipient),makerAmount:e.makerAmount,
      providerFee:e.providerFee,protocolFee:e.protocolFee,
      authorizationNonceConsumed:true,buyerDebited:true,sharesReceived:true,
      feesSettled:true,backingConserved:true,
    });
  };
}

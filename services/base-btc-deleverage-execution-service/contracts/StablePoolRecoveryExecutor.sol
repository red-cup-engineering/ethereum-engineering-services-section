// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IERC20 { function balanceOf(address) external view returns (uint256); function allowance(address,address) external view returns(uint256); function approve(address,uint256) external returns(bool); function transferFrom(address,address,uint256) external returns(bool); function transfer(address,uint256) external returns(bool); }
interface IFactory { function getPool(address,address,bool) external view returns(address); }
interface IPool is IERC20 { function factory() external view returns(address); function token0() external view returns(address); function token1() external view returns(address); function stable() external view returns(bool); function burn(address) external returns(uint256,uint256); function getAmountOut(uint256,address) external view returns(uint256); function swap(uint256,uint256,address,bytes calldata) external; }

/// One deployed instance equals one irrevocably bounded action; it has no owner
/// and accepts no runtime topology, recipient, amount, or slippage parameters.
contract StablePoolRecoveryExecutor {
    address public immutable source; address public immutable recipient; address public immutable factory; address public immutable pool; address public immutable tbtc; address public immutable cbbtc;
    bool public immutable stable; uint256 public immutable lpAmount; uint256 public immutable looseTbtc; uint256 public immutable looseCbbtc; uint256 public immutable minBurn0; uint256 public immutable minBurn1; uint256 public immutable minRepay; uint256 public immutable maxRepay; uint256 public immutable deadline;
    bytes32 public immutable factoryCodeHash; bytes32 public immutable poolCodeHash; bytes32 public immutable token0CodeHash; bytes32 public immutable token1CodeHash;
    bool public used; uint256 private lock = 1;
    modifier onlySource() { require(msg.sender == source, "caller"); _; }
    modifier nonReentrant() { require(lock == 1, "reentrant"); lock = 2; _; lock = 1; }
    constructor(address source_,address recipient_,address factory_,address pool_,address tbtc_,address cbbtc_,bool stable_,uint256 lpAmount_,uint256 looseTbtc_,uint256 looseCbbtc_,uint256 minBurn0_,uint256 minBurn1_,uint256 minRepay_,uint256 maxRepay_,uint256 deadline_,bytes32 factoryHash_,bytes32 poolHash_,bytes32 token0Hash_,bytes32 token1Hash_) {
        require(source_ != address(0) && recipient_ != address(0) && factory_ != address(0) && pool_ != address(0) && tbtc_ != address(0) && cbbtc_ != address(0), "zero");
        require(factory_.code.length != 0 && pool_.code.length != 0 && tbtc_.code.length != 0 && cbbtc_.code.length != 0, "code");
        require(lpAmount_ != 0 && minBurn0_ != 0 && minBurn1_ != 0 && minRepay_ != 0 && minRepay_ <= maxRepay_, "zero limit");
        require(factoryHash_ != bytes32(0) && poolHash_ != bytes32(0) && token0Hash_ != bytes32(0) && token1Hash_ != bytes32(0), "hash");
        source=source_; recipient=recipient_; factory=factory_; pool=pool_; tbtc=tbtc_; cbbtc=cbbtc_; stable=stable_; lpAmount=lpAmount_; looseTbtc=looseTbtc_; looseCbbtc=looseCbbtc_; minBurn0=minBurn0_; minBurn1=minBurn1_; minRepay=minRepay_; maxRepay=maxRepay_; deadline=deadline_; factoryCodeHash=factoryHash_; poolCodeHash=poolHash_; token0CodeHash=token0Hash_; token1CodeHash=token1Hash_;
    }
    function execute() external onlySource nonReentrant {
        require(!used && block.timestamp <= deadline, "used/expired"); used = true;
        require(factory.codehash == factoryCodeHash && pool.codehash == poolCodeHash && tbtc.codehash == token0CodeHash && cbbtc.codehash == token1CodeHash, "codehash");
        IPool p=IPool(pool); require(IFactory(factory).getPool(tbtc,cbbtc,stable)==pool && p.factory()==factory && p.token0()==tbtc && p.token1()==cbbtc && p.stable()==stable, "topology");
        uint256 lpBefore=p.balanceOf(address(this)); uint256 tbtcBefore=IERC20(tbtc).balanceOf(address(this)); uint256 cbbtcBefore=IERC20(cbbtc).balanceOf(address(this));
        if(looseTbtc!=0) { _transferFrom(tbtc,source,address(this),looseTbtc); require(IERC20(tbtc).balanceOf(address(this)) == tbtcBefore + looseTbtc, "tbtc pull"); }
        if(looseCbbtc!=0) { _transferFrom(cbbtc,source,address(this),looseCbbtc); require(IERC20(cbbtc).balanceOf(address(this)) == cbbtcBefore + looseCbbtc, "cbbtc pull"); }
        _transferFrom(pool, source, address(this), lpAmount); require(p.balanceOf(address(this)) == lpBefore + lpAmount, "lp pull"); uint256 poolLpBefore=p.balanceOf(pool); _transfer(pool, pool, lpAmount); require(p.balanceOf(pool) == poolLpBefore + lpAmount, "lp return");
        p.burn(address(this)); require(p.balanceOf(address(this)) == lpBefore, "lp residue"); uint256 burn0=IERC20(tbtc).balanceOf(address(this))-tbtcBefore-looseTbtc; uint256 burn1=IERC20(cbbtc).balanceOf(address(this))-cbbtcBefore-looseCbbtc; require(burn0>=minBurn0 && burn1>=minBurn1, "burn minimum");
        uint256 swapInput=looseTbtc+burn0; uint256 quote=p.getAmountOut(swapInput,tbtc); require(quote != 0, "zero quote"); uint256 poolTbtcBefore=IERC20(tbtc).balanceOf(pool); _transfer(tbtc,pool,swapInput); require(IERC20(tbtc).balanceOf(pool) == poolTbtcBefore + swapInput, "swap input"); p.swap(0,quote,address(this),""); uint256 operationOut=IERC20(cbbtc).balanceOf(address(this))-cbbtcBefore; require(operationOut>=minRepay && operationOut<=maxRepay,"repay range");
        uint256 recipientBefore=IERC20(cbbtc).balanceOf(recipient); _transfer(cbbtc,recipient,operationOut); require(IERC20(cbbtc).balanceOf(recipient) == recipientBefore + operationOut,"recipient delta"); require(IERC20(tbtc).balanceOf(address(this)) == tbtcBefore && IERC20(cbbtc).balanceOf(address(this)) == cbbtcBefore && p.balanceOf(address(this)) == lpBefore, "residue");
        // Code hashes attest the deployed contract bytecode. Deployments behind upgradeable proxies
        // require a separate, immutable proxy-implementation attestation before use.
    }
    function _transferFrom(address token,address from,address to,uint256 amount) private { (bool ok,bytes memory data)=token.call(abi.encodeWithSelector(IERC20.transferFrom.selector,from,to,amount)); require(ok && (data.length==0 || abi.decode(data,(bool))),"transferFrom"); }
    function _transfer(address token,address to,uint256 amount) private { (bool ok,bytes memory data)=token.call(abi.encodeWithSelector(IERC20.transfer.selector,to,amount)); require(ok && (data.length==0 || abi.decode(data,(bool))),"transfer"); }
}

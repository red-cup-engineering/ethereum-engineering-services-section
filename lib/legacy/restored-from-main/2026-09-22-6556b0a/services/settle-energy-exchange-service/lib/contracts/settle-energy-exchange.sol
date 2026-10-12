// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

/// @notice A minimal unit ledger for the witnessed kilowatt-hour: the 561 Group Solar Economics
/// program's unit of account, minted only from a settled two-witness energy-exchange record
/// (`561-group-solar-economics-services-section/README.md`, "The mechanism at Earth scale" --
/// "a two-witness record of energy delivered (meter and counterparty) that mints one unit").
/// This contract does not decode the record: the record digest seated here is the SHA-256 of
/// the RFC 8785 canonical JSON the `settle-energy-exchange` operation already emits as the
/// record's own RFC 6920 `ni:` `id` -- decoded to its 32-byte digest, never re-hashed -- and the
/// two witness digests are the same construction over the record's two agreeing witness
/// sub-records, both checked off-chain by the settle-energy-exchange-record-service package's
/// own `settleEnergyExchangeRecord` before this contract is ever called. This is not yet an
/// ERC-20: it is the ledger primitive `mint` seats one settled record onto, once.
contract WitnessedKilowattHour {
    error RecordAlreadyMinted(bytes32 record);
    error WitnessesNotDistinct();
    error ZeroQuantity();

    /// @dev `milliKwh` in the record's own quantity is the ledger's smallest unit: one
    /// thousandth of a kilowatt-hour, matching the off-chain operation's decimal-string scale.
    mapping(address account => uint256 milliKwh) public balances;
    mapping(bytes32 record => uint256 milliKwh) public mintedOf;
    uint256 public totalSupply;

    event Minted(
        bytes32 indexed record,
        bytes32 indexed witnessA,
        bytes32 indexed witnessB,
        uint256 milliKwh,
        address to
    );

    /// @notice Seats one settled energy-exchange record's witnessed-kilowatt-hour quantity onto
    /// the ledger, once, and credits it to `to`.
    /// @param record The record's own `ni:` `id` decoded to its 32-byte SHA-256 digest.
    /// @param witnessA The first agreeing witness sub-record's digest, same construction.
    /// @param witnessB The second agreeing witness sub-record's digest, same construction; must
    /// differ from `witnessA` -- two witnesses of different kinds is the settlement discipline
    /// this contract enforces structurally, having no way to read `witnesses[].kind` itself.
    /// @param milliKwh The settled quantity in milli-kWh (`quantity` scaled by 1000); must be
    /// nonzero.
    /// @param to The account credited with the minted milli-kWh.
    function mint(bytes32 record, bytes32 witnessA, bytes32 witnessB, uint256 milliKwh, address to)
        external
    {
        if (mintedOf[record] != 0) revert RecordAlreadyMinted(record);
        if (witnessA == witnessB) revert WitnessesNotDistinct();
        if (milliKwh == 0) revert ZeroQuantity();
        mintedOf[record] = milliKwh;
        balances[to] += milliKwh;
        totalSupply += milliKwh;
        emit Minted(record, witnessA, witnessB, milliKwh, to);
    }

    /// @notice The account's witnessed-kilowatt-hour balance, in milli-kWh.
    function balanceOf(address account) external view returns (uint256) {
        return balances[account];
    }
}

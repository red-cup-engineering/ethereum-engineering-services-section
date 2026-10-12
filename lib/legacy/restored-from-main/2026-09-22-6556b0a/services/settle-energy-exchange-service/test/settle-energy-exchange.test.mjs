import assert from "node:assert/strict";
import test from "node:test";
import { settleEnergyExchange } from "../scripts/settle-energy-exchange.mjs";

const TO = "0x0000000000000000000000000000000000000a11";

const settledInput = {"kind":"energy-exchange","period":{"start":"2026-08-01T00:00:00Z","end":"2026-08-31T23:59:59Z"},"commodity":"KWH","quantity":"412.5","from":{"id":"urn:example:household-a","role":"producer"},"to":{"id":"urn:example:utility-co","role":"grid"},"place":{"lat":44.9778,"lon":-93.265,"utilityId":"urn:example:utility-co"},"witnesses":[{"kind":"meter","value":"412.5","source":"urn:example:household-a-inverter-export-2026-08","asOf":"2026-09-01T00:00:00Z"},{"kind":"utility-statement","value":"412.5","source":"https://utility-co.example/statements/2026-08","asOf":"2026-09-03T00:00:00Z"}],"price":{"amount":"0.11","commodity":"USD","perUnit":true}};
const mismatchInput = {"kind":"energy-exchange","period":{"start":"2026-08-01T00:00:00Z","end":"2026-08-31T23:59:59Z"},"commodity":"KWH","quantity":"398.0","from":{"id":"urn:example:household-b","role":"producer"},"to":{"id":"urn:example:utility-co","role":"grid"},"place":{"lat":46.7296,"lon":-94.6859,"utilityId":"urn:example:utility-co"},"witnesses":[{"kind":"meter","value":"398.0","source":"urn:example:household-b-inverter-export-2026-08","asOf":"2026-09-01T00:00:00Z"},{"kind":"utility-statement","value":"371.2","source":"https://utility-co.example/statements/2026-08-household-b","asOf":"2026-09-03T00:00:00Z"}]};
const postedPropaneInput = {"kind":"energy-exchange","period":{"start":"2026-08-01T00:00:00Z","end":"2026-08-31T23:59:59Z"},"commodity":"PROPANE_GAL","quantity":"150","from":{"id":"did:example:propane-co","role":"producer"},"to":{"id":"urn:example:household-c","role":"consumer"},"place":{"lat":47.455,"lon":-95.5822},"witnesses":[{"kind":"bank-row","value":"150","source":"urn:example:household-c-bank-statement-2026-08","asOf":"2026-08-15T00:00:00Z"},{"kind":"bank-row","value":"150","source":"urn:example:household-c-bank-statement-2026-08-corrected","asOf":"2026-08-20T00:00:00Z"}],"price":{"amount":"2.79","commodity":"USD","perUnit":true}};

const alreadySettledRecord = {"id":"ni:///sha-256;hwS8YQPMpxlttQoauP1v-luJHmq1nCNNwZ0tmy5zvVA","kind":"energy-exchange","period":{"start":"2026-08-01T00:00:00Z","end":"2026-08-31T23:59:59Z"},"commodity":"KWH","quantity":"412.5","from":{"id":"urn:example:household-a","role":"producer"},"to":{"id":"urn:example:utility-co","role":"grid"},"place":{"lat":44.9778,"lon":-93.265,"utilityId":"urn:example:utility-co"},"witnesses":[{"kind":"meter","value":"412.5","source":"urn:example:household-a-inverter-export-2026-08","asOf":"2026-09-01T00:00:00Z"},{"kind":"utility-statement","value":"412.5","source":"https://utility-co.example/statements/2026-08","asOf":"2026-09-03T00:00:00Z"}],"price":{"amount":"0.11","commodity":"USD","perUnit":true},"settlement":{"status":"settled","mismatch":null,"settledAt":"2026-09-03T00:00:00Z"}};

test("a record that settles in KWH with two distinct witnesses names the exact mint call", () => {
  const result = settleEnergyExchange({ record: settledInput, to: TO });
  assert.equal(result.unit.commodity, "KWH");
  assert.equal(result.unit.quantity, "412.5");
  assert.equal(result.unit.digest, "0x8704bc6103cca7196db50a1ab8fd6ffa5b891e6ab59c234dc19d2d9b2e73bd50");
  assert.deepEqual(result.unit.witnesses, [
    "0x1f5a3e864abe16da1beb603b95f860f07cb2e8cf1b66ab27357d0f9d8250ab63",
    "0x91acdfca05b31ddc8a46414fcc93225b3ca068aae7410de4c8f296b6d3304003",
  ]);
  assert.deepEqual(result.call, {
    contract: "WitnessedKilowattHour",
    function: "mint",
    args: [
      "0x8704bc6103cca7196db50a1ab8fd6ffa5b891e6ab59c234dc19d2d9b2e73bd50",
      "0x1f5a3e864abe16da1beb603b95f860f07cb2e8cf1b66ab27357d0f9d8250ab63",
      "0x91acdfca05b31ddc8a46414fcc93225b3ca068aae7410de4c8f296b6d3304003",
      "412500",
      TO,
    ],
  });
});

test("an already-settled record (carrying id and settlement) passes through unsettled a second time", () => {
  const result = settleEnergyExchange({ record: alreadySettledRecord, to: TO });
  assert.equal(result.record, alreadySettledRecord);
  assert.equal(result.unit.digest, "0x8704bc6103cca7196db50a1ab8fd6ffa5b891e6ab59c234dc19d2d9b2e73bd50");
});

test("a mismatched record refuses as data: not-settled", () => {
  const result = settleEnergyExchange({ record: mismatchInput, to: TO });
  assert.equal(result.refused, true);
  assert.equal(result.reason, "not-settled");
  assert.equal(result.status, "mismatch");
});

test("a lone-witness-kind record refuses as data: not-settled (posted)", () => {
  const result = settleEnergyExchange({ record: postedPropaneInput, to: TO });
  assert.equal(result.refused, true);
  assert.equal(result.reason, "not-settled");
  assert.equal(result.status, "posted");
});

test("a non-KWH settled record refuses as data: not-kilowatt-hour-commodity", () => {
  const result = settleEnergyExchange({ record: { ...alreadySettledRecord, commodity: "PROPANE_GAL" }, to: TO });
  assert.equal(result.refused, true);
  assert.equal(result.reason, "not-kilowatt-hour-commodity");
  assert.equal(result.commodity, "PROPANE_GAL");
});

test("a quantity finer than milli-kWh refuses as data: sub-milliwatt-hour-precision", () => {
  const result = settleEnergyExchange({ record: { ...alreadySettledRecord, quantity: "0.0001" }, to: TO });
  assert.equal(result.refused, true);
  assert.equal(result.reason, "sub-milliwatt-hour-precision");
});

test("a zero quantity refuses as data: non-positive-quantity", () => {
  const result = settleEnergyExchange({ record: { ...alreadySettledRecord, quantity: "0" }, to: TO });
  assert.equal(result.refused, true);
  assert.equal(result.reason, "non-positive-quantity");
});

test("an already-settled record with fewer than two distinct witness kinds refuses as data: insufficient-distinct-witnesses", () => {
  const record = { ...alreadySettledRecord, witnesses: [alreadySettledRecord.witnesses[0]] };
  const result = settleEnergyExchange({ record, to: TO });
  assert.equal(result.refused, true);
  assert.equal(result.reason, "insufficient-distinct-witnesses");
});

test("refuses a missing record", () => {
  assert.throws(() => settleEnergyExchange({ to: TO }), /record is required/u);
});

test("refuses a malformed EVM address", () => {
  assert.throws(() => settleEnergyExchange({ record: alreadySettledRecord, to: "not-an-address" }), /0x-prefixed 40-hex-digit EVM address/u);
});

test("refuses an already-settled record whose settlement is not an object", () => {
  assert.throws(() => settleEnergyExchange({ record: { ...alreadySettledRecord, settlement: "settled" }, to: TO }), /settlement must be an object/u);
});

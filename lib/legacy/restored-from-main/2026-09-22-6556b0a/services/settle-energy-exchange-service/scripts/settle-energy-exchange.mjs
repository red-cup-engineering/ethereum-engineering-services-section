#!/usr/bin/env node
import { settleEnergyExchangeRecord } from "@red-cup-engineering/settle-energy-exchange-record-service";
import { canonicalizeJson } from "@red-cup-engineering/computer-data-engine/identity";
import { makeNiUriService } from "@red-cup-engineering/computer-data-engine/identity";
import { niUriDigestBytes } from "@red-cup-engineering/computer-data-engine/identity";
import { runJavascriptNodeOperation } from "../../../../../../../../computer-code-engineering-services-section/services/javascript-engineering-services-section/services/javascript-node-services-section/src/operation.mjs";

const DECIMAL = /^-?[0-9]+(?:\.[0-9]+)?$/u;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/u;

function toMilliKwh(quantity) {
  if (typeof quantity !== "string" || !DECIMAL.test(quantity)) throw new TypeError("record.quantity must be a decimal string");
  const negative = quantity.startsWith("-");
  const unsigned = negative ? quantity.slice(1) : quantity;
  const [intPart, fracPart = ""] = unsigned.split(".");
  if (fracPart.length > 3) return null;
  const milli = BigInt(`${intPart}${fracPart.padEnd(3, "0")}`);
  return negative ? -milli : milli;
}

function firstTwoDistinctKindWitnesses(witnesses) {
  const firstByKind = new Map();
  for (const witness of witnesses) {
    if (!firstByKind.has(witness.kind)) firstByKind.set(witness.kind, witness);
  }
  const distinct = [...firstByKind.values()];
  return distinct.length >= 2 ? [distinct[0], distinct[1]] : null;
}

function digestBytes32(uri) {
  return `0x${niUriDigestBytes(uri).toString("hex")}`;
}

function digestWitness(witness) {
  const { text } = canonicalizeJson({ value: witness });
  const { uri } = makeNiUriService({ text });
  return digestBytes32(uri);
}

/**
 * Composes @red-cup-engineering/settle-energy-exchange-record-service's own `settleEnergyExchangeRecord` to settle an EnergyExchangeRecord that does not yet carry `id`/`settlement` (an already-settled record, carrying both, passes through unchanged), refuses as data unless the settlement reaches `status: "settled"`, and otherwise names the exact `WitnessedKilowattHour.mint` call the settled record and its two agreeing witnesses license: the record digest decodes the record's own `ni:` `id` (never a second hash), and the two witness digests hash the two agreeing witness sub-records `settleEnergyExchangeRecord` used to settle it, composing `@red-cup-engineering/canonicalize-json-service` and `@red-cup-engineering/make-ni-uri-service`. Never submits the call itself.
 * @param {{record: object, to: string, tolerance?: string}} request A record with `record` (an EnergyExchangeRecord, settled or not), `to` (the EVM address to credit, `0x` followed by 40 hex digits), and an optional `tolerance` decimal string forwarded to `settleEnergyExchangeRecord` when `record` does not yet carry `id`/`settlement`.
 * @returns {object} `{record, unit: {commodity: "KWH", quantity, digest, witnesses}, call: {contract: "WitnessedKilowattHour", function: "mint", args: [recordDigest, witnessADigest, witnessBDigest, milliKwh, to]}}` once the record is settled in `KWH` with a positive, milli-kWh-representable quantity and at least two distinct witness kinds; otherwise `{refused: true, reason, record, ...}` naming `"not-settled"`, `"not-kilowatt-hour-commodity"`, `"sub-milliwatt-hour-precision"`, `"non-positive-quantity"`, or `"insufficient-distinct-witnesses"`.
 * @throws {TypeError} When `request` or `record` is not an object, an already-settled `record.settlement` is not an object, or `to` is not a `0x`-prefixed 40-hex-digit address.
 */
export function settleEnergyExchange(request) {
  if (request === null || typeof request !== "object" || Array.isArray(request)) throw new TypeError("request must be an object");
  const record = request.record;
  if (record === null || typeof record !== "object" || Array.isArray(record)) throw new TypeError("record is required");
  if (typeof request.to !== "string" || !EVM_ADDRESS.test(request.to)) throw new TypeError("to must be a 0x-prefixed 40-hex-digit EVM address");
  const to = request.to.toLowerCase();

  const alreadySettled = Object.prototype.hasOwnProperty.call(record, "id") && Object.prototype.hasOwnProperty.call(record, "settlement");
  if (alreadySettled && (record.settlement === null || typeof record.settlement !== "object")) {
    throw new TypeError("record.settlement must be an object when record already carries id and settlement");
  }
  const settled = alreadySettled ? record : settleEnergyExchangeRecord({ record, tolerance: request.tolerance });

  if (settled.settlement.status !== "settled") {
    return { refused: true, reason: "not-settled", status: settled.settlement.status, record: settled };
  }
  if (settled.commodity !== "KWH") {
    return { refused: true, reason: "not-kilowatt-hour-commodity", commodity: settled.commodity, record: settled };
  }
  const milliKwh = toMilliKwh(settled.quantity);
  if (milliKwh === null) {
    return { refused: true, reason: "sub-milliwatt-hour-precision", quantity: settled.quantity, record: settled };
  }
  if (milliKwh <= 0n) {
    return { refused: true, reason: "non-positive-quantity", quantity: settled.quantity, record: settled };
  }
  const witnessPair = firstTwoDistinctKindWitnesses(settled.witnesses);
  if (witnessPair === null) {
    return { refused: true, reason: "insufficient-distinct-witnesses", record: settled };
  }

  const recordDigest = digestBytes32(settled.id);
  const witnessDigests = witnessPair.map(digestWitness);

  return {
    record: settled,
    unit: { commodity: "KWH", quantity: settled.quantity, digest: recordDigest, witnesses: witnessDigests },
    call: {
      contract: "WitnessedKilowattHour",
      function: "mint",
      args: [recordDigest, witnessDigests[0], witnessDigests[1], milliKwh.toString(), to],
    },
  };
}

if (import.meta.main) {
  const result = await runJavascriptNodeOperation({ name: "settle-energy-exchange", description: "Composes", operation: settleEnergyExchange }, { arguments: process.argv.slice(2), standardInput: process.stdin, standardOutput: process.stdout });
  process.exitCode = result.exitCode;
}

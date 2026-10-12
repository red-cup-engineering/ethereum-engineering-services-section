# @red-cup-engineering/settle-energy-exchange-service

Composes `@red-cup-engineering/settle-energy-exchange-record-service`'s own `settleEnergyExchangeRecord` to settle an EnergyExchangeRecord, refuses as data unless it settles in `KWH`, and names the exact `WitnessedKilowattHour.mint` call the settled record and its two agreeing witnesses license -- never submitting that call itself.

- `lib/contracts/settle-energy-exchange.sol` -- `WitnessedKilowattHour`, the minimal on-chain unit ledger the `call` this operation returns mints into: one settled record digest seats once, crediting `milliKwh` to the recipient. Tested through `ethereum-services-section`'s existing Foundry toolchain (`test/WitnessedKilowattHour.t.sol` there imports this file via its published npm dependency, the same pattern `route-directed-yield-service/lib/contracts/route-directed-yield.sol` and `semiotic-exchange-chain-services-section/lib/contracts/SemioticExchange.sol` use).

## Operation

~~~js
export function settleEnergyExchange(request)
~~~

### Parameters

- request ({record: object, to: string, tolerance?: string}): A record with `record` (an EnergyExchangeRecord, settled or not), `to` (the EVM address to credit, `0x` followed by 40 hex digits), and an optional `tolerance` decimal string forwarded to `settleEnergyExchangeRecord` when `record` does not yet carry `id`/`settlement`.

### Returns

object: `{record, unit: {commodity: "KWH", quantity, digest, witnesses}, call: {contract: "WitnessedKilowattHour", function: "mint", args: [recordDigest, witnessADigest, witnessBDigest, milliKwh, to]}}` once the record is settled in `KWH` with a positive, milli-kWh-representable quantity and at least two distinct witness kinds; otherwise `{refused: true, reason, record, ...}` naming `"not-settled"`, `"not-kilowatt-hour-commodity"`, `"sub-milliwatt-hour-precision"`, `"non-positive-quantity"`, or `"insufficient-distinct-witnesses"`.

### Refusals

- TypeError: When `request` or `record` is not an object, an already-settled `record.settlement` is not an object, or `to` is not a `0x`-prefixed 40-hex-digit address.

## Command

settle-energy-exchange reads one JSON value per input line and writes one JSON value per output line.

## Examples

### a settled KWH record with two distinct witnesses names the exact mint call

Input:

~~~json
{
  "record": {
    "kind": "energy-exchange",
    "period": {
      "start": "2026-08-01T00:00:00Z",
      "end": "2026-08-31T23:59:59Z"
    },
    "commodity": "KWH",
    "quantity": "412.5",
    "from": {
      "id": "urn:example:household-a",
      "role": "producer"
    },
    "to": {
      "id": "urn:example:utility-co",
      "role": "grid"
    },
    "place": {
      "lat": 44.9778,
      "lon": -93.265,
      "utilityId": "urn:example:utility-co"
    },
    "witnesses": [
      {
        "kind": "meter",
        "value": "412.5",
        "source": "urn:example:household-a-inverter-export-2026-08",
        "asOf": "2026-09-01T00:00:00Z"
      },
      {
        "kind": "utility-statement",
        "value": "412.5",
        "source": "https://utility-co.example/statements/2026-08",
        "asOf": "2026-09-03T00:00:00Z"
      }
    ],
    "price": {
      "amount": "0.11",
      "commodity": "USD",
      "perUnit": true
    }
  },
  "to": "0x0000000000000000000000000000000000000a11"
}
~~~

Output:

~~~json
{
  "record": {
    "id": "ni:///sha-256;hwS8YQPMpxlttQoauP1v-luJHmq1nCNNwZ0tmy5zvVA",
    "kind": "energy-exchange",
    "period": {
      "start": "2026-08-01T00:00:00Z",
      "end": "2026-08-31T23:59:59Z"
    },
    "commodity": "KWH",
    "quantity": "412.5",
    "from": {
      "id": "urn:example:household-a",
      "role": "producer"
    },
    "to": {
      "id": "urn:example:utility-co",
      "role": "grid"
    },
    "place": {
      "lat": 44.9778,
      "lon": -93.265,
      "utilityId": "urn:example:utility-co"
    },
    "witnesses": [
      {
        "kind": "meter",
        "value": "412.5",
        "source": "urn:example:household-a-inverter-export-2026-08",
        "asOf": "2026-09-01T00:00:00Z"
      },
      {
        "kind": "utility-statement",
        "value": "412.5",
        "source": "https://utility-co.example/statements/2026-08",
        "asOf": "2026-09-03T00:00:00Z"
      }
    ],
    "price": {
      "amount": "0.11",
      "commodity": "USD",
      "perUnit": true
    },
    "settlement": {
      "status": "settled",
      "mismatch": null,
      "settledAt": "2026-09-03T00:00:00Z"
    }
  },
  "unit": {
    "commodity": "KWH",
    "quantity": "412.5",
    "digest": "0x8704bc6103cca7196db50a1ab8fd6ffa5b891e6ab59c234dc19d2d9b2e73bd50",
    "witnesses": [
      "0x1f5a3e864abe16da1beb603b95f860f07cb2e8cf1b66ab27357d0f9d8250ab63",
      "0x91acdfca05b31ddc8a46414fcc93225b3ca068aae7410de4c8f296b6d3304003"
    ]
  },
  "call": {
    "contract": "WitnessedKilowattHour",
    "function": "mint",
    "args": [
      "0x8704bc6103cca7196db50a1ab8fd6ffa5b891e6ab59c234dc19d2d9b2e73bd50",
      "0x1f5a3e864abe16da1beb603b95f860f07cb2e8cf1b66ab27357d0f9d8250ab63",
      "0x91acdfca05b31ddc8a46414fcc93225b3ca068aae7410de4c8f296b6d3304003",
      "412500",
      "0x0000000000000000000000000000000000000a11"
    ]
  }
}
~~~

### a disagreeing pair of witnesses refuses as data: not-settled

Input:

~~~json
{
  "record": {
    "kind": "energy-exchange",
    "period": {
      "start": "2026-08-01T00:00:00Z",
      "end": "2026-08-31T23:59:59Z"
    },
    "commodity": "KWH",
    "quantity": "398.0",
    "from": {
      "id": "urn:example:household-b",
      "role": "producer"
    },
    "to": {
      "id": "urn:example:utility-co",
      "role": "grid"
    },
    "place": {
      "lat": 46.7296,
      "lon": -94.6859,
      "utilityId": "urn:example:utility-co"
    },
    "witnesses": [
      {
        "kind": "meter",
        "value": "398.0",
        "source": "urn:example:household-b-inverter-export-2026-08",
        "asOf": "2026-09-01T00:00:00Z"
      },
      {
        "kind": "utility-statement",
        "value": "371.2",
        "source": "https://utility-co.example/statements/2026-08-household-b",
        "asOf": "2026-09-03T00:00:00Z"
      }
    ]
  },
  "to": "0x0000000000000000000000000000000000000a11"
}
~~~

Output:

~~~json
{
  "refused": true,
  "reason": "not-settled",
  "status": "mismatch",
  "record": {
    "id": "ni:///sha-256;gz8u7e88tr7_hNiadFM0bw6aRlyH4DFIoMxHF_UQ8uQ",
    "kind": "energy-exchange",
    "period": {
      "start": "2026-08-01T00:00:00Z",
      "end": "2026-08-31T23:59:59Z"
    },
    "commodity": "KWH",
    "quantity": "398.0",
    "from": {
      "id": "urn:example:household-b",
      "role": "producer"
    },
    "to": {
      "id": "urn:example:utility-co",
      "role": "grid"
    },
    "place": {
      "lat": 46.7296,
      "lon": -94.6859,
      "utilityId": "urn:example:utility-co"
    },
    "witnesses": [
      {
        "kind": "meter",
        "value": "398.0",
        "source": "urn:example:household-b-inverter-export-2026-08",
        "asOf": "2026-09-01T00:00:00Z"
      },
      {
        "kind": "utility-statement",
        "value": "371.2",
        "source": "https://utility-co.example/statements/2026-08-household-b",
        "asOf": "2026-09-03T00:00:00Z"
      }
    ],
    "settlement": {
      "status": "mismatch",
      "mismatch": "26.8",
      "settledAt": null
    }
  }
}
~~~

### a settled non-KWH commodity refuses as data: not-kilowatt-hour-commodity

Input:

~~~json
{
  "record": {
    "id": "ni:///sha-256;hwS8YQPMpxlttQoauP1v-luJHmq1nCNNwZ0tmy5zvVA",
    "kind": "energy-exchange",
    "period": {
      "start": "2026-08-01T00:00:00Z",
      "end": "2026-08-31T23:59:59Z"
    },
    "commodity": "PROPANE_GAL",
    "quantity": "412.5",
    "from": {
      "id": "urn:example:household-a",
      "role": "producer"
    },
    "to": {
      "id": "urn:example:utility-co",
      "role": "grid"
    },
    "place": {
      "lat": 44.9778,
      "lon": -93.265,
      "utilityId": "urn:example:utility-co"
    },
    "witnesses": [
      {
        "kind": "meter",
        "value": "412.5",
        "source": "urn:example:household-a-inverter-export-2026-08",
        "asOf": "2026-09-01T00:00:00Z"
      },
      {
        "kind": "utility-statement",
        "value": "412.5",
        "source": "https://utility-co.example/statements/2026-08",
        "asOf": "2026-09-03T00:00:00Z"
      }
    ],
    "price": {
      "amount": "0.11",
      "commodity": "USD",
      "perUnit": true
    },
    "settlement": {
      "status": "settled",
      "mismatch": null,
      "settledAt": "2026-09-03T00:00:00Z"
    }
  },
  "to": "0x0000000000000000000000000000000000000a11"
}
~~~

Output:

~~~json
{
  "refused": true,
  "reason": "not-kilowatt-hour-commodity",
  "commodity": "PROPANE_GAL",
  "record": {
    "id": "ni:///sha-256;hwS8YQPMpxlttQoauP1v-luJHmq1nCNNwZ0tmy5zvVA",
    "kind": "energy-exchange",
    "period": {
      "start": "2026-08-01T00:00:00Z",
      "end": "2026-08-31T23:59:59Z"
    },
    "commodity": "PROPANE_GAL",
    "quantity": "412.5",
    "from": {
      "id": "urn:example:household-a",
      "role": "producer"
    },
    "to": {
      "id": "urn:example:utility-co",
      "role": "grid"
    },
    "place": {
      "lat": 44.9778,
      "lon": -93.265,
      "utilityId": "urn:example:utility-co"
    },
    "witnesses": [
      {
        "kind": "meter",
        "value": "412.5",
        "source": "urn:example:household-a-inverter-export-2026-08",
        "asOf": "2026-09-01T00:00:00Z"
      },
      {
        "kind": "utility-statement",
        "value": "412.5",
        "source": "https://utility-co.example/statements/2026-08",
        "asOf": "2026-09-03T00:00:00Z"
      }
    ],
    "price": {
      "amount": "0.11",
      "commodity": "USD",
      "perUnit": true
    },
    "settlement": {
      "status": "settled",
      "mismatch": null,
      "settledAt": "2026-09-03T00:00:00Z"
    }
  }
}
~~~

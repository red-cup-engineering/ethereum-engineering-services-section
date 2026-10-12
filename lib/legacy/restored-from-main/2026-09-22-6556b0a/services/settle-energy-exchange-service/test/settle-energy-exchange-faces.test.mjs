import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { settleEnergyExchange } from "../scripts/settle-energy-exchange.mjs";

const examples = [
  {
    "type": "JavascriptNodeOperationExample",
    "name": "a settled KWH record with two distinct witnesses names the exact mint call",
    "input": {
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
    },
    "output": {
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
  },
  {
    "type": "JavascriptNodeOperationExample",
    "name": "a disagreeing pair of witnesses refuses as data: not-settled",
    "input": {
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
    },
    "output": {
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
  },
  {
    "type": "JavascriptNodeOperationExample",
    "name": "a settled non-KWH commodity refuses as data: not-kilowatt-hour-commodity",
    "input": {
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
    },
    "output": {
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
  }
];

for (const example of examples) {
  test(example.name, async () => {
    const importedOutput = await settleEnergyExchange(example.input);
    assert.deepEqual(importedOutput, example.output);
    const command = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/settle-energy-exchange.mjs", import.meta.url))], {
      input: JSON.stringify(example.input) + "\n",
      encoding: "utf8",
    });
    assert.equal(command.status, 0, command.stderr);
    const commandOutput = JSON.parse(command.stdout.trim());
    assert.deepEqual(commandOutput, example.output);
    assert.deepEqual(commandOutput, importedOutput);
  });
}

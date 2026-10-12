import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { verifyEvmSignedMessage } from "../scripts/verify-evm-signed-message.mjs";

const examples = [
  {
    "type": "JavascriptNodeOperationExample",
    "name": "a malformed signature is refused before the message is parsed",
    "input": {
      "message": "hello",
      "signature": "0xnothex"
    },
    "output": {
      "verified": false,
      "reason": "signature must be a 0x-prefixed 130-hex-digit EIP-191 signature"
    }
  },
  {
    "type": "JavascriptNodeOperationExample",
    "name": "a non-object request is refused",
    "input": null,
    "output": {
      "verified": false,
      "reason": "request must be a JSON object"
    }
  }
];

for (const example of examples) {
  test(example.name, async () => {
    const importedOutput = await verifyEvmSignedMessage(example.input);
    assert.deepEqual(importedOutput, example.output);
    const command = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/verify-evm-signed-message.mjs", import.meta.url))], {
      input: JSON.stringify(example.input) + "\n",
      encoding: "utf8",
    });
    assert.equal(command.status, 0, command.stderr);
    const commandOutput = JSON.parse(command.stdout.trim());
    assert.deepEqual(commandOutput, example.output);
    assert.deepEqual(commandOutput, importedOutput);
  });
}

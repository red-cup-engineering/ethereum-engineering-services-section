#!/usr/bin/env python3
"""Fixed-policy SemioticExchange read membrane for a Workers VPC service."""

import json
import os
import re
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

CHAIN_RPC = "http://127.0.0.1:8561"
EXCHANGE = "0x98bbc65824962b61df876a47b5779c4ecbbd4939"
DEPLOYMENT_BLOCK = 5619
EVENT_TOPICS = [
    "0xc047c3429748a223b56b02776b2c3993c72d320b8c685d712a6cad64612738e9",
    "0x82f2bb67acbffd5675cbbf5ddf0528513b5f3fad32c2450ea140aaca775810dd",
    "0x6467956a6570214a321c98e8430560bfc5c26ad205b9f716f73e7b871a19e217",
    "0x0f0309f9d310294eab5c1f23f84eb646597511ddffdb15f4a36c598675b4aeed",
    "0x3a7feaa064aeb6612f758876640d573a2d8a75dceb49942a8435289e03495880",
    "0xc975c954b646cc7c315af0d6d8e768d84a6febf92e822d402ba9c4f3ee7246d9",
]
HEX_BLOCK = re.compile(r"^0x(?:0|[1-9a-f][0-9a-f]*)$")


def admit_rpc(value):
    if not isinstance(value, dict) or value.get("jsonrpc") != "2.0" or value.get("id") != 1:
        raise ValueError("one JSON-RPC 2.0 request with id 1 is required")
    method, params = value.get("method"), value.get("params")
    if method == "eth_blockNumber" and params == []:
        return value
    if method != "eth_getLogs" or not isinstance(params, list) or len(params) != 1:
        raise ValueError("only eth_blockNumber and the fixed SemioticExchange eth_getLogs read are admitted")
    query = params[0]
    if not isinstance(query, dict) or set(query) != {"address", "fromBlock", "toBlock", "topics"}:
        raise ValueError("foreign log filter")
    if str(query["address"]).lower() != EXCHANGE or query["topics"] != [EVENT_TOPICS]:
        raise ValueError("foreign contract or event topics")
    first, last = query["fromBlock"], query["toBlock"]
    if not isinstance(first, str) or not isinstance(last, str) or not HEX_BLOCK.fullmatch(first) or not HEX_BLOCK.fullmatch(last):
        raise ValueError("closed hexadecimal block interval required")
    if int(first, 16) < DEPLOYMENT_BLOCK or int(last, 16) < int(first, 16):
        raise ValueError("log interval is outside the deployed SemioticExchange history")
    return value


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/v1/semiotic-exchange/rpc":
            return self.reply(404, {"error": "not found"})
        try:
            length = int(self.headers.get("content-length", "0"))
            if length < 1 or length > 16384:
                raise ValueError("bounded JSON body required")
            request = admit_rpc(json.loads(self.rfile.read(length)))
            upstream = urllib.request.Request(CHAIN_RPC, data=json.dumps(request, separators=(",", ":")).encode(), headers={"Content-Type": "application/json"}, method="POST")
            with urllib.request.urlopen(upstream, timeout=60) as response:
                body = response.read(16 * 1024 * 1024 + 1)
            if len(body) > 16 * 1024 * 1024:
                raise ValueError("chain response exceeds the membrane bound")
            decoded = json.loads(body)
            if decoded.get("jsonrpc") != "2.0" or decoded.get("id") != 1 or not ("result" in decoded or "error" in decoded):
                raise ValueError("malformed chain response")
            self.reply(200, decoded)
        except (ValueError, json.JSONDecodeError) as error:
            self.reply(400, {"error": str(error)})
        except Exception:
            self.reply(503, {"error": "cloud chain unavailable"})

    def do_GET(self):
        self.reply(405, {"error": "method not allowed"}, {"Allow": "POST"})

    def log_message(self, _format, *_args):
        return

    def reply(self, status, value, extra=None):
        body = json.dumps(value, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Length", str(len(body)))
        for name, entry in (extra or {}).items():
            self.send_header(name, entry)
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    host = os.environ.get("SEMIOTIC_EXCHANGE_RPC_HOST", "10.128.0.2")
    port = int(os.environ.get("SEMIOTIC_EXCHANGE_RPC_PORT", "8562"))
    if host != "10.128.0.2" or port != 8562:
        raise SystemExit("the membrane binds only the cloud machine private address 10.128.0.2:8562")
    ThreadingHTTPServer((host, port), Handler).serve_forever()

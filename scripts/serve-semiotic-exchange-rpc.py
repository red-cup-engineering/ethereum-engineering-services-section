#!/usr/bin/env python3
"""Fixed-policy SemioticExchange read membrane for a Workers VPC service."""

import json
import os
import pathlib
import re
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

CONFIG_PATH = pathlib.Path(__file__).resolve().parents[1] / "content" / "config" / "union-alpha-chain-semiotic-exchange-reader.json"


def load_configuration(path=CONFIG_PATH):
    with open(path, encoding="utf-8") as source:
        value = json.load(source)
    if not isinstance(value, dict) or value.get("type") != "UnionSemioticExchangeHistoryReaderConfiguration" or value.get("version") != 1:
        raise ValueError("canonical SemioticExchange reader configuration required")
    if not isinstance(value.get("chainId"), str) or not re.fullmatch(r"eip155:[1-9][0-9]*", value["chainId"]):
        raise ValueError("reader chainId must be CAIP-2 eip155")
    if not isinstance(value.get("exchange"), str) or not re.fullmatch(r"0x[0-9a-fA-F]{40}", value["exchange"]):
        raise ValueError("reader exchange must be an EVM address")
    if type(value.get("deploymentBlock")) is not int or value["deploymentBlock"] < 0:
        raise ValueError("reader deploymentBlock must be a nonnegative integer")
    if type(value.get("maxBlockWindow")) is not int or not 1 <= value["maxBlockWindow"] <= 4096:
        raise ValueError("reader maxBlockWindow must be an integer between 1 and 4096")
    topics = value.get("eventTopics")
    if not isinstance(topics, list) or not topics or any(not isinstance(topic, str) or not re.fullmatch(r"0x[0-9a-fA-F]{64}", topic) for topic in topics):
        raise ValueError("reader eventTopics must be nonempty bytes32 topics")
    if not isinstance(value.get("chainRpc"), str) or not value["chainRpc"].startswith(("http://", "https://")):
        raise ValueError("reader chainRpc must be an HTTP endpoint")
    membrane = value.get("membrane")
    if not isinstance(membrane, dict) or membrane.get("host") != "10.128.0.2" or membrane.get("port") != 8562 or membrane.get("path") != "/v1/semiotic-exchange/rpc":
        raise ValueError("reader membrane must bind the admitted private read boundary")
    return value


CONFIG = load_configuration()
CHAIN_RPC = CONFIG["chainRpc"]
CHAIN_ID = int(CONFIG["chainId"].split(":")[1])
EXCHANGE = CONFIG["exchange"].lower()
DEPLOYMENT_BLOCK = CONFIG["deploymentBlock"]
MAX_BLOCK_WINDOW = CONFIG["maxBlockWindow"]
EVENT_TOPICS = CONFIG["eventTopics"]
HEX_BLOCK = re.compile(r"^0x(?:0|[1-9a-f][0-9a-f]*)$")


def verify_chain(opener=urllib.request.urlopen):
    probe = {"jsonrpc": "2.0", "id": 1, "method": "eth_chainId", "params": []}
    request = urllib.request.Request(CHAIN_RPC, data=json.dumps(probe).encode(), headers={"Content-Type": "application/json"}, method="POST")
    with opener(request, timeout=60) as response:
        body = response.read(16385)
    if len(body) > 16384:
        raise ValueError("chain identity response exceeds the membrane bound")
    identity = json.loads(body)
    if not isinstance(identity, dict) or identity.get("jsonrpc") != "2.0" or identity.get("id") != 1 or "error" in identity or not isinstance(identity.get("result"), str) or not HEX_BLOCK.fullmatch(identity["result"]) or int(identity["result"], 16) != CHAIN_ID:
        raise ValueError("SemioticExchange reader RPC chain differs from its canonical configuration")


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
    first_block, last_block = int(first, 16), int(last, 16)
    if first_block < DEPLOYMENT_BLOCK or last_block < first_block:
        raise ValueError("log interval is outside the deployed SemioticExchange history")
    if last_block - first_block + 1 > MAX_BLOCK_WINDOW:
        raise ValueError("SemioticExchange log interval exceeds the existing circulation block-window bound")
    return value


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != CONFIG["membrane"]["path"]:
            return self.reply(404, {"error": "not found"})
        try:
            length = int(self.headers.get("content-length", "0"))
            if length < 1 or length > 16384:
                raise ValueError("bounded JSON body required")
            request = admit_rpc(json.loads(self.rfile.read(length)))
            verify_chain()
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
    host = os.environ.get("SEMIOTIC_EXCHANGE_RPC_HOST", CONFIG["membrane"]["host"])
    port = int(os.environ.get("SEMIOTIC_EXCHANGE_RPC_PORT", str(CONFIG["membrane"]["port"])))
    if host != CONFIG["membrane"]["host"] or port != CONFIG["membrane"]["port"]:
        raise SystemExit("the membrane binds only the cloud machine private address 10.128.0.2:8562")
    verify_chain()
    ThreadingHTTPServer((host, port), Handler).serve_forever()


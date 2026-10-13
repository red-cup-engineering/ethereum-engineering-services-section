import importlib.util
import io
import json
import pathlib
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
path = pathlib.Path(__file__).parents[1] / "scripts" / "serve-semiotic-exchange-rpc.py"
spec = importlib.util.spec_from_file_location("semiotic_exchange_rpc", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class AdmissionTest(unittest.TestCase):
    def test_loads_the_authored_current_chain_binding(self):
        self.assertEqual(module.CHAIN_ID, 5615611)
        self.assertEqual(module.CHAIN_RPC, "http://10.128.0.2:8563")
        self.assertEqual(module.EXCHANGE, "0xc4234dc42c9d93bc7d61b0354aba2729ae52e322")
        self.assertEqual(module.DEPLOYMENT_BLOCK, 70)
        self.assertEqual(module.EVENT_TOPICS, module.CONFIG["eventTopics"])

    def test_refuses_invalid_authored_bindings(self):
        for changes in [
            {"chainId": "5615611"}, {"exchange": "not-an-address"},
            {"deploymentBlock": True}, {"deploymentBlock": -1},
            {"eventTopics": []}, {"eventTopics": ["0x00"]},
            {"chainRpc": "file:///unrelated"},
            {"membrane": {"host": "0.0.0.0", "port": 8562, "path": "/v1/semiotic-exchange/rpc"}},
        ]:
            with self.subTest(changes=changes), tempfile.TemporaryDirectory() as directory:
                path = pathlib.Path(directory) / "configuration.json"
                path.write_text(json.dumps({**module.CONFIG, **changes}))
                with self.assertRaises(ValueError):
                    module.load_configuration(path)

    def test_rpc_identity_refuses_predecessor_chain(self):
        requests = []

        def opener(identity):
            def open_(request, timeout):
                requests.append((request, timeout))
                return io.BytesIO(json.dumps(identity).encode())
            return open_

        module.verify_chain(opener({"jsonrpc": "2.0", "id": 1, "result": hex(5615611)}))
        for identity in [
            {"jsonrpc": "2.0", "id": 1, "result": hex(5615610)},
            {"jsonrpc": "2.0", "id": 2, "result": hex(5615611)},
            {"jsonrpc": "2.0", "id": 1, "error": {"code": -1}},
            {"jsonrpc": "2.0", "id": 1, "result": "5615611"},
        ]:
            with self.subTest(identity=identity), self.assertRaises(ValueError):
                module.verify_chain(opener(identity))
        request, timeout = requests[0]
        self.assertEqual(request.full_url, module.CONFIG["chainRpc"])
        self.assertEqual(json.loads(request.data), {"jsonrpc": "2.0", "id": 1, "method": "eth_chainId", "params": []})
        self.assertEqual(timeout, 60)

    def test_admits_only_head_and_exact_bounded_exchange_logs(self):
        self.assertEqual(module.admit_rpc({"jsonrpc": "2.0", "id": 1, "method": "eth_blockNumber", "params": []})["method"], "eth_blockNumber")
        exact = {"jsonrpc": "2.0", "id": 1, "method": "eth_getLogs", "params": [{
            "address": module.EXCHANGE,
            "fromBlock": hex(module.DEPLOYMENT_BLOCK),
            "toBlock": hex(module.DEPLOYMENT_BLOCK + 1),
            "topics": [module.EVENT_TOPICS],
        }]}
        self.assertEqual(module.admit_rpc(exact), exact)
        for foreign in [
            {**exact, "method": "admin_peers"},
            {**exact, "params": [{**exact["params"][0], "address": "0x" + "00" * 20}]},
            {**exact, "params": [{**exact["params"][0], "fromBlock": "0x1"}]},
            {**exact, "params": [{**exact["params"][0], "topics": []}]},
            {**exact, "params": [{**exact["params"][0], "address": "0x98bbc65824962b61df876a47b5779c4ecbbd4939"}]},
        ]:
            with self.assertRaises(ValueError):
                module.admit_rpc(foreign)


if __name__ == "__main__":
    unittest.main()


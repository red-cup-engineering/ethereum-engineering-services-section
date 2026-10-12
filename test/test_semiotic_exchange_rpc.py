import importlib.util
import pathlib
import sys
import unittest

sys.dont_write_bytecode = True
path = pathlib.Path(__file__).parents[1] / "bin" / "serve-semiotic-exchange-rpc.py"
spec = importlib.util.spec_from_file_location("semiotic_exchange_rpc", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class AdmissionTest(unittest.TestCase):
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
        ]:
            with self.assertRaises(ValueError):
                module.admit_rpc(foreign)


if __name__ == "__main__":
    unittest.main()

import importlib.util
import pathlib
import sys
import unittest

sys.dont_write_bytecode = True
path = pathlib.Path(__file__).parents[1] / "scripts" / "serve-semiotic-exchange-rpc.py"
spec = importlib.util.spec_from_file_location("semiotic_exchange_rpc", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class AdmissionTest(unittest.TestCase):
    def test_chain_identity_and_bounded_block_proof_reads(self):
        chain_id = {"jsonrpc": "2.0", "id": 1, "method": "eth_chainId", "params": []}
        self.assertEqual(module.admit_rpc(chain_id), chain_id)
        self.assertEqual(module.assert_upstream_chain({"jsonrpc": "2.0", "id": 1, "result": hex(module.CHAIN_ID)}), module.CHAIN_ID)
        for bad in [
            {"jsonrpc": "2.0", "id": 1, "result": "0x1"},
            {"jsonrpc": "2.0", "id": 2, "result": hex(module.CHAIN_ID)},
            {"jsonrpc": "2.0", "id": 1, "result": "missing"},
            {"jsonrpc": "2.0", "id": 1, "error": {"code": -1}},
        ]:
            with self.assertRaises(RuntimeError):
                module.assert_upstream_chain(bad)
        for at in ["0x0", hex(module.DEPLOYMENT_BLOCK), hex(module.DEPLOYMENT_BLOCK + 123)]:
            request = {"jsonrpc": "2.0", "id": 1, "method": "eth_getBlockByNumber", "params": [at, False]}
            self.assertEqual(module.admit_rpc(request), request)
            for invalid_params in [[at, True], [at, False, "extra"]]:
                with self.assertRaises(ValueError):
                    module.admit_rpc({**request, "params": invalid_params})
        with self.assertRaises(ValueError):
            module.admit_rpc({"jsonrpc": "2.0", "id": 1, "method": "eth_getBlockByNumber", "params": ["0x1", False]})

    def test_admits_only_head_and_exact_bounded_exchange_logs(self):
        self.assertEqual(module.admit_rpc({"jsonrpc": "2.0", "id": 1, "method": "eth_blockNumber", "params": []})["method"], "eth_blockNumber")
        exact = {"jsonrpc": "2.0", "id": 1, "method": "eth_getLogs", "params": [{
            "address": module.EXCHANGE,
            "fromBlock": hex(module.DEPLOYMENT_BLOCK),
            "toBlock": hex(module.DEPLOYMENT_BLOCK + 1),
            "topics": [module.EVENT_TOPICS],
        }]}
        self.assertEqual(module.admit_rpc(exact), exact)
        self.assertEqual(module.admit_rpc({**exact, "params": [{**exact["params"][0], "toBlock": hex(module.DEPLOYMENT_BLOCK + module.MAX_LOG_BLOCKS - 1)}]} )["method"], "eth_getLogs")
        with self.assertRaises(ValueError):
            module.admit_rpc({**exact, "params": [{**exact["params"][0], "toBlock": hex(module.DEPLOYMENT_BLOCK + module.MAX_LOG_BLOCKS)}]})
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

import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch, Mock
spec = importlib.util.spec_from_file_location("helper", Path(__file__).parents[1] / "native/levik-network.py")
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)

class NetworkTests(unittest.TestCase):
    def test_firewall_blocks_both_families_without_existing_connection_bypass(self):
        rules = helper.firewall_rules(991)
        self.assertIn("table inet levik_vpn", rules)
        self.assertIn("meta skuid 991 accept", rules)
        self.assertIn('oifname "LevikVPN" accept', rules)
        self.assertTrue(rules.endswith("output drop\n"))
        self.assertNotIn("ct state", rules)
        self.assertNotIn("flush ruleset", rules)

    def test_dns_guard_covers_tcp_udp_and_encrypted_dns_ports(self):
        rules = helper.firewall_rules(991, True)
        self.assertIn("udp dport { 53, 853 } drop", rules)
        self.assertIn("tcp dport { 53, 853 } drop", rules)

    def test_rejects_nonlocal_listeners_and_malformed_dns(self):
        config = {"inbounds": [{"protocol": "tun", "settings": {"name": "LevikVPN", "dns": ["1.1.1.1"]}}, {"protocol": "http", "listen": "127.0.0.1"}]}
        self.assertEqual(helper.validate_config(config), "1.1.1.1")
        config["inbounds"][1]["listen"] = "0.0.0.0"
        with self.assertRaises(ValueError): helper.validate_config(config)
        config["inbounds"][1]["listen"] = "127.0.0.1"
        config["inbounds"][0]["settings"]["dns"] = ["1.1.1.1; reboot"]
        with self.assertRaises(ValueError): helper.validate_config(config)

    @patch.object(helper, "run")
    @patch.object(helper, "nft_exists", return_value=True)
    def test_firewall_refresh_is_one_atomic_transaction(self, exists, run):
        network = object.__new__(helper.Network)
        network.account = Mock(pw_uid=991)
        network.save_state = Mock()
        network.firewall(True)
        args, data = run.call_args.args
        self.assertEqual(args, ["nft", "-f", "-"])
        self.assertTrue(data.startswith(b"delete table inet levik_vpn\nadd table"))

    @patch.object(helper, "run", side_effect=RuntimeError("denied"))
    @patch.object(helper, "nft_exists", return_value=True)
    def test_failed_disable_retains_active_state(self, exists, run):
        network = object.__new__(helper.Network)
        network.kill_enabled = True
        with self.assertRaises(RuntimeError): network.firewall(False)
        self.assertTrue(network.kill_enabled)

    def test_unknown_command_rejected(self):
        network = object.__new__(helper.Network)
        with self.assertRaises(ValueError): network.command({"command": "exec", "shell": "id"})

if __name__ == "__main__": unittest.main()

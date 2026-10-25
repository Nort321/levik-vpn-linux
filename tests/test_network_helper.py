import importlib.util
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch, Mock, call
spec = importlib.util.spec_from_file_location("helper", Path(__file__).parents[1] / "native/levik-network.py")
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)

class NetworkTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        state = patch.object(helper, "STATE", Path(self.directory.name))
        state.start()
        self.addCleanup(state.stop)

    def network(self):
        with patch.object(helper, "nft_exists", return_value=False):
            return helper.Network(Mock(pw_uid=991, pw_gid=991))

    @staticmethod
    def config():
        return {"inbounds": [{"protocol": "tun", "settings": {"name": "LevikVPN", "dns": ["1.1.1.1"]}}, {"protocol": "http", "listen": "127.0.0.1"}]}

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

    def test_service_routes_require_authenticated_bounded_ingress(self):
        config = self.config()
        settings = {"accounts": [{"user": "levik-service", "pass": "a" * 48}]}
        config["inbounds"][1].update({"tag": "levik-health", "port": 47186, "settings": settings})
        config["routing"] = {"balancers": [{"tag": "levik-service-main"}]}
        config["api"] = {"tag": "levik-api", "services": ["StatsService", "RoutingService"]}
        config["inbounds"].append({"tag": "levik-service-api-in", "listen": "127.0.0.1", "port": 47187,
                                    "protocol": "http", "settings": settings})
        self.assertEqual(helper.validate_config(config), "1.1.1.1")
        for changed in ({"listen": "0.0.0.0"}, {"port": 80}, {"settings": {}}, {"tag": "unowned-proxy"}):
            candidate = json.loads(json.dumps(config))
            candidate["inbounds"][-1].update(changed)
            with self.assertRaises(ValueError): helper.validate_config(candidate)
        config["api"]["listen"] = "127.0.0.1:47185"
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

    @patch.object(helper.shutil, "which", return_value="/usr/bin/resolvectl")
    @patch.object(helper, "run", return_value=Mock(returncode=0))
    def test_resolved_configures_and_reverts_link(self, run, which):
        network = self.network()
        network.dns_enabled = True
        network.configure_dns("1.1.1.1")
        self.assertEqual(network.dns_backend, "resolved")
        run.assert_has_calls([call(["resolvectl", "dns", helper.TUN, "1.1.1.1"]),
                              call(["resolvectl", "domain", helper.TUN, "~."]),
                              call(["resolvectl", "default-route", helper.TUN, "yes"])])
        network.revert_dns()
        run.assert_called_with(["resolvectl", "revert", helper.TUN], check=False)

    @patch.object(helper.shutil, "which", return_value="/usr/bin/resolvconf")
    @patch.object(helper, "run")
    def test_debian_resolvconf_falls_back_when_resolved_inactive_and_flags_unsupported(self, run, which):
        run.side_effect = [Mock(returncode=1), Mock(returncode=1), Mock(returncode=0)]
        network = self.network()
        network.dns_enabled = True
        network.configure_dns("1.1.1.1")
        run.assert_has_calls([call(["resolvconf", "-a", "tun.LevikVPN", "-m", "0", "-x"], b"nameserver 1.1.1.1\n", check=False),
                              call(["resolvconf", "-a", "tun.LevikVPN"], b"nameserver 1.1.1.1\n")])
        # A replacement helper recovers the same resolver record after a crash.
        replacement = self.network()
        self.assertEqual(replacement.dns_backend, "resolvconf")
        run.side_effect = None
        replacement.revert_dns()
        run.assert_called_with(["resolvconf", "-d", "tun.LevikVPN"])

    @patch.object(helper.shutil, "which", side_effect=lambda name: None if name == "resolvectl" else "/sbin/resolvconf")
    @patch.object(helper, "run", return_value=Mock(returncode=0))
    def test_openresolv_preserves_exclusive_dns(self, run, which):
        network = self.network()
        network.dns_enabled = True
        network.configure_dns("1.1.1.1")
        run.assert_called_once_with(["resolvconf", "-a", "tun.LevikVPN", "-m", "0", "-x"], b"nameserver 1.1.1.1\n", check=False)

    @patch.object(helper.shutil, "which", return_value=None)
    def test_missing_resolver_is_actionable_and_disabled_dns_needs_no_tools(self, which):
        network = self.network()
        network.configure_dns("1.1.1.1")
        which.assert_not_called()
        network.dns_enabled = True
        with self.assertRaisesRegex(ValueError, "Install systemd-resolved, openresolv or resolvconf"):
            network.configure_dns("1.1.1.1")

    @patch.object(helper, "run")
    def test_legacy_resolver_record_is_removed(self, run):
        (helper.STATE / "state.json").write_text(json.dumps({"dnsBackend": "resolvconf"}))
        self.network().revert_dns()
        run.assert_called_once_with(["resolvconf", "-d", helper.TUN])

    @patch.object(helper.ctypes, "CDLL")
    @patch.object(helper.os, "getppid", return_value=123)
    @patch.object(helper.os, "_exit")
    def test_parent_death_signal_and_fork_race(self, exit_child, getppid, cdll):
        cdll.return_value.prctl.return_value = 0
        helper.parent_death_signal(123)
        cdll.return_value.prctl.assert_called_with(1, signal.SIGKILL, 0, 0, 0)
        exit_child.assert_not_called()
        helper.parent_death_signal(124)
        exit_child.assert_called_once_with(1)

    @patch.object(helper.ctypes, "CDLL")
    def test_parent_death_setup_failure_prevents_launch(self, cdll):
        cdll.return_value.prctl.return_value = -1
        with self.assertRaises(OSError): helper.parent_death_signal(123)

    @patch.object(helper, "process_start_time", return_value="100")
    @patch.object(helper, "interface_exists", return_value=True)
    @patch.object(helper.subprocess, "run", return_value=Mock(returncode=0))
    @patch.object(helper.subprocess, "Popen")
    def test_core_identity_precedes_config_and_stop_removes_it(self, popen, run, exists, start_time):
        core = popen.return_value
        core.pid = 4321
        core.poll.return_value = None
        def check_identity(data):
            saved = json.loads((helper.STATE / "core.json").read_text())
            self.assertEqual(saved, {"pid": 4321, "startTime": "100", "uid": 991})
            self.assertEqual((helper.STATE / "core.json").stat().st_mode & 0o777, 0o600)
        core.stdin.write.side_effect = check_identity
        network = self.network()
        network.start(self.config())
        for invocation in (popen.call_args, run.call_args):
            self.assertIn("--pdeathsig=SIGKILL", invocation.args[0])
            self.assertIn(helper.CORE_EXEC, invocation.args[0])
            self.assertEqual(invocation.kwargs["preexec_fn"].func, helper.parent_death_signal)
            self.assertEqual(invocation.kwargs["preexec_fn"].args, (os.getpid(),))
        network.stop()
        core.terminate.assert_called_once()
        self.assertFalse((helper.STATE / "core.json").exists())

    @patch.object(helper, "process_start_time", side_effect=OSError("gone"))
    @patch.object(helper.subprocess, "run", return_value=Mock(returncode=0))
    @patch.object(helper.subprocess, "Popen")
    def test_identity_write_failure_stops_core_before_configuration(self, popen, run, start_time):
        network = self.network()
        with self.assertRaises(OSError): network.start(self.config())
        popen.return_value.stdin.write.assert_not_called()
        popen.return_value.terminate.assert_called_once()

    @patch.object(helper.os, "pidfd_open", create=True, side_effect=ProcessLookupError)
    def test_recovery_removes_dead_core_record(self, pidfd_open):
        path = helper.STATE / "core.json"
        path.write_text(json.dumps({"pid": 4321, "startTime": "100", "uid": 991}))
        helper.recover_core()
        self.assertFalse(path.exists())

    def test_recovery_rejects_invalid_pid(self):
        (helper.STATE / "core.json").write_text(json.dumps({"pid": -1, "startTime": "100", "uid": 991}))
        with self.assertRaisesRegex(ValueError, "Invalid saved VPN core identity"):
            helper.recover_core()


@unittest.skipUnless(sys.platform == "linux", "requires Linux prctl and procfs")
class LifetimeTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        state = patch.object(helper, "STATE", Path(self.directory.name))
        state.start()
        self.addCleanup(state.stop)

    def test_sigkill_parent_kills_child_after_exec(self):
        self.check_parent_death(False)

    @unittest.skipUnless(sys.platform == "linux" and os.geteuid() == 0, "requires root to test setpriv UID change")
    def test_sigkill_parent_kills_child_after_setpriv_uid_change(self):
        self.check_parent_death(True)

    def check_parent_death(self, drop_uid):
        source = '''
import importlib.util, os, subprocess, sys, time
from functools import partial
spec = importlib.util.spec_from_file_location("helper", sys.argv[1])
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
prefix = []
if sys.argv[2] == "True":
    prefix = ["setpriv", "--reuid=65534", "--regid=65534", "--clear-groups", "--pdeathsig=SIGKILL"]
child = subprocess.Popen(prefix + [sys.executable, "-I", "-c", helper.CORE_EXEC, str(os.getpid()), sys.executable, "-I", "-c", "import time; print('ready', flush=True); time.sleep(60)"], preexec_fn=partial(helper.parent_death_signal, os.getpid()))
print(child.pid, flush=True)
time.sleep(60)
'''
        parent = subprocess.Popen([sys.executable, "-c", source, helper.__file__, str(drop_uid)], stdout=subprocess.PIPE, text=True)
        child_pid = None
        try:
            # Either process may print first; readiness means exec and any UID
            # change have finished before the parent is killed.
            lines = [parent.stdout.readline().strip(), parent.stdout.readline().strip()]
            self.assertIn("ready", lines)
            child_pid = int(next(line for line in lines if line != "ready"))
            descriptor = os.pidfd_open(child_pid)
            try:
                parent.kill()
                parent.wait(timeout=5)
                with helper.selectors.DefaultSelector() as selector:
                    selector.register(descriptor, helper.selectors.EVENT_READ)
                    self.assertTrue(selector.select(5), "core survived SIGKILL of its helper")
            finally:
                os.close(descriptor)
        finally:
            if parent.poll() is None:
                parent.kill()
                parent.wait(timeout=5)
            parent.stdout.close()
            if child_pid:
                try: os.kill(child_pid, signal.SIGKILL)
                except ProcessLookupError: pass

    def test_recovery_kills_matching_orphan_but_not_reused_pid(self):
        with patch.object(helper, "CORE", Path(self.directory.name) / "core"):
            helper.CORE.mkdir()
            shutil.copyfile("/bin/sleep", helper.CORE / "xray")
            (helper.CORE / "xray").chmod(0o755)
            child = subprocess.Popen([str(helper.CORE / "xray"), "60"])
            try:
                saved = {"pid": child.pid, "startTime": "stale", "uid": os.geteuid()}
                path = helper.STATE / "core.json"
                path.write_text(json.dumps(saved))
                helper.recover_core()
                self.assertIsNone(child.poll(), "recycled PID must not be signaled")
                saved["startTime"] = helper.process_start_time(child.pid)
                path.write_text(json.dumps(saved))
                helper.recover_core()
                self.assertEqual(child.wait(timeout=5), -signal.SIGKILL)
                self.assertFalse(path.exists())
            finally:
                if child.poll() is None:
                    child.kill()
                    child.wait(timeout=5)

    def test_recovery_does_not_signal_unrelated_executable(self):
        child = subprocess.Popen(["/bin/sleep", "60"])
        try:
            (helper.STATE / "core.json").write_text(json.dumps({"pid": child.pid, "startTime": helper.process_start_time(child.pid), "uid": os.geteuid()}))
            helper.recover_core()
            self.assertIsNone(child.poll())
        finally:
            child.kill()
            child.wait(timeout=5)

if __name__ == "__main__": unittest.main()

"""Exercise rendered maintainer scripts against a disposable filesystem."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class DebianHookTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.bin = self.root / "commands"
        self.bin.mkdir()
        self.log = self.root / "calls"
        self.app = self.root / "opt/Levik VPN"
        (self.app / "resources/xray").mkdir(parents=True)
        (self.app / "chrome-sandbox").touch()
        (self.app / "resources/xray/xray").touch()
        (self.app / "resources/apparmor-profile").write_text("test-profile")
        (self.root / "etc/apparmor.d").mkdir(parents=True)
        (self.root / "usr/bin").mkdir(parents=True)
        for name in ("update-alternatives", "update-mime-database", "update-desktop-database",
                     "apparmor_status", "apparmor_parser", "getent", "useradd", "chown", "setcap"):
            self.command(name)
        self.command("unshare", 1)

    def command(self, name, status=0):
        path = self.bin / name
        path.write_text('#!/bin/sh\nprintf "%s\\n" "' + name + ' $*" >> "$HOOK_LOG"\nexit ' + str(status) + '\n')
        path.chmod(0o755)

    def run_hook(self, hook, argument):
        source = (ROOT / "build" / hook).read_text()
        source = source.replace("${executable}", "levik-vpn").replace("${sanitizedProductName}", "Levik VPN")
        # Every absolute installation path points inside the disposable root.
        for prefix in ("/opt/", "/usr/", "/etc/"):
            source = source.replace(prefix, str(self.root) + prefix)
        script = self.root / hook
        script.write_text(source)
        subprocess.run(["/bin/bash", str(script), argument], check=True, capture_output=True,
                       env={**os.environ, "PATH": str(self.bin) + ":/usr/bin:/bin", "HOOK_LOG": str(self.log)})

    def test_install_restores_sandbox_apparmor_desktop_and_core_setup(self):
        self.run_hook("after-install.sh", "configure")
        self.assertEqual((self.app / "chrome-sandbox").stat().st_mode & 0o7777, 0o4755)
        self.assertEqual((self.app / "resources/xray/xray").stat().st_mode & 0o777, 0o750)
        self.assertEqual((self.root / "etc/apparmor.d/levik-vpn").read_text(), "test-profile")
        log = self.log.read_text()
        self.assertIn("apparmor_parser --replace --write-cache --skip-read-cache", log)
        self.assertIn("setcap cap_net_admin,cap_net_raw=eip", log)
        self.assertIn("update-alternatives --install", log)
        self.assertIn("update-mime-database", log)

    def test_unsupported_apparmor_skips_profile(self):
        self.command("apparmor_parser", 1)
        self.run_hook("after-install.sh", "configure")
        self.assertFalse((self.root / "etc/apparmor.d/levik-vpn").exists())
        self.assertNotIn("apparmor_parser --replace", self.log.read_text())

    def test_remove_unloads_profile_before_removing_file(self):
        self.run_hook("after-install.sh", "configure")
        self.run_hook("after-remove.sh", "remove")
        self.assertFalse((self.root / "etc/apparmor.d/levik-vpn").exists())
        log = self.log.read_text()
        self.assertIn("apparmor_parser --remove", log)
        self.assertIn("update-alternatives --remove levik-vpn " + str(self.app / "levik-vpn"), log)

    def test_upgrade_retains_replacement_profile_and_capabilities(self):
        self.run_hook("after-install.sh", "configure")
        before = self.log.read_text()
        self.run_hook("after-remove.sh", "upgrade")
        self.assertTrue((self.root / "etc/apparmor.d/levik-vpn").exists())
        self.assertEqual(self.log.read_text(), before)

    def test_debian_declares_resolver_alternatives_and_hooks(self):
        deb = json.loads((ROOT / "package.json").read_text())["build"]["deb"]
        self.assertIn("systemd-resolved | openresolv | resolvconf", deb["depends"])
        self.assertEqual(deb["afterInstall"], "build/after-install.sh")
        self.assertEqual(deb["afterRemove"], "build/after-remove.sh")


if __name__ == "__main__":
    unittest.main()

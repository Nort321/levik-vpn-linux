#!/usr/bin/env python3
"""CI only: sudo unshare --net python3 scripts/linux-smoke.py."""
import importlib.util
import os
from pathlib import Path
import socket
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("helper", ROOT / "native/levik-network.py")
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
if os.geteuid() != 0 or os.readlink("/proc/self/ns/net") == os.readlink("/proc/1/ns/net"):
    raise SystemExit("This test requires root inside a separate network namespace")
helper.run(["ip", "link", "set", "lo", "up"])
helper.run(["ip", "link", "add", "eth0", "type", "dummy"])
helper.run(["ip", "addr", "add", "192.0.2.2/24", "dev", "eth0"])
helper.run(["ip", "-6", "addr", "add", "2001:db8::2/64", "dev", "eth0", "nodad"])
helper.run(["ip", "link", "set", "eth0", "up"])
helper.run(["ip", "route", "add", "default", "dev", "eth0"])
helper.run(["ip", "-6", "route", "add", "default", "dev", "eth0"])
helper.STATE.mkdir(parents=True, exist_ok=True)
network = helper.Network(helper.install_core(ROOT / "vendor/xray/linux-x64"))
config = {
    "log": {"loglevel": "none"},
    "dns": {"tag": "levik-dns", "servers": [{"address": "https+local://1.1.1.1/dns-query", "domains": ["full:example.com"], "skipFallback": True, "finalQuery": True}, "https://1.1.1.1/dns-query"]},
    "api": {"tag": "levik-api", "listen": "127.0.0.1:47185", "services": ["StatsService"]},
    "inbounds": [
        {"tag": "levik-tun-in", "protocol": "tun", "settings": {
            "name": "LevikVPN", "mtu": 1500, "gateway": ["10.89.0.1/30", "fdfe:89::1/126"], "dns": ["1.1.1.1"],
            "autoSystemRoutingTable": ["0.0.0.0/1", "128.0.0.0/1", "::/1", "8000::/1"], "autoOutboundsInterface": "eth0"}},
        {"tag": "levik-health", "listen": "127.0.0.1", "port": 47186, "protocol": "http", "settings": {}}],
    "outbounds": [{"protocol": "blackhole", "tag": "blocked", "settings": {}}],
    "policy": {"system": {"statsInboundDownlink": True, "statsInboundUplink": True}}, "stats": {}}

def assert_blocked():
    for family, address in [(socket.AF_INET, "198.51.100.1"), (socket.AF_INET6, "2001:db8:1::1")]:
        with socket.socket(family, socket.SOCK_DGRAM) as client:
            client.settimeout(1)
            try:
                client.sendto(b"leak-test", (address, 443))
            except PermissionError:
                continue
            raise AssertionError(f"Kill switch did not reject {address}")
try:
    network.firewall(True)
    assert_blocked()
    network.start(config)
    assert helper.interface_exists()
    assert "LevikVPN" in helper.run(["ip", "route", "get", "198.51.100.1"]).stdout.decode()
    assert isinstance(network.command({"command": "stats"}), str)
    network.core.kill()
    network.core.wait(timeout=5)
    network.stop()
    assert helper.nft_exists(helper.TABLE)
    assert_blocked()
    network.firewall(False)
    assert not helper.nft_exists(helper.TABLE)
    print("Linux integration passed: Xray TUN, stats, IPv4/IPv6 kill switch, crash retention, cleanup")
finally:
    network.stop()
    network.firewall(False)
    network.firewall(False, True)

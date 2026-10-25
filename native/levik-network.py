#!/usr/bin/python3
"""Authenticated stdio helper. No shell, socket listener, or passwordless policy."""
import ctypes
import fcntl
from functools import partial
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import pwd
import re
import selectors
import shutil
import signal
import stat
import subprocess
import sys
import time

TUN = "LevikVPN"
TABLE = "levik_vpn"
DNS_TABLE = "levik_dns"
STATE = Path("/run/levik-vpn")
CORE = Path("/var/lib/levik-vpn/core")
ACCOUNT = "levik-vpn-core"
SAFE_ENV = {"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C"}
# setpriv restores PDEATHSIG after changing credentials. Check the parent again
# after that transition to close the interval during which Linux clears it.
CORE_EXEC = "import os,sys; os.getppid() == int(sys.argv[1]) or sys.exit(1); os.execv(sys.argv[2], sys.argv[2:])"


def parent_death_signal(parent_pid):
    # The helper is single-threaded, so a preexec_fn is safe here.
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(1, signal.SIGKILL, 0, 0, 0) != 0:  # PR_SET_PDEATHSIG
        raise OSError(ctypes.get_errno(), "Unable to bind VPN core lifetime")
    if os.getppid() != parent_pid:
        os._exit(1)


def process_start_time(pid):
    # comm can contain spaces and parentheses; field 22 follows its final ')'.
    return (Path("/proc") / str(pid) / "stat").read_text().rsplit(")", 1)[1].split()[19]


def recover_core():
    """Called under the helper lock, before replacing core files or networking."""
    path = STATE / "core.json"
    try:
        saved = json.loads(path.read_text())
    except FileNotFoundError:
        return
    if (not isinstance(saved, dict) or type(saved.get("pid")) is not int
            or saved["pid"] <= 1 or not isinstance(saved.get("startTime"), str)
            or type(saved.get("uid")) is not int):
        raise ValueError("Invalid saved VPN core identity")
    pid = saved["pid"]
    try:
        # Open before checking identity: signals must never hit a recycled PID.
        descriptor = os.pidfd_open(pid)
    except ProcessLookupError:
        path.unlink()
        return
    try:
        try:
            proc = Path("/proc") / str(pid)
            matches = (process_start_time(pid) == saved["startTime"]
                       and proc.stat().st_uid == saved["uid"]
                       and os.readlink(proc / "exe") in (str(CORE / "xray"), str(CORE / "xray") + " (deleted)"))
        except (FileNotFoundError, ProcessLookupError):
            matches = False
        if matches:
            try:
                signal.pidfd_send_signal(descriptor, signal.SIGKILL)
            except ProcessLookupError:
                pass
            with selectors.DefaultSelector() as selector:
                selector.register(descriptor, selectors.EVENT_READ)
                if not selector.select(5):
                    raise ValueError("Unable to stop previous VPN core")
    finally:
        os.close(descriptor)
    path.unlink()


def run(args, data=None, check=True):
    return subprocess.run(args, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          timeout=15, check=check, env=SAFE_ENV)


def interface_exists():
    return run(["ip", "link", "show", "dev", TUN], check=False).returncode == 0


def nft_exists(table):
    return run(["nft", "list", "table", "inet", table], check=False).returncode == 0


def firewall_rules(uid, dns_only=False):
    table = DNS_TABLE if dns_only else TABLE
    # No established-connection exemption: pre-existing TCP/UDP must also stop.
    rules = [f"add table inet {table}",
             f"add chain inet {table} output {{ type filter hook output priority -10; policy accept; }}",
             f'add rule inet {table} output oifname "lo" accept',
             f'add rule inet {table} output oifname "{TUN}" accept']
    if dns_only:
        # Xray's own DNS is routed through its selected VPN outbound.
        rules += [f"add rule inet {table} output meta skuid {uid} accept",
                  f"add rule inet {table} output udp dport {{ 53, 853 }} drop",
                  f"add rule inet {table} output tcp dport {{ 53, 853 }} drop"]
    else:
        rules += [f"add rule inet {table} output meta skuid {uid} accept",
                  f"add rule inet {table} output udp sport 68 udp dport 67 accept",
                  f"add rule inet {table} output udp sport 546 udp dport 547 accept",
                  f"add rule inet {table} output icmpv6 type {{ nd-neighbor-solicit, nd-neighbor-advert, nd-router-solicit, nd-router-advert }} ip6 hoplimit 255 accept",
                  f"add rule inet {table} output drop"]
    return "\n".join(rules) + "\n"


def validate_config(config):
    if not isinstance(config, dict) or len(json.dumps(config)) > 2_000_000:
        raise ValueError("Invalid VPN profile")
    inbounds = config.get("inbounds")
    routing = config.get("routing", {})
    service_routes = any(isinstance(item, dict) and item.get("tag") == "levik-service-main"
                         for item in routing.get("balancers", [])) if isinstance(routing, dict) else False
    if service_routes:
        api = config.get("api", {})
        if not isinstance(api, dict) or api.get("tag") != "levik-api" or "listen" in api or set(api.get("services", [])) != {"StatsService", "RoutingService"}:
            raise ValueError("Service API must use authenticated local ingress")
    if not isinstance(inbounds, list) or not (2 <= len(inbounds) <= 35 if service_routes else len(inbounds) == 2):
        raise ValueError("Invalid VPN listeners")
    tun = next((item for item in inbounds if item.get("protocol") == "tun"), None)
    if not tun or tun.get("settings", {}).get("name") != TUN:
        raise ValueError("Invalid VPN interface")
    ports = set()
    for item in inbounds:
        if not isinstance(item, dict):
            raise ValueError("Invalid VPN listener")
        if item is not tun and (item.get("listen") != "127.0.0.1" or item.get("protocol") != "http"):
            raise ValueError("VPN listeners must be local")
        if service_routes and item is not tun:
            tag = item.get("tag", "")
            port = item.get("port")
            valid_port = isinstance(port, int) and ((tag == "levik-service-api-in" and port == 47187) or
                         (tag == "levik-health" and port == 47186) or
                         (re.fullmatch(r"levik-service-endpoint-[0-9]{1,2}-probe", tag) and 47200 <= port <= 47231))
            settings = item.get("settings", {})
            accounts = settings.get("accounts", []) if isinstance(settings, dict) else []
            if not valid_port or port in ports or not isinstance(accounts, list) or len(accounts) != 1 or not isinstance(accounts[0], dict) or accounts[0].get("user") != "levik-service" or not re.fullmatch(r"[0-9a-f]{48}", str(accounts[0].get("pass", ""))):
                raise ValueError("Invalid service route listener")
            ports.add(port)
    dns = tun["settings"].get("dns", ["1.1.1.1"])
    if not isinstance(dns, list) or len(dns) != 1:
        raise ValueError("Invalid DNS server")
    ipaddress.ip_address(dns[0])
    return dns[0]


def install_core(source):
    # Copy only pinned bytes into a root-owned directory. AppImages are mounted
    # for the desktop user and cannot be executed directly by our service UID.
    manifest = json.loads(Path(__file__).with_name("xray-integrity.json").read_text())
    CORE.mkdir(parents=True, exist_ok=True, mode=0o755)
    for name in ("xray", "geoip.dat", "geosite.dat"):
        destination = CORE / name
        expected = manifest[name]
        if destination.exists() and hashlib.sha256(destination.read_bytes()).hexdigest() == expected:
            continue
        with open(source / name, "rb") as handle:
            if not stat.S_ISREG(os.fstat(handle.fileno()).st_mode):
                raise ValueError("Invalid Xray resource")
            data = handle.read(100_000_001)
        if len(data) > 100_000_000 or hashlib.sha256(data).hexdigest() != expected:
            raise ValueError("Xray integrity verification failed; reinstall Levik VPN")
        temporary = CORE / (name + ".new")
        temporary.write_bytes(data)
        temporary.chmod(0o755 if name == "xray" else 0o644)
        temporary.replace(destination)
    try:
        account = pwd.getpwnam(ACCOUNT)
    except KeyError:
        run(["useradd", "--system", "--user-group", "--no-create-home", "--shell", "/usr/sbin/nologin", ACCOUNT])
        account = pwd.getpwnam(ACCOUNT)
    if account.pw_uid == 0 or account.pw_shell not in ("/usr/sbin/nologin", "/sbin/nologin", "/bin/false"):
        raise ValueError("Invalid VPN service account")
    return account


class Network:
    def __init__(self, account):
        self.account = account
        self.core = None
        self.dns_enabled = nft_exists(DNS_TABLE)
        try:
            saved = json.loads((STATE / "state.json").read_text())
            self.dns_backend = saved.get("dnsBackend") if saved.get("dnsBackend") in ("resolved", "resolvconf") else None
            self.dns_interface = saved.get("dnsInterface") if saved.get("dnsInterface") == "tun." + TUN else TUN
        except (FileNotFoundError, ValueError):
            self.dns_backend = None
            self.dns_interface = TUN
        self.kill_enabled = nft_exists(TABLE)
        self.save_state()

    def save_state(self):
        temporary = STATE / "state.tmp"
        temporary.write_text(json.dumps({"killSwitch": self.kill_enabled, "dnsProtection": self.dns_enabled, "dnsBackend": self.dns_backend, "dnsInterface": self.dns_interface}))
        temporary.chmod(0o644)
        temporary.replace(STATE / "state.json")

    def firewall(self, enable, dns_only=False):
        table = DNS_TABLE if dns_only else TABLE
        exists = nft_exists(table)
        if enable:
            script = (f"delete table inet {table}\n" if exists else "") + firewall_rules(self.account.pw_uid, dns_only)
            # nft -f commits delete + recreation atomically, without a leak window.
            run(["nft", "-f", "-"], script.encode())
        elif exists:
            run(["nft", "delete", "table", "inet", table])
        if dns_only:
            self.dns_enabled = enable
        else:
            self.kill_enabled = enable
        self.save_state()

    def configure_dns(self, address):
        if not self.dns_enabled:
            return
        if shutil.which("resolvectl") and run(["resolvectl", "status"], check=False).returncode == 0:
            self.dns_backend = "resolved"
            self.save_state()
            run(["resolvectl", "dns", TUN, address])
            run(["resolvectl", "domain", TUN, "~."])
            run(["resolvectl", "default-route", TUN, "yes"])
            run(["resolvectl", "flush-caches"])
        elif shutil.which("resolvconf"):
            self.dns_backend = "resolvconf"
            # Debian resolvconf orders tun* ahead of physical links and does not
            # implement openresolv's metric/exclusive flags. Both accept -a/-d.
            self.dns_interface = "tun." + TUN
            self.save_state()
            data = f"nameserver {address}\n".encode()
            result = run(["resolvconf", "-a", self.dns_interface, "-m", "0", "-x"], data, check=False)
            if result.returncode:
                run(["resolvconf", "-a", self.dns_interface], data)
        else:
            raise ValueError("Install systemd-resolved, openresolv or resolvconf for DNS protection")

    def revert_dns(self):
        if self.dns_backend == "resolved":
            # A dead TUN automatically removes its per-link resolved settings.
            result = run(["resolvectl", "revert", TUN], check=False)
            if result.returncode and interface_exists():
                raise ValueError("Unable to restore DNS settings")
        if self.dns_backend == "resolvconf":
            run(["resolvconf", "-d", self.dns_interface])
        self.dns_backend = None
        self.save_state()

    def stop(self):
        try:
            self.revert_dns()
        finally:
            if self.core:
                self.core.terminate()
                try:
                    self.core.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    self.core.kill()
                    self.core.wait(timeout=5)
                self.core = None
                (STATE / "core.json").unlink(missing_ok=True)

    def start(self, config):
        address = validate_config(config)
        self.stop()
        account = self.account
        # Only the pinned core gets network capabilities, never Electron or a
        # user-selected binary. setpriv drops root and all supplementary groups.
        process_rules = any(rule.get("process") for rule in config.get("routing", {}).get("rules", []))
        caps = "+net_admin,+net_raw" + (",+sys_ptrace,+dac_read_search" if process_rules else "")
        prefix = ["setpriv", f"--reuid={account.pw_uid}", f"--regid={account.pw_gid}",
                  "--clear-groups", "--pdeathsig=SIGKILL", f"--inh-caps={caps}",
                  f"--ambient-caps={caps}", f"--bounding-set=-all,{caps}",
                  sys.executable, "-I", "-c", CORE_EXEC, str(os.getpid()),
                  str(CORE / "xray")]
        data = json.dumps(config).encode()
        env = {**SAFE_ENV, "XRAY_LOCATION_ASSET": str(CORE)}
        validation = subprocess.run(prefix + ["run", "-test", "-format", "json", "-config", "stdin:"],
                                    input=data, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env, timeout=15,
                                    preexec_fn=partial(parent_death_signal, os.getpid()))
        if validation.returncode:
            raise ValueError("VPN core rejected the profile")
        self.core = subprocess.Popen(prefix + ["run", "-format", "json", "-config", "stdin:"],
                                     stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env,
                                     preexec_fn=partial(parent_death_signal, os.getpid()))
        try:
            # Record before delivering the profile, so no active core can escape
            # recovery even if the helper dies during startup.
            temporary = STATE / "core.tmp"
            temporary.write_text(json.dumps({"pid": self.core.pid, "startTime": process_start_time(self.core.pid), "uid": account.pw_uid}))
            temporary.chmod(0o600)
            temporary.replace(STATE / "core.json")
            self.core.stdin.write(data)
            self.core.stdin.close()
            for _ in range(60):
                if self.core.poll() is not None:
                    raise ValueError("VPN core exited during startup")
                if interface_exists():
                    self.configure_dns(address)
                    return
                time.sleep(0.1)
            raise ValueError("VPN interface was not created")
        except Exception:
            self.stop()
            raise

    def command(self, message):
        command = message.get("command")
        if command == "start": self.start(message.get("config"))
        elif command == "stop": self.stop()
        elif command == "stats":
            if not self.core or self.core.poll() is not None:
                raise ValueError("VPN core is not running")
            return run(["setpriv", f"--reuid={self.account.pw_uid}", f"--regid={self.account.pw_gid}", "--clear-groups",
                        str(CORE / "xray"), "api", "statsquery", "--server=127.0.0.1:47185", "-pattern", "inbound>>>levik-tun-in>>>"]).stdout.decode()
        elif command == "kill-enable": self.firewall(True)
        elif command == "kill-disable": self.firewall(False)
        elif command == "kill-status": return nft_exists(TABLE)
        elif command == "dns-enable": self.firewall(True, True)
        elif command == "dns-disable":
            self.revert_dns()
            self.firewall(False, True)
        else: raise ValueError("Unknown network operation")
        return True


def main():
    if os.geteuid() != 0 or not os.environ.get("PKEXEC_UID"):
        raise SystemExit("Use pkexec to authorize the network helper")
    os.umask(0o022)
    STATE.mkdir(mode=0o755, exist_ok=True)
    lock = open(STATE / "lock", "w")
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    recover_core()
    network = Network(install_core(Path(sys.argv[1])))
    def shutdown(_signum, _frame):
        raise SystemExit(0)
    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    # A raw buffer avoids TextIO readline read-ahead starving pipelined requests.
    selector = selectors.DefaultSelector()
    selector.register(sys.stdin.buffer, selectors.EVENT_READ)
    buffer = b""
    try:
        while True:
            if network.core and network.core.poll() is not None:
                code = network.core.returncode
                network.stop()
                print(json.dumps({"event": "exit", "code": code}), flush=True)
            if not selector.select(0.5):
                continue
            chunk = os.read(sys.stdin.fileno(), 65536)
            if not chunk: break
            buffer += chunk
            if len(buffer) > 2_100_000: break
            while b"\n" in buffer:
                line, buffer = buffer.split(b"\n", 1)
                request = {}
                try:
                    request = json.loads(line)
                    if not isinstance(request, dict) or type(request.get("id")) is not int:
                        raise ValueError("Invalid network request")
                    result = network.command(request)
                    reply = {"id": request["id"], "ok": True, "result": result}
                except Exception as error:
                    # Only our explicit validation errors are safe for the GUI.
                    detail = str(error) if isinstance(error, ValueError) else "Network operation failed; check required Linux packages and permissions"
                    reply = {"id": request.get("id") if isinstance(request, dict) else None, "ok": False, "error": detail}
                print(json.dumps(reply), flush=True)
    finally:
        network.stop()
        # Keep nftables tables on GUI/helper loss. Explicit disconnect removes
        # protection; reconnect and sudo nft delete table are recovery options.


if __name__ == "__main__":
    main()

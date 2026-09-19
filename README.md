# Levik VPN for Linux

Official Linux desktop client, adapted from the Levik VPN Windows client. Electron 44, strict TypeScript, esbuild, electron-updater and the official Xray-core **v26.7.28** Linux x64 binary. Licensed **AGPL-3.0-only**.

## Install

Download `LevikVPN-Linux-x64.AppImage` or `LevikVPN-Linux-x64.deb` and `SHA256SUMS.txt` from [GitHub Releases](https://github.com/Nort321/levik-vpn-linux/releases/latest). Verify the versioned file against the checksum list before installing:

```sh
sha256sum --check SHA256SUMS.txt --ignore-missing
sudo apt install ./LevikVPN-Linux-x64.deb
# Or, for the portable build:
chmod +x LevikVPN-Linux-x64.AppImage
./LevikVPN-Linux-x64.AppImage
```

The repository starts private. Releases require repository access until the owner makes it public; anonymous downloads and the default OTA feed become available after that change. No GitHub token is included in the application.

Linux x64 is supported. The Debian package installs required dependencies. For AppImage, install Python 3, `pkexec`, a desktop polkit authentication agent, `nftables`, `iproute2`, `util-linux` (`setpriv`), `passwd` (`useradd`), and **systemd-resolved or openresolv**. Desktop requirements include GTK 3, NSS, a working **GNOME Keyring or KWallet**, and the libraries required by Electron. Some distributions require FUSE 2 for AppImages, or support extracting an AppImage with `--appimage-extract`. A usable `/dev/net/tun` and kernel TUN/nftables support are required. Containers must grant the corresponding kernel capabilities; they are not the primary desktop target.

Launch Levik VPN as your ordinary desktop user. Sign in with Levik Account, select a subscription and server, then Connect. The desktop polkit agent requests administrator authorization for the network helper once per application session. Never run Electron with sudo or disable its sandbox.

## Keyboard and accessibility

All buttons, server selection/favorites, settings switches, dropdowns, searches and modal actions use native keyboard controls. Tab and Shift+Tab traverse them; Enter/Space activates buttons and switches. Native selects retain their standard platform keyboard behavior.

| Shortcut | Action |
| --- | --- |
| Ctrl+1 / Ctrl+2 / Ctrl+3 / Ctrl+4 | Home / Servers / Statistics / Profile |
| `/` | Open server search; focus process search inside its dialog |
| Up / Down / Home / End | Navigate server, process, device or navigation lists |
| Enter / Space | Activate focused control; toggle connection on Home when focus is outside controls |
| Escape | Close process/device dialog |
| Tab / Shift+Tab in a dialog | Cycle inside the dialog |

Dialogs make the underlying page inert and return focus to their trigger when dismissed. All themes, including AMOLED, have a visible three-pixel focus ring. Keyed DOM updates preserve focused control identity, unfinished input, caret position and scroll during snapshots; changing data does not replace the whole application DOM. Reduced-motion preferences are respected.

## Network architecture

* The sandboxed renderer uses a narrow context-isolated preload bridge. Account signing, secure storage, profile decryption and networking remain in the main process. Renderer snapshots expose protocol labels, not outbound credentials.
* `ip -j route` chooses the lowest-metric active non-tunnel uplink, with IPv6 and `/proc/net/route` fallbacks. Xray owns a `LevikVPN` TUN with IPv4/IPv6 half-default routes, and binds its own outbounds to the physical uplink to prevent loops.
* A Python helper is authorized through **pkexec** and communicates over private inherited stdin/stdout. There is no root Electron, shell interpolation, public command socket or passwordless polkit rule. The helper accepts fixed operations and checks listener/interface/DNS inputs.
* The helper verifies pinned hashes and copies Xray/geodata to root-owned `/var/lib/levik-vpn/core`, including when launched from an AppImage mount. It starts Xray under the dedicated `levik-vpn-core` service account with `CAP_NET_ADMIN` and `CAP_NET_RAW`. Process-based split tunneling additionally needs `CAP_SYS_PTRACE` and `CAP_DAC_READ_SEARCH` for cross-user procfs discovery; these are granted only to the pinned core when process rules are configured. The GUI receives no capabilities. Debian post-install also sets network capabilities on the restricted packaged core; `setpriv` ambient capabilities provide the portable fallback.
* The `inet levik_vpn` nftables table blocks IPv4 and IPv6 outside the tunnel, except loopback, the dedicated core UID, DHCP and link-local IPv6 neighbor discovery. Existing connections do not bypass it. Intentional split/domain direct routes are performed by Xray; the kill switch prevents traffic from escaping outside that managed path.
* DNS protection installs a separate `inet levik_dns` guard for physical TCP/UDP ports 53 and 853, configures the TUN resolver using `resolvectl` (`~.`) or exclusive `resolvconf`, and prioritizes DNS routing through the selected VPN before process bypass rules. Xray's built-in DNS is also tagged for VPN routing. VPN endpoint hostnames alone use a direct encrypted DoH bootstrap at `https+local://1.1.1.1/dns-query`; `ForceIP` avoids falling back to the blocked system resolver. Bootstrap does not resolve general application domains. User-managed DoH applications use their selected application route; the guard does not claim to identify every HTTPS DNS service.
* Linux process rules use exact executable basenames and preserve case. No Windows `.exe` requirement or game companion expansion is applied. Procfs process enumeration is restricted to the desktop user's processes. Distribution procfs restrictions can affect process detection.

## Failure handling and recovery

Xray failure triggers the inherited serialized reconnect/health workflow. Kill switch rules remain while the tunnel restarts. If the GUI or helper crashes, nftables retains protection. Reopen Levik VPN and reconnect, or explicitly Disconnect to remove protection. A normal disconnect restores per-link resolver settings and removes only Levik VPN's own tables. The helper never flushes the system firewall. Protection is session-scoped; it is not a firewall service installed to persist across reboot.

If the desktop cannot start, an administrator can explicitly release retained protection:

```sh
sudo nft delete table inet levik_vpn  # only if present
sudo nft delete table inet levik_dns # only if present
sudo resolvectl revert LevikVPN      # if the TUN still exists
sudo resolvconf -d LevikVPN          # only when using openresolv
```

Uninstalling preserves the dedicated service account/core cache and any active crash-retained firewall to avoid silently weakening protection or reusing a firewall-exempt UID. Disconnect before uninstalling. Remove retained tables explicitly before an administrator removes the service account/cache. The app does not edit `/etc/resolv.conf` directly. Locked/unavailable keyrings and Electron's insecure `basic_text` backend are rejected instead of storing account credentials unencrypted.

## Development

Use Node.js 24, npm and Python 3. All work happens in this independent repository:

```sh
npm ci
npm run download:xray
npm run lint
npm run build
npm test
npm start
```

`download:xray` verifies a pinned SHA-256 for the official `Xray-linux-64.zip`, then verifies each binary/geodata file against `native/xray-integrity.json`. No binary archives, profiles, credentials, build output or dependencies are tracked. Changes to the core version must update all hashes deliberately after verifying the official release. Keep corresponding Xray source and notices available for redistribution.

`npm test` runs Vitest unit/DOM tests and Python helper tests with mocked OS boundaries. To exercise real Linux TUN creation and crash-retained IPv4/IPv6 firewall behavior **inside a disposable Linux CI/VM only**:

```sh
sudo unshare --net python3 scripts/linux-smoke.py
```

This test refuses the host network namespace, but creates the root-owned core cache and service account in the VM filesystem. It requires downloaded Xray assets and Linux dependencies.

## Packaging, releases and updates

```sh
npm run download:xray
npm run package:linux
```

Build on Linux x64. electron-builder emits AppImage and `.deb` packages, a desktop entry under Network/VPN, icons and `latest-linux.yml`. `.github/workflows/linux-release.yml` runs on main pushes, pull requests and manual dispatch. It installs dependencies, assigns a unique version using the run number, verifies the core, runs lint/build/unit/native tests, packages and checksums artifacts. Main builds publish a tagged GitHub Release with versioned files, stable download aliases, updater metadata and `SHA256SUMS.txt`. PRs build but cannot publish.

The generic updater points to `https://github.com/Nort321/levik-vpn-linux/releases/latest/download`. AppImage updates require a writable AppImage path. Debian updates may require package-manager authorization and can always be installed manually from the release. `LEVIK_UPDATE_URL` can select an operator-managed HTTPS mirror; no server credentials should be embedded. Reconnecting after an application update re-authorizes the helper.

See [architecture](docs/architecture.md), [security policy](SECURITY.md), [third-party notices](THIRD_PARTY_NOTICES.md) and [validation report](docs/implementation-report.md).

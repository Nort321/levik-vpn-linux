# Architecture and implementation map

`src/main/api`, `security`, `vpn/tunnelProfile`, `serverPinger`, `tunnelHealth`, `xrayStats`, `appController` and `update` reuse the Windows client's account and lifecycle architecture. Linux-specific code lives under `src/main/linux`; no existing sibling client is edited.

| Layer | Responsibilities |
| --- | --- |
| `src/renderer/app.ts` | Russian desktop UI, sign-in, subscriptions, servers, settings, dialogs |
| `src/renderer/accessibility.ts` | Keyed DOM reconciliation, focus lifecycle, modal inertness, keyboard navigation |
| `src/preload/preload.ts`, `src/main/ipc.ts` | Context-isolated API, input and external-link validation |
| `src/main/appController.ts` | Serialized connect/disconnect/recovery, account session, settings, sanitized snapshots |
| `src/main/linux/networkHelper.ts` | pkexec lifetime, request IDs, bounded request timeout, safe protocol errors |
| `native/levik-network.py` | Verified core staging, service account, capabilities, TUN supervision, atomic nftables and resolver integration |
| `src/main/linux/{killSwitch,dnsLeakProtection}.ts` | Controller-facing protection lifecycle and crash recovery |
| `src/main/linux/{outboundInterface,processes,autostart}.ts` | Route/procfs discovery and XDG desktop autostart |
| `src/main/vpn/xrayManager.ts` | Helper-backed tunnel lifecycle, stats and health |
| `src/main/vpn/xrayConfig.ts` | Linux TUN routes, DNS precedence, domain/process routing |
| `scripts/download-xray.mjs`, `native/xray-integrity.json` | Pinned archive and extracted-file integrity |
| `build/after-install.sh`, `build/after-remove.sh` | Restricted packaged-core capabilities and desktop integration |
| `.github/workflows/linux-release.yml` | Linux checks, isolated network smoke, packaging, checksums and release publishing |

A single helper holds an exclusive flock, receives JSON over private pipes and owns its child. EOF/termination stops the core and reverts resolver settings; nftables remains until an explicit disable. Root-owned state allows a subsequent GUI to display retained protection. Atomic `nft -f` transactions update only app-owned tables. No established-connection exemption can outlive a dead TUN.

Xray runs as a separate UID so the firewall can permit its outer sockets without granting all Electron-user applications unrestricted egress. AppImage mounts are staged into a verified root-owned cache for access by that UID. A kill switch blocks direct desktop account refreshes while disconnected, so cached profiles support recovery. Port 53/853 routing precedes split rules to keep the selected resolver on the VPN.

The renderer keeps nodes with stable IDs or domain keys across snapshots. Event bindings are replaced through AbortController, preventing duplicate actions on retained nodes. Inputs keep in-progress values and selection while focused. Native buttons/selects retain their built-in interaction semantics, and modal state is applied after each render.

The initial implementation is tested with unit/DOM mocks on the development host and real kernel integration in Linux CI. Live account authorization, external VPN reachability, desktop polkit/keyring interaction and cross-distribution leak checks require a real Linux desktop and account; they are not inferred from unit tests.

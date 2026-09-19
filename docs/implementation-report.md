# Initial implementation report

All source and package work is isolated to `levik_vpn_linux`. Existing Windows/macOS/web clients are read-only references. The independent repository is `Nort321/levik-vpn-linux`, private on initial creation, with `main` as the default branch.

Implemented files and architectural decisions are mapped in [architecture.md](architecture.md), with runtime/development/packaging instructions in [README.md](../README.md). Source includes the inherited account/authentication/profile/controller/statistics/updates flows; new Linux platform adapters, a privileged helper, keyboard-preserving renderer reconciliation, packaging hooks and release CI. Source, tests, npm lockfile, assets and AGPL/security/third-party documentation are tracked. Vendor archives/binaries, dependencies, local credentials, logs and build/release output are ignored.

Local verification on the macOS development host: `npm install`, pinned `npm run download:xray`, `npm run lint`, `npm run build`, and `npm test` passed. Current suite: 96 Vitest tests plus 6 Python helper tests. Vitest was upgraded to patched 4.1.11 from the reference client's 3.x after npm audit identified development-only advisories; the resulting dependency audit reported zero vulnerabilities. A jsdom development dependency supports focus/keyboard DOM regressions.

Linux kernel operations and Linux packaging are validated by the release workflow on Ubuntu, including the isolated network-namespace smoke test. Final CI and release results are recorded in the completion report. No real account credentials or live VPN server were available for a full desktop connection test; polkit/keyring UI, distribution resolver integration, end-to-end external DNS/IPv6 leak tests and OTA installation require a Linux desktop acceptance run. Unit/CI success is not a claim that these manual checks occurred.

The owner will switch repository visibility to public separately. The configured release/update URLs become anonymously accessible then. No token is embedded in the application, and this dispatch does not change repository visibility.

# Security policy

Report vulnerabilities privately to the Levik VPN maintainers through [Levik Support](https://t.me/leviksupportbot). Do not publish credentials, decrypted profiles, packet contents or exploit details in a public issue. Include the client/core version, Linux distribution, package format, reproduction steps and expected impact with identifiers redacted. This initial client has no independent security certification.

The current 1.x line is supported. Releases and dependencies should be updated regularly. The client is AGPL-3.0-only; report third-party core vulnerabilities to XTLS as appropriate.

## Trust boundaries

The renderer is sandboxed, context isolated and has no Node.js integration. IPC exposes named operations and validates inputs in the main process. Profile credentials and device private keys stay out of renderer snapshots and logs. Electron safeStorage must use a real encrypted system keyring; Linux `basic_text` is rejected.

Only the authenticated pkexec helper changes networking. The helper runs a hash-verified core under a dedicated service UID and limited capabilities. Process routing requires additional procfs read capabilities as documented in README. The service account must not be used for unrelated programs: its network traffic is exempt from the kill switch. Core profiles remain in pipes and memory; subprocess output is discarded. The helper is intentionally not a passwordless privilege API. A user who approves a modified portable helper through polkit approves that code; obtain packages from the official release and verify checksums.

The kill switch is an nftables output guard for ordinary host traffic, not a defense against root, privileged raw packet sockets, kernel compromise, separately networked containers, a malicious core or intentional Xray bypass rules. It retains rules after crashes but does not persist them across reboot. DNS protections cannot classify every encrypted DNS service over HTTPS. Root-owned state and core files must not be made writable by ordinary users.

Releases initially reside in a private GitHub repository. The owner will make it public separately; no distribution token is embedded. SHA256SUMS provides integrity relative to the release, not an independent signature. Review source, dependencies and the privileged helper before production rollout, and validate DNS/IPv6/recovery behavior on each supported desktop distribution.

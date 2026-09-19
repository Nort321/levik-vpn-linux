# Third-party notices

The Levik VPN Linux client derives from the Levik VPN Windows client and is licensed AGPL-3.0-only; see LICENSE.

Bundled components retain their own licenses:

* Electron / Chromium / Node.js: MIT, BSD and other upstream licenses; Electron packaging includes its notices.
* Xray-core v26.7.28: Mozilla Public License 2.0, [source and release](https://github.com/XTLS/Xray-core/releases/tag/v26.7.28). The download script includes the upstream LICENSE next to the binary. This client uses the unmodified official Linux binary.
* Xray's geoip/geosite data: upstream datasets bundled in that release; preserve the applicable notices from [geoip](https://github.com/v2fly/geoip) and [domain-list-community](https://github.com/v2fly/domain-list-community) when redistributing.
* electron-updater: MIT; qrcode: MIT.
* TypeScript, esbuild, Vitest, jsdom and electron-builder are development/build dependencies, with their upstream notices in npm packages.

Brand names and logos identify the official Levik VPN product; the software license does not independently grant trademark rights.

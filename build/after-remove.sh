#!/bin/sh
set -eu
# Do not remove a crash-retained firewall while a session may still be active.
# Core cache/service account are retained to avoid UID reuse in nftables rules.
CORE='/opt/Levik VPN/resources/xray/xray'
if [ -f "$CORE" ]; then setcap -r "$CORE" 2>/dev/null || true; fi
update-desktop-database /usr/share/applications >/dev/null 2>&1 || true

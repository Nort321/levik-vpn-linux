#!/bin/sh
set -eu
# electron-builder substitutes the installation path at package generation.
CORE='/opt/Levik VPN/resources/xray/xray'
if [ -f "$CORE" ]; then
  getent passwd levik-vpn-core >/dev/null || useradd --system --user-group --no-create-home --shell /usr/sbin/nologin levik-vpn-core
  chown root:levik-vpn-core "$CORE"
  chmod 0750 "$CORE"
  setcap cap_net_admin,cap_net_raw=eip "$CORE" || printf '%s\n' 'Capabilities unavailable; Levik VPN will use its pkexec helper.' >&2
fi
update-desktop-database /usr/share/applications >/dev/null 2>&1 || true

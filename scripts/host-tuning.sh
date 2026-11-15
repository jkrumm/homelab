#!/usr/bin/env bash
# Root, idempotent: the host-level fixes of Issue 1411 that setup.sh would apply on a re-run,
# without re-running the whole of setup.sh.
#   1. rapl-power-limit.service: cap the package power limit (rationale in the unit).
#   2. unattended-upgrades reboot time: converge the file on host to setup.sh's 05:30
#      (it still said 04:00, which lands on the 04:00 cron jobs).
# Usage: sudo ~/homelab/scripts/host-tuning.sh
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "host-tuning.sh must run as root" >&2; exit 1; }

REPO="${HOMELAB_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
UNIT=rapl-power-limit.service
LIMITS=/sys/class/powercap/intel-rapl:0

install -D -m 644 "$REPO/config/systemd/$UNIT" "/etc/systemd/system/$UNIT"
systemctl daemon-reload
systemctl enable "$UNIT"
systemctl restart "$UNIT"
echo "package power limit: long $(cat "$LIMITS/constraint_0_power_limit_uw") uW, short $(cat "$LIMITS/constraint_1_power_limit_uw") uW"

UU=/etc/apt/apt.conf.d/50unattended-upgrades-local
if [ -f "$UU" ] && grep -q 'Automatic-Reboot-Time "04:00"' "$UU"; then
  sed -i 's/Automatic-Reboot-Time "04:00"/Automatic-Reboot-Time "05:30"/' "$UU"
fi
grep Automatic-Reboot-Time "$UU" 2>/dev/null || echo "no $UU on this host"

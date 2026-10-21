#!/usr/bin/env bash
# hdd-mountpoint-guard.sh — make the bare /mnt/hdd mountpoint unwritable, then (re)mount
# the encrypted HDD. Run as root (sudo) while the HDD is NOT mounted.
#
# Why: with the HDD absent, Docker's bind mounts create empty stand-in dirs under the
# bare /mnt/hdd on the SSD root fs, and every HDD-bound container (versitygw buckets,
# karakeep, filebrowser, samba, the homelab-private media stack) starts against them —
# an S3 writer could "verify" uploads onto the SSD (2026-10-21 power event). chattr +i
# on the empty mountpoint makes every such mkdir fail with EPERM, so those containers
# refuse to start instead; the mounted filesystem on top is unaffected.
#
#   hdd-mountpoint-guard.sh            clear stand-ins, lock mountpoint, unlock + mount
#   hdd-mountpoint-guard.sh --lock-only   clear stand-ins + lock, don't try to mount
#
# Afterwards (as jkrumm): `make up` here, homelab-private's restore, re-enable paused crons.

set -euo pipefail

MP=/mnt/hdd
MAX_STANDIN_MB=500   # stand-ins are tiny; anything bigger means real data — refuse
MAPPER=encrypted_partition

[ "$(id -u)" -eq 0 ] || { echo "run as root" >&2; exit 1; }

if mountpoint -q "$MP"; then
  echo "$MP is mounted — the bare mountpoint can only be locked while unmounted; nothing to do"
  exit 0
fi

size_mb=$(du -sm "$MP" | cut -f1)
if [ "$size_mb" -gt "$MAX_STANDIN_MB" ]; then
  echo "refusing: $MP (unmounted) holds ${size_mb} MB on the root fs — inspect by hand" >&2
  exit 1
fi

chattr -i "$MP"
find "$MP" -mindepth 1 -delete
chattr +i "$MP"
echo "cleared ${size_mb} MB of stand-ins; $MP locked ($(lsattr -d "$MP" | cut -d' ' -f1))"

[ "${1:-}" = --lock-only ] && exit 0

if [ ! -e "/dev/mapper/$MAPPER" ]; then
  systemctl start "systemd-cryptsetup@${MAPPER}.service" \
    || { echo "LUKS unlock failed — is the HDD connected? (lsblk)" >&2; exit 1; }
fi
systemctl restart mount-hdd.service
mountpoint -q "$MP" || { echo "mount failed" >&2; exit 1; }
touch "$MP/.healthcheck_guard" && rm -f "$MP/.healthcheck_guard"
echo "HDD mounted and writable at $MP"

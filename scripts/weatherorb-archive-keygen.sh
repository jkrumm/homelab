#!/usr/bin/env bash
# Creates the dedicated key the archive pull uses to reach the weatherorb mini's
# forced-command door (scripts/weatherorb-archive-pull.sh), then prints its public
# key line. Idempotent: an existing key is kept, never regenerated.
#
# Install the printed line on the mini from the weatherorb checkout:
#   make archive-door-key KEY='<the printed line>'
set -euo pipefail

KEY="${WO_ARCHIVE_KEY:-$HOME/.ssh/id_ed25519_weatherorb_archive}"

mkdir -p "$(dirname "$KEY")"
chmod 700 "$(dirname "$KEY")"

if [ ! -f "$KEY" ]; then
  ssh-keygen -q -t ed25519 -N '' -C homelab-weatherorb-archive -f "$KEY"
fi
[ -f "$KEY.pub" ] || ssh-keygen -y -f "$KEY" > "$KEY.pub"

cat "$KEY.pub"

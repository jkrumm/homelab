#!/bin/bash
# daemon (default): keychain init + socat relay + Bridge --noninteractive (waits for login)
# cli:              keychain init + interactive Bridge CLI (make proton-bridge-login)
set -euo pipefail

mkdir -p "$GNUPGHOME" && chmod 700 "$GNUPGHOME"

# Bridge picks `pass` automatically when present. Passphrase-less key: nobody can type
# one at boot; the key protects only Bridge's random vault key, at rest on this disk.
if [ ! -f "$HOME/.password-store/.gpg-id" ]; then
  gpg --batch --passphrase '' --quick-gen-key 'ProtonMail Bridge' default default never
  pass init 'ProtonMail Bridge'
fi

case "${1:-daemon}" in
  cli)
    exec bridge --cli
    ;;
  daemon)
    socat TCP-LISTEN:143,fork,reuseaddr TCP:127.0.0.1:1143 &
    exec bridge --noninteractive
    ;;
  *)
    exec "$@"
    ;;
esac

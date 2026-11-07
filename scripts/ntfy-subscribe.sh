#!/usr/bin/env bash
# Subscribe the owner's ntfy account to every topic in config/ntfy/topics.txt.
#
# ntfy-mac reads the account's subscriptions (/v1/account) every 30 minutes, so
# this is the only step the Mac needs. The iOS app has no account sync: its list is
# docs/ntfy.md "Subscribe list".
#
# Idempotent: a topic the account already has is skipped (the server answers 409 to a repeat).
#   scripts/ntfy-subscribe.sh            subscribe every topic, then list the account's topics
#   scripts/ntfy-subscribe.sh --test     also publish one test message per topic (priority 2)
#
# Token: $NTFY_TOKEN, else `secrets-run` (the mini), else `op` (a machine with 1Password).
# The base URL comes from config/ntfy/server.yml, the same file the watchdog reads.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOPICS_FILE="$ROOT/config/ntfy/topics.txt"
SERVER_CONFIG="$ROOT/config/ntfy/server.yml"
TOKEN_REF="op://common/ntfy/TOKEN"

test_mode=0
[ "${1:-}" = "--test" ] && test_mode=1

base_url="$(sed -n 's/^base-url:[[:space:]]*"\{0,1\}\([^"[:space:]]*\)"\{0,1\}.*/\1/p' "$SERVER_CONFIG" | sed -n 1p)"
[ -n "$base_url" ] || { echo "no base-url in $SERVER_CONFIG" >&2; exit 1; }

token="${NTFY_TOKEN:-}"
if [ -z "$token" ] && command -v secrets-run > /dev/null; then token="$(secrets-run read "$TOKEN_REF")"; fi
if [ -z "$token" ] && command -v op > /dev/null; then token="$(op read "$TOKEN_REF")"; fi
[ -n "$token" ] || { echo "no ntfy token: set NTFY_TOKEN or sign in to secrets-run/op" >&2; exit 1; }

# The token goes through a process-substitution header file, never argv
auth() { curl -fsS --max-time 15 -H @<(printf 'Authorization: Bearer %s\n' "$token") "$@"; }

account_topics() { auth "$base_url/v1/account" | grep -o '"topic":"[^"]*"' | sed 's/"topic":"\(.*\)"/\1/' | sort; }

topics="$(grep -v -E '^[[:space:]]*(#|$)' "$TOPICS_FILE")"
have="$(account_topics)"
for topic in $topics; do
  if echo "$have" | grep -qx "$topic"; then
    echo "already subscribed: $topic"
  else
    auth -X POST -d "{\"base_url\":\"$base_url\",\"topic\":\"$topic\"}" "$base_url/v1/account/subscription" > /dev/null
    echo "subscribed: $topic"
  fi
  if [ "$test_mode" -eq 1 ]; then
    auth -H "Title: ntfy topic check" -H "Priority: 2" -H "Tags: white_check_mark" \
      -d "Topic $topic is wired and subscribed." "$base_url/$topic" > /dev/null
    echo "  test message sent: $topic"
  fi
done

echo "account subscriptions:"
account_topics | sed 's/^/  /'

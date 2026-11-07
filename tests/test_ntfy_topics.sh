#!/usr/bin/env bash
# The ntfy topic set must stay one list: config/ntfy/topics.txt (what
# `make ntfy-subscribe` subscribes) equals the topic column of the table in
# docs/ntfy.md, and every topic this repo publishes to is in it. Also fails if a
# Slack webhook or API sender reappears in tracked code. Local only.

set -uo pipefail

cd "$(dirname "$0")/.." || exit

bad=0
listed="$(grep -v -E '^[[:space:]]*(#|$)' config/ntfy/topics.txt | sort)"
# table rows look like: | `alerts` | ... |
documented="$(sed -n 's/^| `\([a-z]*\)` |.*/\1/p' docs/ntfy.md | sort)"

if [ "$listed" != "$documented" ]; then
  echo "FAIL: config/ntfy/topics.txt and the docs/ntfy.md table differ:"
  diff <(echo "$listed") <(echo "$documented")
  bad=1
fi

# Publishers in this repo: URL paths ending in a topic, and the Kuma provider's topic:
published="$(
  { grep -hoE '@ntfy\.[a-z.]+/[a-z]+' docker-compose.yml | sed 's|.*/||'
    grep -hoE '_NTFY_BASE_URL/[a-z]+' scripts/*.sh | sed 's|.*/||'
    sed -n 's/^[[:space:]]*topic:[[:space:]]*\([a-z]*\).*/\1/p' uptime-kuma/monitors.yaml
  } | sort -u
)"
for t in $published; do
  echo "$listed" | grep -qx "$t" || { echo "FAIL: this repo publishes to topic '$t', not in config/ntfy/topics.txt"; bad=1; }
done

hits="$(git ls-files | grep -v -E '^(docs/decisions\.md|tests/test_ntfy_topics\.sh)$' | xargs grep -nE 'hooks\.slack\.com|SLACK_WEBHOOK|SLACK_BOT|slack\.com/api|xox[bp]-' 2>/dev/null || true)"
[ -z "$hits" ] || { echo "FAIL: Slack sender in tracked code:"; echo "$hits"; bad=1; }

[ "$bad" -eq 0 ] && echo "ok: ntfy topics match docs, no Slack sender"
exit "$bad"

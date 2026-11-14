#!/usr/bin/env bash
# Converge Beszel's notification routing (run ON the homelab: `make beszel-alerts`).
#
# Why a script: the hub keeps one shoutrrr list per hub *user* and no per-alert routing, and its
# notification title is built by the hub ("<system> CPU above threshold"). A static
# `?title=Beszel` on the URL is appended first and wins, which is what made every alert read
# "Beszel" with no host (2026-11-14). So:
#   * the owner's user pages `alerts` with a title-less URL (temperature, status, memory, disk),
#   * a second admin user (non-admins may not reach the tailnet ntfy) owns the CPU and load
#     alerts and posts them to `watchdog` at priority 2 — a batch job is not an outage.
# Re-run after adding a CPU/load alert in the Beszel UI: it moves such rows to the digest user.
# Needs jq, curl, docker and `op` (service account) or NTFY_TOKEN in the environment.
set -euo pipefail

NTFY_HOST="${NTFY_HOST:-ntfy.jkrumm.com}"
OWNER_EMAIL="${BESZEL_OWNER_EMAIL:-jkrumm@pm.me}"
DIGEST_EMAIL="beszel-digest@beszel.invalid"
TMP_EMAIL="tmp-beszel-alerts@beszel.invalid"
DIGEST_ALERTS='["CPU","LoadAvg1","LoadAvg5","LoadAvg15"]'

NTFY_TOKEN="${NTFY_TOKEN:-$(op read op://common/ntfy/TOKEN)}"
[ -n "$NTFY_TOKEN" ] || { echo "no ntfy token" >&2; exit 1; }

PW=$(openssl rand -hex 24)
docker exec beszel /beszel superuser upsert "$TMP_EMAIL" "$PW" >/dev/null
cleanup() { # a busy hub answers "database is locked": retry, and say so if the superuser stays
  local out
  for _ in 1 2 3 4 5; do
    out=$(docker exec beszel /beszel superuser delete "$TMP_EMAIL" 2>&1) && return
    case $out in *"missing or already"*) return ;; esac
    sleep 3
  done
  echo "WARNING: superuser $TMP_EMAIL not deleted" >&2
}
trap cleanup EXIT

HUB="http://$(docker inspect beszel --format '{{(index .NetworkSettings.Networks "homelab_beszel").IPAddress}}'):8090"
TOKEN=$(curl -fsS -X POST "$HUB/api/collections/_superusers/auth-with-password" \
  -H 'content-type: application/json' \
  -d "$(jq -n --arg i "$TMP_EMAIL" --arg p "$PW" '{identity:$i,password:$p}')" | jq -r .token)

api() { # api METHOD PATH [JSON]
  curl -fsS -X "$1" "$HUB/api/collections/$2" -H "Authorization: $TOKEN" \
    -H 'content-type: application/json' ${3:+-d "$3"}
}
first_id() { jq -r '.items[0].id // empty'; }
by() { jq -rn --arg f "$1" --arg v "$2" '"\($f)=\"\($v)\""|@uri'; } # by FIELD VALUE -> filter

owner=$(api GET "users/records?filter=$(by email "$OWNER_EMAIL")" | first_id)
[ -n "$owner" ] || { echo "owner $OWNER_EMAIL not found" >&2; exit 1; }

digest=$(api GET "users/records?filter=$(by email "$DIGEST_EMAIL")" | first_id)
if [ -z "$digest" ]; then
  dpw=$(openssl rand -hex 24)
  digest=$(api POST users/records "$(jq -n --arg e "$DIGEST_EMAIL" --arg p "$dpw" \
    '{email:$e,password:$p,passwordConfirm:$p,verified:true,role:"admin",username:"beszel-digest"}')" | jq -r .id)
  echo "created digest user $digest"
fi

# Both users must see every system (an alert row needs system.users to contain its user).
for sys in $(api GET "systems/records?perPage=200" | jq -r '.items[].id'); do
  api PATCH "systems/records/$sys" "$(jq -n --arg o "$owner" --arg d "$digest" '{"users+":[$o,$d]}')" >/dev/null
done

set_webhook() { # set_webhook USER_ID URL
  local rec id merged
  rec=$(api GET "user_settings/records?filter=$(by user "$1")")
  id=$(first_id <<<"$rec")
  merged=$(jq -c --arg u "$2" '(.items[0].settings // {}) | .webhooks = [$u] | .emails = []' <<<"$rec")
  if [ -n "$id" ]; then
    api PATCH "user_settings/records/$id" "$(jq -n --argjson s "$merged" '{settings:$s}')" >/dev/null
  else
    api POST user_settings/records "$(jq -n --arg u "$1" --argjson s "$merged" '{user:$u,settings:$s}')" >/dev/null
  fi
}
set_webhook "$owner" "ntfy://:${NTFY_TOKEN}@${NTFY_HOST}/alerts"
set_webhook "$digest" "ntfy://:${NTFY_TOKEN}@${NTFY_HOST}/watchdog?priority=low"

# Move the owner's CPU and load alert rows to the digest user (same system, value, min).
rows=$(api GET "alerts/records?perPage=500&filter=$(by user "$owner")")
jq -c --argjson names "$DIGEST_ALERTS" \
  '.items[] | select(.name as $n | $names | index($n)) | {id,system,name,value,min}' <<<"$rows" |
  while read -r row; do
    sys=$(jq -r .system <<<"$row")
    name=$(jq -r .name <<<"$row")
    have=$(api GET "alerts/records?filter=$(jq -rn --arg u "$digest" --arg s "$sys" --arg n "$name" \
      '"user=\"\($u)\" && system=\"\($s)\" && name=\"\($n)\""|@uri')" | first_id)
    if [ -z "$have" ]; then
      api POST alerts/records "$(jq -c --arg u "$digest" '{user:$u,system,name,value,min}' <<<"$row")" >/dev/null
    fi
    api DELETE "alerts/records/$(jq -r .id <<<"$row")" >/dev/null
    echo "moved $name on $sys to the digest user"
  done

echo "beszel alerts: owner -> alerts, digest (CPU/load) -> watchdog"

#!/usr/bin/env bash
# Replay the watchdog-cron install invariant from setup.sh across six seeded
# crontabs, driving the real block rather than a re-implementation. The block is
# extracted between the `# Read the current crontab once` comment and the
# `# Create watchdog state directory` comment that follows it, so an edit to
# setup.sh's no-op predicate is exercised here. Local only — no server, no
# network, no root.

set -uo pipefail

cd "$(dirname "$0")/.." || exit

# The block under test. It is a self-contained fragment; everything it needs
# (WATCHDOG_SCRIPT, CRON_ENTRY, CRON_BACKUP, crontab) is supplied below.
BLOCK="$(sed -n '/^# Read the current crontab once/,/^# Create watchdog state directory/p' setup.sh | sed '$d')"
[ -n "$BLOCK" ] || { echo "FAIL: could not extract the cron block from setup.sh" >&2; exit 1; }

# Fixtures mirror the definitions above the block in setup.sh.
USER_HOME="/home/jkrumm"
WATCHDOG_SCRIPT="$USER_HOME/homelab/scripts/homelab_watchdog.sh"
CRON_ENTRY="*/10 * * * * [ -r /root/.profile ] && . /root/.profile; $WATCHDOG_SCRIPT >> /var/log/homelab_watchdog.log 2>&1"
# A pre-guard line: names $WATCHDOG_SCRIPT but is not CRON_ENTRY, so the rewrite
# must migrate it. An unrelated line that must always survive untouched.
STALE="*/10 * * * * $WATCHDOG_SCRIPT"
FOREIGN="0 3 * * * /usr/local/bin/backup.sh"

# The crontab the block talks to. The spool lives in $CRON_STORE so the test can
# seed and inspect it; `crontab -l` on an empty spool emulates cron's exact
# "no crontab for" failure, which the block's read-abort check keys on.
crontab() {
  if [ "$1" = "-l" ]; then
    if [ -s "$CRON_STORE" ]; then
      cat "$CRON_STORE"
    else
      echo "no crontab for root" >&2
      return 1
    fi
  else
    cat > "$CRON_STORE"
  fi
}

fail=0

# run_case <desc> <want> <seed>
#   want = "noop"   -> the spool must be byte-identical to the seed and reported
#                      "already present"
#   want = "<final>" -> the spool must equal <final> after the rewrite
run_case() {
  local desc="$1" want="$2" seed="$3"
  local tmpdir out store pass=1
  tmpdir="$(mktemp -d)"
  CRON_STORE="$tmpdir/crontab"
  # Read by the eval'd block below (shellcheck can't see into eval).
  # shellcheck disable=SC2034
  CRON_BACKUP="$tmpdir/crontab.backup"
  if [ -n "$seed" ]; then
    printf '%s\n' "$seed" > "$CRON_STORE"
  fi
  out="$(eval "$BLOCK")"
  store="$(cat "$CRON_STORE" 2>/dev/null || true)"

  if [ "$want" = "noop" ]; then
    printf '%s\n' "$seed" | cmp -s - "$CRON_STORE" \
      || { echo "FAIL [$desc]: expected no-op but the spool was rewritten" >&2; pass=0; }
    printf '%s\n' "$out" | grep -q 'already present' \
      || { echo "FAIL [$desc]: no-op did not report 'already present'" >&2; pass=0; }
  else
    [ "$store" = "$want" ] \
      || { echo "FAIL [$desc]: expected spool [$want] got [$store]" >&2; pass=0; }
  fi

  rm -rf "$tmpdir"
  [ "$pass" = 1 ] || fail=$((fail + 1))
}

# (i)   empty crontab            -> add the entry
# (ii)  exactly CRON_ENTRY       -> no-op
# (iii) CRON_ENTRY mid-crontab   -> no-op (order-independent)
# (iv)  pre-guard line only      -> migrate to CRON_ENTRY
# (v)   CRON_ENTRY + stale line  -> rewrite, strip the duplicate
# (vi)  foreign line only        -> add the entry, keep the foreign line
run_case "empty crontab"            "$CRON_ENTRY"              ""
run_case "exact entry"              "noop"                     "$CRON_ENTRY"
run_case "entry mid-crontab"        "noop"                     "$FOREIGN
$CRON_ENTRY
$FOREIGN"
run_case "pre-guard line only"      "$CRON_ENTRY"              "$STALE"
run_case "entry plus stale line"    "$CRON_ENTRY"              "$CRON_ENTRY
$STALE"
run_case "foreign line only"        "$FOREIGN
$CRON_ENTRY"               "$FOREIGN"

# After (vi) the spool holds exactly one watchdog line, so a second run is a no-op.
run_case "second run after foreign" "noop"                     "$FOREIGN
$CRON_ENTRY"

if [ "$fail" -ne 0 ]; then
  echo "test_setup_cron_replay: $fail case(s) failed" >&2
  exit 1
fi
echo "test_setup_cron_replay: all cases passed"

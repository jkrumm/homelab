#!/usr/bin/env python3
"""
Uptime Kuma Monitor Sync Script

Syncs monitors from monitors.yaml to Uptime Kuma instance.
Uses uptime-kuma-api for WebSocket communication.

IMPORTANT: Run this script ON THE HOMELAB SERVER only.
It connects to the local Uptime Kuma instance at localhost:3010.
Do NOT run locally or on the VPS.

Usage (from ~/homelab on homelab):
    # Dry run (show what would change)
    op run --env-file=.env.tpl -- uptime-kuma/.venv/bin/python uptime-kuma/sync.py --dry-run

    # Sync monitors
    op run --env-file=.env.tpl -- uptime-kuma/.venv/bin/python uptime-kuma/sync.py

    # Export current monitors to YAML
    op run --env-file=.env.tpl -- uptime-kuma/.venv/bin/python uptime-kuma/sync.py --export

    # Slow instance: raise the Socket.IO timeout, and trace a failure in full
    op run --env-file=.env.tpl -- uptime-kuma/.venv/bin/python uptime-kuma/sync.py --timeout 120 --verbose

Requirements:
    pip install uptime-kuma-api pyyaml

Environment variables (via 1Password):
    UPTIME_KUMA_PASSWORD: Admin password (required)
    Plus every ${VAR} referenced in monitors.yaml — all are required; the script
    exits 2 without touching a monitor if any is missing.

Hardcoded defaults (homelab-specific):
    URL: http://localhost:3010
    Username: jkrumm
"""

import argparse
import json
import os
import re
import sys
import time
import traceback
from pathlib import Path

import yaml
from socketio.exceptions import ConnectionError as SocketIOConnectionError
from socketio.exceptions import TimeoutError as SocketIOTimeoutError
from uptime_kuma_api import UptimeKumaApi, MonitorType


# Distinct from the generic exit 1 (bad password, Kuma unreachable) so a wrapper
# can tell "the environment never loaded" apart from "the server is down".
EXIT_UNRESOLVED_ENV = 2
# The live notification providers differ from `settings.notifications` — a
# provider added in the UI would be attached to every leaf on the next sync
# (double alerts), one deleted would detach silently (no alerts). Abort instead.
EXIT_NOTIFICATIONS_DRIFT = 3


# `make uk-sync` / `uk-dry-run` / `uk-export` are the supported entrypoints — they
# wrap every invocation in `op run --env-file=.env.tpl`. Nothing but the Makefile
# enforces that, so the unresolved-var guard below is the backstop for a bare
# invocation: on 2026-08-01 a broken `op run` plus a hand-run sync substituted ""
# into 6 live monitors (empty hostnames, empty bearer tokens) and took them down
# for ~17h. Warnings scrolled past; only an abort would have stopped it.
# Regression suite: `make test` (tests/test_uptime_kuma_sync_guard.py) —
# stubs the Uptime Kuma API entirely, no network, no server required.
def load_config(config_path: str, unresolved: set) -> dict:
    """Load and parse YAML config with environment variable substitution.

    Unresolved ${VAR} names are collected into `unresolved` instead of being
    reported and substituted anyway — the caller aborts on any, across every
    config file, before a single mutating API call.
    """
    with open(config_path) as f:
        content = f.read()

    # Substitute environment variables: ${VAR_NAME}
    def replace_env(match):
        var_name = match.group(1)
        # Unset and set-to-empty are treated alike: no var here is legitimately
        # empty, and an empty one is exactly as destructive as a missing one.
        value = os.environ.get(var_name, "")
        if not value:
            unresolved.add(var_name)
        return value

    content = re.sub(r"\$\{([^}]+)\}", replace_env, content)
    return yaml.safe_load(content)


# Database monitors hold connection details (host/port/user/password) in the
# Uptime Kuma UI — never in this YAML — to keep secrets out of git. For these
# types we skip the update path entirely once the monitor exists, so a future
# uptime-kuma-api or Kuma server update can't wipe UI-managed fields by
# accident. Initial creation goes through the normal path with metadata only;
# fill connection details in the UI after first sync.
DB_MONITOR_TYPES = {"mysql", "mssql", "postgres", "mongodb", "redis"}


def get_monitor_type(type_str: str) -> MonitorType:
    """Convert string type to MonitorType enum."""
    type_map = {
        "http": MonitorType.HTTP,
        "keyword": MonitorType.KEYWORD,
        "docker": MonitorType.DOCKER,
        "push": MonitorType.PUSH,
        "mysql": MonitorType.MYSQL,
        "group": MonitorType.GROUP,
        "ping": MonitorType.PING,
        "port": MonitorType.PORT,
        "dns": MonitorType.DNS,
    }
    return type_map.get(type_str.lower(), MonitorType.HTTP)


def build_monitor_params(monitor: dict, defaults: dict, cloudflare_header: dict, parent_id: int = None) -> dict:
    """Build monitor parameters from YAML config."""
    monitor_type = get_monitor_type(monitor.get("type", "http"))
    params = {
        "name": monitor["name"],
        "type": monitor_type,
        "interval": monitor.get("interval", defaults.get("interval", 60)),
        "timeout": monitor.get("timeout", defaults.get("timeout", 90)),
        "maxretries": monitor.get("maxretries", defaults.get("maxretries", 3)),
        "retryInterval": monitor.get("retry_interval", defaults.get("retry_interval", 60)),
    }

    # 'active' parameter not supported for push monitors in uptime-kuma-api
    if monitor_type != MonitorType.PUSH:
        params["active"] = monitor.get("active", True)
    # Push monitors CAN be created from here — proven 2026-07-28, when this
    # created "MacMini Collie - Push" (id=205) against uptime-kuma:2 with
    # uptime-kuma-api 1.2.1, the exact pairing the old comment said could not.
    # That claim sat here and in seven monitors.yaml comments long enough to be
    # believed and reasoned from, so: only `active` is genuinely unsupported for
    # push (handled above). The push token is retrievable too —
    # api.get_monitor(id)["pushToken"] — so create-and-wire needs no browser.

    # URL
    if "url" in monitor:
        params["url"] = monitor["url"]

    # Docker container
    if "docker_container" in monitor:
        params["docker_container"] = monitor["docker_container"]
        params["docker_host"] = monitor.get("docker_host", 1)  # Default Docker host

    # Hostname (for ping monitors)
    if "hostname" in monitor:
        params["hostname"] = monitor["hostname"]

    # Keyword
    if "keyword" in monitor:
        params["keyword"] = monitor["keyword"]

    # IP family (IPv4/IPv6)
    if "ip_family" in monitor:
        params["dns_resolve_type"] = "AAAA" if monitor["ip_family"] == 6 else "A"

    # Accepted status codes
    accepted = monitor.get("accepted_statuscodes", defaults.get("accepted_statuscodes", ["200-299"]))
    params["accepted_statuscodes"] = accepted

    # Method
    params["method"] = monitor.get("method", defaults.get("method", "GET"))

    # Resend notification every N consecutive down checks (0 = notify once, no resend).
    # Keeps a continuously-down monitor nagging instead of firing a single alert that
    # gets missed while the outage persists for days.
    params["resendInterval"] = monitor.get(
        "resend_interval", defaults.get("resend_interval", 0)
    )

    # Headers
    headers = {}
    if monitor.get("cloudflare_bypass") and cloudflare_header:
        headers.update(cloudflare_header)
    if "headers" in monitor:
        headers.update(monitor["headers"])
    if headers:
        params["headers"] = json.dumps(headers)

    # Parent group
    if parent_id:
        params["parent"] = parent_id

    return params


def plan_webhook_providers(api: UptimeKumaApi, config: dict) -> list:
    """Validate `settings.webhooks` and plan the provider writes; mutates nothing.

    Every other provider stays UI-managed (the Slack one holds a secret URL). A webhook
    carries a bearer token, so it is declared with `token_env` naming the env var; the
    token itself never enters the YAML. Returns [(action, live_id, params)] with action
    "create" or "update" (converged providers are omitted). Every field and token is
    checked before any write, so a bad second entry cannot leave the first half-applied.
    """
    declared = config.get("settings", {}).get("webhooks") or []
    live = {n["name"]: n for n in api.get_notifications()}
    plan = []
    for hook in declared:
        missing = [k for k in ("name", "url", "token_env") if not hook.get(k)]
        if missing:
            print(f"Error: settings.webhooks entry {hook!r} lacks {missing}", file=sys.stderr)
            sys.exit(EXIT_UNRESOLVED_ENV)
        if not hook["url"].startswith("https://"):
            print(f"Error: webhook '{hook['name']}' url must be https:// (it carries a bearer token)", file=sys.stderr)
            sys.exit(EXIT_UNRESOLVED_ENV)
        token = os.environ.get(hook["token_env"], "")
        if not token:
            print(f"Error: {hook['token_env']} is not set (webhook '{hook['name']}')", file=sys.stderr)
            sys.exit(EXIT_UNRESOLVED_ENV)
        params = {
            "name": hook["name"],
            "type": "webhook",
            "isDefault": False,
            "webhookURL": hook["url"],
            "webhookContentType": "json",
            "webhookAdditionalHeaders": json.dumps({"Authorization": f"Bearer {token}"}),
        }
        current = live.get(hook["name"])
        if current is None:
            plan.append(("create", None, params))
            continue
        # uptime-kuma-api flattens the provider's config into the top-level dict.
        cfg = current
        wanted = (params["webhookURL"], params["webhookContentType"], json.loads(params["webhookAdditionalHeaders"]), params["isDefault"])
        actual = (cfg.get("webhookURL"), cfg.get("webhookContentType"), json.loads(cfg.get("webhookAdditionalHeaders") or "{}"), bool(current.get("isDefault")))
        if wanted != actual:
            plan.append(("update", current["id"], params))
    return plan


def apply_webhook_plan(api: UptimeKumaApi, plan: list, dry_run: bool):
    for action, live_id, params in plan:
        print(f"  [{action.upper()}] notification {params['name']} -> {params['webhookURL']}")
        if dry_run:
            continue
        if action == "create":
            api.add_notification(applyExisting=False, **params)
        else:
            api.edit_notification(live_id, applyExisting=False, **params)


def sync_monitors(api: UptimeKumaApi, config: dict, dry_run: bool = False, delete_orphans: bool = False):
    """Sync monitors from config to Uptime Kuma."""
    defaults = config.get("settings", {}).get("defaults", {})
    cloudflare_header = config.get("settings", {}).get("cloudflare_bypass_header", {})

    webhook_plan = plan_webhook_providers(api, config)
    notifications = api.get_notifications()

    # `settings.notifications` is the declared provider set; the live set must
    # match exactly, because every provider below is attached to every leaf.
    declared = config.get("settings", {}).get("notifications")
    if declared is not None:
        # A would-be-created webhook counts as live, so --dry-run does not trip the guard on it.
        live_names = sorted([n["name"] for n in notifications] + [p["name"] for a, _, p in webhook_plan if a == "create"])
        if live_names != sorted(declared):
            print(
                "\nError: live notification providers differ from settings.notifications:",
                file=sys.stderr,
            )
            print(f"  declared: {sorted(declared)}", file=sys.stderr)
            print(f"  live:     {live_names}", file=sys.stderr)
            print(
                "Nothing was changed. Reconcile in the Uptime Kuma UI (providers are\n"
                "UI-managed) or update settings.notifications, then re-run.",
                file=sys.stderr,
            )
            sys.exit(EXIT_NOTIFICATIONS_DRIFT)

    apply_webhook_plan(api, webhook_plan, dry_run)
    notification_ids = [n["id"] for n in api.get_notifications()]

    # Get existing monitors
    existing = {m["name"]: m for m in api.get_monitors()}
    processed_names = set()

    def process_monitor(monitor: dict, parent_id: int = None, notify: bool = True):
        """Process a single monitor (create or update).

        `notify=False` detaches every notification provider. Used for GROUP
        monitors: Uptime Kuma marks a group DOWN whenever any child is DOWN, so
        a notified group turns one real incident into N+1 Slack messages — a
        HomeLab reboot on 2026-07-28 produced 57. Groups earn their keep in the
        dashboard tree, not in the alert stream; the child that actually failed
        is the one that names the fault.
        """
        name = monitor["name"]
        processed_names.add(name)
        monitor_notifications = notification_ids if notify else []

        # DB monitors: skip update once they exist — preserves UI-managed
        # connection details (password, host, query). See DB_MONITOR_TYPES.
        if monitor.get("type") in DB_MONITOR_TYPES and name in existing:
            print(f"  [SKIP-DB] {name} (connection details preserved from UI)")
            return existing[name]["id"]

        params = build_monitor_params(monitor, defaults, cloudflare_header, parent_id)

        if name in existing:
            # Update existing monitor (also converges the notification providers —
            # attaching them on leaves, DETACHING them on groups, so flipping
            # `notify` in config actually takes effect on an existing monitor)
            monitor_id = existing[name]["id"]
            if dry_run:
                print(f"  [UPDATE] {name} (id={monitor_id})")
                # A real run converges this; surface it in the pre-flight so a
                # UI-side detach/attach is visible before it is silently fixed.
                live_ids = sorted(existing[name].get("notificationIDList") or [])
                if live_ids != sorted(monitor_notifications):
                    print(f"  [NOTIFY-DRIFT] {name}: live={live_ids} expected={sorted(monitor_notifications)}")
            else:
                try:
                    params["notificationIDList"] = monitor_notifications
                    api.edit_monitor(monitor_id, **params)
                    print(f"  [UPDATED] {name}")
                    # edit_monitor carries `active` but Kuma does not act on it:
                    # a monitor paused in the UI stayed paused through every
                    # sync (Hermes - HTTP, 2026-09-11, paused since its 404
                    # days). Pause state is its own pair of calls, so converge
                    # it explicitly. Push monitors never carry `active` (above).
                    want_active = params.get("active")
                    is_active = bool(existing[name].get("active", True))
                    if want_active is True and not is_active:
                        api.resume_monitor(monitor_id)
                        print(f"  [RESUMED] {name}")
                    elif want_active is False and is_active:
                        api.pause_monitor(monitor_id)
                        print(f"  [PAUSED] {name}")
                except Exception as e:
                    print(f"  [ERROR] Failed to update {name}: {e}")
        else:
            # Create new monitor
            if dry_run:
                print(f"  [CREATE] {name}")
            else:
                try:
                    # 'active' not supported on add_monitor, only edit_monitor
                    create_params = {k: v for k, v in params.items() if k != "active"}
                    create_params["notificationIDList"] = monitor_notifications
                    result = api.add_monitor(**create_params)
                    print(f"  [CREATED] {name} (id={result['monitorID']})")
                    return result["monitorID"]
                except Exception as e:
                    print(f"  [ERROR] Failed to create {name}: {e}")
        return existing.get(name, {}).get("id")

    def process_group(group: dict, parent_id: int = None):
        """Process a group and its child monitors."""
        # Create/update the group itself
        group_config = {
            "name": group["name"],
            "type": "group",
            "interval": group.get("interval", 200),
        }
        # notify=False: see process_monitor — a group DOWN is a restatement of a
        # child DOWN, never new information.
        group_id = process_monitor(group_config, parent_id, notify=False)

        # Process child monitors
        for monitor in group.get("monitors", []):
            if monitor.get("type") == "group":
                # Nested group
                process_group(monitor, group_id)
            else:
                process_monitor(monitor, group_id)

    # Process all groups
    print("\nSyncing monitors...")
    for group in config.get("groups", []):
        print(f"\nGroup: {group['name']}")
        process_group(group)

    # Report monitors not in config and prompt for deletion
    orphaned = set(existing.keys()) - processed_names
    if orphaned:
        print(f"\n[ORPHANS] These monitors exist in Uptime Kuma but not in config:")
        for name in sorted(orphaned):
            print(f"  - {name} (id={existing[name]['id']})")
        if dry_run:
            return
        if delete_orphans or sys.stdin.isatty():
            if not delete_orphans:
                print("\nDelete these orphaned monitors? [y/N] ", end="", flush=True)
                answer = input().strip().lower()
                if answer != "y":
                    print("  Skipped — monitors left untouched.")
                    return
            for name in sorted(orphaned):
                mid = existing[name]["id"]
                try:
                    api.delete_monitor(mid)
                    print(f"  Deleted: {name} (id={mid})")
                except Exception as e:
                    print(f"  Failed to delete {name} (id={mid}): {e}")
        else:
            print("\n  (no interactive terminal — run sync.py directly or use --delete-orphans)")


def export_monitors(api: UptimeKumaApi, output_path: str):
    """Export current monitors to YAML format."""
    monitors = api.get_monitors()

    # Group monitors by parent
    groups = {}
    root_monitors = []

    for m in monitors:
        if m.get("parent") is None:
            if m["type"] == "group":
                groups[m["id"]] = {"config": m, "children": []}
            else:
                root_monitors.append(m)
        else:
            parent_id = m["parent"]
            if parent_id in groups:
                groups[parent_id]["children"].append(m)

    # Build YAML structure
    output = {
        "settings": {
            "defaults": {
                "interval": 60,
                "timeout": 90,
                "maxretries": 3,
                "retry_interval": 60,
                "accepted_statuscodes": ["200-299"],
            },
            "cloudflare_bypass_header": {
                "X-Uptime-Monitor": "${UPTIME_MONITOR_TOKEN}"
            }
        },
        "groups": []
    }

    def monitor_to_yaml(m: dict) -> dict:
        """Convert monitor dict to YAML-friendly format."""
        result = {
            "name": m["name"],
            "type": m["type"],
        }
        if m.get("url") and m["url"] != "https://":
            result["url"] = m["url"]
        if m.get("docker_container"):
            result["docker_container"] = m["docker_container"]
        if m.get("keyword"):
            result["keyword"] = m["keyword"]
        if m.get("interval"):
            result["interval"] = m["interval"]
        if m.get("timeout"):
            result["timeout"] = m["timeout"]
        # 0 is meaningful (alert on the first miss) and falsy — test for None,
        # or an exported monitor round-trips back to the default of 3.
        if m.get("maxretries") is not None:
            result["maxretries"] = m["maxretries"]
        if m.get("resendInterval"):
            result["resend_interval"] = m["resendInterval"]
        if m.get("dns_resolve_type") == "AAAA":
            result["ip_family"] = 6
        return result

    for group_id, group_data in groups.items():
        group_config = {
            "name": group_data["config"]["name"],
            "interval": group_data["config"].get("interval", 200),
            "monitors": [monitor_to_yaml(m) for m in group_data["children"]]
        }
        output["groups"].append(group_config)

    with open(output_path, "w") as f:
        yaml.dump(output, f, default_flow_style=False, sort_keys=False, allow_unicode=True)

    print(f"Exported {len(monitors)} monitors to {output_path}")


def format_error(e: BaseException) -> str:
    """Render any exception as `Type: repr(e)` — one failure format, every site.

    python-socketio raises `TimeoutError()` with no arguments, so `str(e)` is
    empty and a bare `f"Error: {e}"` printed nothing but the prefix. The repr
    names the type, so a failed run on 2026-10-13 could not say what had
    actually gone wrong.
    """
    return f"{type(e).__name__}: {e!r}"


# Login retry policy. `connect_and_login` retries only failures of the Socket.IO
# transport; a rejected login is never retried (hammering a typo'd password is
# how an account gets locked out). `LOGIN_BACKOFF_SECONDS` is read at call time,
# so the regression suite can set it to 0 instead of sleeping ~4 s.
LOGIN_ATTEMPTS = 3
LOGIN_BACKOFF_SECONDS = 2.0

# `UptimeKumaException` is deliberately absent here: uptime_kuma_api raises it
# for BOTH a rejected login and a failed connect, so its type cannot tell "wrong
# password" from "flaky socket" — everything that is not a transport failure is
# re-raised untouched. Class names verified against python-socketio 5.11.4
# `socketio/exceptions.py` (uptime-kuma-api 1.2.1 floors it at
# `python-socketio[client]>=5.0.0` in its setup.py).
RETRYABLE_LOGIN_ERRORS = (
    TimeoutError,             # builtin — socketio's TimeoutError is a separate class
    SocketIOTimeoutError,     # socketio.exceptions.TimeoutError — an unacked event/login
    SocketIOConnectionError,  # socketio.exceptions.ConnectionError (+ ConnectionRefusedError)
)


# A large instance (~250 monitors) can miss uptime-kuma-api's default 10 s
# Socket.IO timeout on login. `timeout` is the only knob: UptimeKumaApi.__init__
# (1.2.1 signature `(url, timeout=10, headers=None, ssl_verify=True,
# wait_events=0.2)`) passes it through as `wait_timeout` to `sio.connect()`, as
# `timeout` to `sio.call()`, and `_get_event_data()` uses it as the event-wait
# deadline — so one value covers connect, login and the initial monitor-list
# wait. Override the 60 s default with `--timeout`. Each attempt builds a fresh
# client: one whose login failed is not reusable.
def connect_and_login(url: str, username: str, password: str, timeout: float) -> UptimeKumaApi:
    """Connect and log in, retrying only transient transport failures."""
    last_error = None
    for attempt in range(1, LOGIN_ATTEMPTS + 1):
        api = None
        try:
            api = UptimeKumaApi(url, timeout=timeout)
            api.login(username, password)
            return api
        except Exception as e:
            if api is not None:
                try:
                    api.disconnect()
                except Exception:
                    pass
            if not isinstance(e, RETRYABLE_LOGIN_ERRORS):
                raise
            last_error = e
            print(
                f"  connect/login attempt {attempt}/{LOGIN_ATTEMPTS} failed: "
                f"{format_error(e)}",
                file=sys.stderr,
            )
            if attempt < LOGIN_ATTEMPTS:
                time.sleep(LOGIN_BACKOFF_SECONDS)
    raise last_error


def main():
    parser = argparse.ArgumentParser(description="Sync Uptime Kuma monitors from YAML config")
    parser.add_argument("--dry-run", action="store_true", help="Show what would change without making changes")
    parser.add_argument("--export", action="store_true", help="Export current monitors to YAML")
    parser.add_argument("--delete-orphans", action="store_true", help="Delete orphaned monitors without prompting")
    parser.add_argument("--config", default="uptime-kuma/monitors.yaml", help="Path to monitors.yaml")
    parser.add_argument("--extra-config", default=None, help="Path to additional monitors.yaml to merge in (e.g. from homelab-private)")
    parser.add_argument("--url", default="http://localhost:3010", help="Uptime Kuma URL")
    parser.add_argument("--username", default="jkrumm", help="Uptime Kuma username")
    parser.add_argument("--timeout", type=float, default=60, help="Socket.IO timeout (seconds) for connect/login — a large instance needs more than the library default of 10")
    parser.add_argument("--verbose", action="store_true", help="Print a full traceback when an error aborts the run")
    args = parser.parse_args()

    # Get credentials (only password from environment)
    username = args.username
    password = os.environ.get("UPTIME_KUMA_PASSWORD")

    if not password:
        print("Error: UPTIME_KUMA_PASSWORD environment variable required")
        sys.exit(1)

    # Connect and log in (retrying), then run. `api` stays None when every
    # attempt failed, so `finally` never touches a half-built client.
    print(f"Connecting to {args.url}...")
    api = None

    try:
        api = connect_and_login(args.url, username, password, args.timeout)
        print("Connected successfully")

        if args.export:
            export_monitors(api, args.config + ".exported")
        else:
            # Collected across BOTH config files and checked once, below — a
            # per-file check would let the public config pass while the private
            # one still writes empty values.
            unresolved = set()
            config = load_config(args.config, unresolved)
            if args.extra_config and Path(args.extra_config).exists():
                extra = load_config(args.extra_config, unresolved)
                # Merge groups: append monitors into matching groups, add new groups
                main_by_name = {g["name"]: g for g in config.get("groups", [])}
                for group in extra.get("groups", []):
                    if group["name"] in main_by_name:
                        main_by_name[group["name"]]["monitors"] = (
                            main_by_name[group["name"]].get("monitors", [])
                            + group.get("monitors", [])
                        )
                    else:
                        config.setdefault("groups", []).append(group)
                print(f"Merged extra config from {args.extra_config}")

            # Abort before anything mutating — including under --dry-run, which is
            # the pre-flight and so has to catch this too. SystemExit is not an
            # Exception, so the handler below can't swallow it; `finally` still
            # disconnects cleanly.
            if unresolved:
                print(
                    "\nError: unresolved environment variables in the monitor config:",
                    file=sys.stderr,
                )
                for var_name in sorted(unresolved):
                    print(f"  - {var_name}", file=sys.stderr)
                print(
                    "\nEvery ${VAR} would have been written to live monitors as an empty\n"
                    "string. Nothing was changed. Run via `make uk-sync` (or `make\n"
                    "uk-dry-run`), which wraps this in `op run --env-file=.env.tpl`.",
                    file=sys.stderr,
                )
                sys.exit(EXIT_UNRESOLVED_ENV)

            sync_monitors(api, config, dry_run=args.dry_run, delete_orphans=args.delete_orphans)

    except Exception as e:
        print(f"Error: {format_error(e)}", file=sys.stderr)
        if args.verbose:
            traceback.print_exc()
        sys.exit(1)
    finally:
        if api is not None:
            # A disconnect can itself raise if the socket is already gone; the
            # exit code above is what matters, so swallow it as the retry loop does.
            try:
                api.disconnect()
            except Exception:
                pass


if __name__ == "__main__":
    main()

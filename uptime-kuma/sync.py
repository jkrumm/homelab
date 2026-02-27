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
    doppler run -- uptime-kuma/.venv/bin/python uptime-kuma/sync.py --dry-run

    # Sync monitors
    doppler run -- uptime-kuma/.venv/bin/python uptime-kuma/sync.py

    # Export current monitors to YAML
    doppler run -- uptime-kuma/.venv/bin/python uptime-kuma/sync.py --export

Requirements:
    pip install uptime-kuma-api pyyaml

Environment variables (via Doppler):
    UPTIME_KUMA_PASSWORD: Admin password (required)

Hardcoded defaults (homelab-specific):
    URL: http://localhost:3010
    Username: jkrumm
"""

import argparse
import json
import os
import re
import sys
from pathlib import Path

import yaml
from uptime_kuma_api import UptimeKumaApi, MonitorType


def load_config(config_path: str) -> dict:
    """Load and parse YAML config with environment variable substitution."""
    with open(config_path) as f:
        content = f.read()

    # Substitute environment variables: ${VAR_NAME}
    def replace_env(match):
        var_name = match.group(1)
        value = os.environ.get(var_name, "")
        if not value:
            print(f"Warning: Environment variable {var_name} is not set")
        return value

    content = re.sub(r"\$\{([^}]+)\}", replace_env, content)
    return yaml.safe_load(content)


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
    # Note: Push monitors must be created manually in UI due to library/server version mismatch
    # (uptime-kuma-api 1.2.1 doesn't support Uptime Kuma 2.x push monitor creation)

    # URL
    if "url" in monitor:
        params["url"] = monitor["url"]

    # Docker container
    if "docker_container" in monitor:
        params["docker_container"] = monitor["docker_container"]
        params["docker_host"] = monitor.get("docker_host", 1)  # Default Docker host

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


def sync_monitors(api: UptimeKumaApi, config: dict, dry_run: bool = False):
    """Sync monitors from config to Uptime Kuma."""
    defaults = config.get("settings", {}).get("defaults", {})
    cloudflare_header = config.get("settings", {}).get("cloudflare_bypass_header", {})

    # Get all notification IDs to auto-enable on new monitors
    notification_ids = [n["id"] for n in api.get_notifications()]

    # Get existing monitors
    existing = {m["name"]: m for m in api.get_monitors()}
    processed_names = set()

    def process_monitor(monitor: dict, parent_id: int = None):
        """Process a single monitor (create or update)."""
        name = monitor["name"]
        processed_names.add(name)

        params = build_monitor_params(monitor, defaults, cloudflare_header, parent_id)

        if name in existing:
            # Update existing monitor
            monitor_id = existing[name]["id"]
            if dry_run:
                print(f"  [UPDATE] {name} (id={monitor_id})")
            else:
                try:
                    api.edit_monitor(monitor_id, **params)
                    print(f"  [UPDATED] {name}")
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
                    create_params["notificationIDList"] = notification_ids
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
        group_id = process_monitor(group_config, parent_id)

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
        if dry_run or not sys.stdin.isatty():
            print("\n  (no interactive terminal — run sync.py directly to be prompted for deletion)")
            return
        print("\nDelete these orphaned monitors? [y/N] ", end="", flush=True)
        answer = input().strip().lower()
        if answer == "y":
            for name in sorted(orphaned):
                mid = existing[name]["id"]
                try:
                    api.delete_monitor(mid)
                    print(f"  Deleted: {name} (id={mid})")
                except Exception as e:
                    print(f"  Failed to delete {name} (id={mid}): {e}")
        else:
            print("  Skipped — monitors left untouched.")


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
        if m.get("maxretries"):
            result["maxretries"] = m["maxretries"]
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


def main():
    parser = argparse.ArgumentParser(description="Sync Uptime Kuma monitors from YAML config")
    parser.add_argument("--dry-run", action="store_true", help="Show what would change without making changes")
    parser.add_argument("--export", action="store_true", help="Export current monitors to YAML")
    parser.add_argument("--config", default="uptime-kuma/monitors.yaml", help="Path to monitors.yaml")
    parser.add_argument("--url", default="http://localhost:3010", help="Uptime Kuma URL")
    parser.add_argument("--username", default="jkrumm", help="Uptime Kuma username")
    args = parser.parse_args()

    # Get credentials (only password from environment)
    username = args.username
    password = os.environ.get("UPTIME_KUMA_PASSWORD")

    if not password:
        print("Error: UPTIME_KUMA_PASSWORD environment variable required")
        sys.exit(1)

    # Connect to Uptime Kuma
    print(f"Connecting to {args.url}...")
    api = UptimeKumaApi(args.url)

    try:
        api.login(username, password)
        print("Connected successfully")

        if args.export:
            export_monitors(api, args.config + ".exported")
        else:
            config = load_config(args.config)
            sync_monitors(api, config, dry_run=args.dry_run)

    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)
    finally:
        api.disconnect()


if __name__ == "__main__":
    main()

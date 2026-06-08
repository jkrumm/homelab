"""
Non-interactive MFA re-login for garmin-collector.

Mirrors relogin.py, but instead of prompting on stdin for the 2FA code it
fetches the code from the Garmin "Ihr Sicherheitscode" email via the argo Gmail
API. Driven by the host wrapper scripts/garmin-auto-relogin.sh on a schedule,
gated on the container's health (which already reflects real Garmin auth).

Safety: the current token is stashed to garmin_tokens.json.bak before the fresh
login attempt and restored if login fails, so an automated run can never leave
the collector token-less (the failure mode of a naive delete-then-login).

Env:
  GARMIN_EMAIL, GARMIN_PASSWORD   Garmin Connect credentials (same as server.py)
  TOKEN_DIR                        token store (default /app/tokens)
  ARGO_API_TOKEN                   bearer for the argo Gmail endpoint
  ARGO_BASE_URL                    default https://argo.jkrumm.com/api

Usage:
  python relogin_auto.py              full re-login (deletes/replaces token)
  python relogin_auto.py --check-mail list Garmin code emails only; no login,
                                      no token changes (connectivity self-test)
"""

import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

from garminconnect import Garmin

TOKEN_DIR = os.environ.get("TOKEN_DIR", "/app/tokens")
EMAIL = os.environ.get("GARMIN_EMAIL", "")
PASSWORD = os.environ.get("GARMIN_PASSWORD", "")
ARGO_TOKEN = os.environ.get("ARGO_API_TOKEN", "")
ARGO_BASE = os.environ.get("ARGO_BASE_URL", "https://argo.jkrumm.com/api").rstrip("/")

# Only Garmin's one-time-code sender. newer_than caps the window so a stale code
# can't be picked up; the pre-login id snapshot is the real dedup. scope=all so
# an inbox auto-archive rule can't hide a freshly-delivered code.
MFA_QUERY = "from:alerts@account.garmin.com newer_than:1h"
POLL_TIMEOUT_S = 150  # delivery is usually <30s; allow generous slack
POLL_INTERVAL_S = 6
TOKEN_FILE = os.path.join(TOKEN_DIR, "garmin_tokens.json")
BACKUP_FILE = TOKEN_FILE + ".bak"


def _argo_get(path: str) -> object:
    req = urllib.request.Request(
        f"{ARGO_BASE}{path}",
        headers={"Authorization": f"Bearer {ARGO_TOKEN}"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())


def _list_code_emails() -> list[dict]:
    q = urllib.parse.urlencode(
        {"query": MFA_QUERY, "days": "1", "maxResults": "10", "scope": "all"}
    )
    data = _argo_get(f"/gmail/emails?{q}")
    return data if isinstance(data, list) else []


def _extract_code(body: str) -> str | None:
    # Garmin template: "... hier ist Ihr Sicherheitscode. 036567 Nutzen Sie ..."
    # (English: "... your security code. 123456 ..."). Anchor on the label so the
    # CSS hex colours (#000000 etc.) that survive HTML-stripping can't match.
    m = re.search(r"(?:Sicherheitscode|security code)[\s.:]*?(\d{6})\b", body, re.I)
    if m:
        return m.group(1)
    # Fallback: drop #rrggbb tokens, then take the first standalone 6-digit run.
    cleaned = re.sub(r"#[0-9a-fA-F]{6}\b", " ", body)
    m = re.search(r"(?<![\d#])(\d{6})(?!\d)", cleaned)
    return m.group(1) if m else None


def _make_prompt_mfa(seen_ids: set[str]):
    """Build the prompt_mfa callback closed over the pre-login email snapshot."""

    def fetch_mfa_code() -> str:
        print(f"Waiting for Garmin MFA email (had {len(seen_ids)} prior)…", flush=True)
        deadline = time.monotonic() + POLL_TIMEOUT_S
        while time.monotonic() < deadline:
            time.sleep(POLL_INTERVAL_S)
            try:
                fresh = [e for e in _list_code_emails() if e["id"] not in seen_ids]
            except Exception as e:  # transient argo/network hiccup — keep polling
                print(f"  poll error (retrying): {e}", flush=True)
                continue
            for e in sorted(fresh, key=lambda x: x.get("date", ""), reverse=True):
                detail = _argo_get(f"/gmail/emails/{e['id']}")
                body = detail.get("body", "") if isinstance(detail, dict) else ""
                code = _extract_code(body)
                if code:
                    print(f"Got MFA code from email {e['id']}", flush=True)
                    return code
                print(f"  email {e['id']} had no extractable code", flush=True)
        raise RuntimeError(f"no Garmin MFA code arrived within {POLL_TIMEOUT_S}s")

    return fetch_mfa_code


def check_mail() -> int:
    emails = _list_code_emails()
    print(f"argo Gmail reachable — {len(emails)} Garmin code email(s) in window")
    for e in emails:
        print(f"  {e['id']}  {e.get('date')}  {e.get('subject')}")
    return 0


def relogin() -> int:
    os.makedirs(TOKEN_DIR, exist_ok=True)

    # Stash the current token (rather than delete) so a failed login can be rolled
    # back. With no live token file present, garminconnect skips the cached-token
    # path and goes straight to fresh email/password + MFA — which is the point.
    if os.path.exists(TOKEN_FILE):
        os.replace(TOKEN_FILE, BACKUP_FILE)
        print(f"Stashed current token -> {BACKUP_FILE}", flush=True)

    # Snapshot existing code emails BEFORE login triggers a new one, so we only
    # ever accept the freshly-sent code (no clock-skew or fast-delivery races).
    try:
        seen_ids = {e["id"] for e in _list_code_emails()}
    except Exception as e:
        _restore_token()
        sys.exit(f"argo Gmail unreachable, aborting before login: {e}")

    print(f"Logging in as {EMAIL} (tokens -> {TOKEN_DIR})", flush=True)
    try:
        client = Garmin(EMAIL, PASSWORD, prompt_mfa=_make_prompt_mfa(seen_ids))
        client.login(tokenstore=TOKEN_DIR)
    except Exception:
        _restore_token()
        raise

    # One-shot runs as root so it can replace the live ('app') user's file; the
    # live container reads it back, so it needs world-read.
    if os.path.exists(TOKEN_FILE):
        os.chmod(TOKEN_FILE, 0o644)
    if os.path.exists(BACKUP_FILE):
        os.remove(BACKUP_FILE)
    print("Login OK — tokens persisted", flush=True)
    return 0


def _restore_token() -> None:
    if os.path.exists(BACKUP_FILE) and not os.path.exists(TOKEN_FILE):
        os.replace(BACKUP_FILE, TOKEN_FILE)
        print("Login failed — restored previous token", flush=True)


if __name__ == "__main__":
    if not EMAIL or not PASSWORD:
        sys.exit("GARMIN_EMAIL and GARMIN_PASSWORD must be set")
    if not ARGO_TOKEN:
        sys.exit("ARGO_API_TOKEN must be set for automated MFA retrieval")
    if "--check-mail" in sys.argv[1:]:
        sys.exit(check_mail())
    sys.exit(relogin())

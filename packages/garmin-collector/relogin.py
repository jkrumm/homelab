"""
Interactive MFA re-login for garmin-collector.

Garmin Connect refresh tokens expire periodically and re-auth then requires a
2FA code from the authenticator app. The live FastAPI service has no
interactive stdin, so this script runs in a one-shot sibling container
(`make garmin-relogin`) that shares the same env vars and token volume.

After this writes a fresh `garmin_tokens.json` to /app/tokens, the live
container must be restarted so it re-reads the file (`make garmin-restart`,
which the Makefile target chains automatically).
"""

import os
import sys

from garminconnect import Garmin

TOKEN_DIR = os.environ.get("TOKEN_DIR", "/app/tokens")
email = os.environ.get("GARMIN_EMAIL", "")
password = os.environ.get("GARMIN_PASSWORD", "")

if not email or not password:
    sys.exit("GARMIN_EMAIL and GARMIN_PASSWORD must be set")


def prompt_mfa() -> str:
    return input("Enter Garmin MFA code: ").strip()


os.makedirs(TOKEN_DIR, exist_ok=True)

# Wipe any existing token file — garminconnect.login() tries cached tokens
# first and raises immediately on 401 instead of falling through to fresh
# email/password + MFA. This script is only ever invoked when re-auth is
# needed, so removing the stale tokens is the point.
stale = os.path.join(TOKEN_DIR, "garmin_tokens.json")
if os.path.exists(stale):
    os.remove(stale)
    print(f"Removed stale {stale}", flush=True)

print(f"Logging in as {email} (tokens -> {TOKEN_DIR})", flush=True)
client = Garmin(email, password, prompt_mfa=prompt_mfa)
client.login(tokenstore=TOKEN_DIR)

# This one-shot runs as root (so it can delete the prior owner's stale file);
# the live container runs as 'app' and needs read access to the new token.
new_file = os.path.join(TOKEN_DIR, "garmin_tokens.json")
if os.path.exists(new_file):
    os.chmod(new_file, 0o644)

print("Login OK — tokens persisted", flush=True)

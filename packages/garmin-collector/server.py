"""
Garmin Connect HTTP collector — stateless query layer over the garminconnect lib.

Lives on homelab. The argo API on VPS calls this over Tailscale (garmin.jkrumm.com)
on its own cron schedule and upserts into its SQLite. This service holds the OAuth
tokens, never the data.

Endpoints (all bearer-authed except /health):
  GET /health                         → {"status":"ok"}
  GET /status                         → {"login_at": iso, "token_dir": str}
  GET /daily-metrics?from=&to=        → [{"date": "...", "steps": ..., ...}]
  GET /activities?from=&to=           → [{"activity_id": ..., ...}]

`from` and `to` are inclusive YYYY-MM-DD; `to` defaults to today, `from` to (today − 7).
Activity types in ACTIVITY_SKIP_TYPES are filtered server-side.
"""

import logging
import os
import sys
import threading
from datetime import date, datetime, timedelta, timezone

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from garminconnect import Garmin

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger("garmin-collector")

TOKEN_DIR = os.environ.get("TOKEN_DIR", "/app/tokens")
GARMIN_EMAIL = os.environ.get("GARMIN_EMAIL", "")
GARMIN_PASSWORD = os.environ.get("GARMIN_PASSWORD", "")
BEARER_TOKEN = os.environ.get("GARMIN_COLLECTOR_TOKEN", "")
DEFAULT_BACKFILL_DAYS = int(os.environ.get("DEFAULT_BACKFILL_DAYS", "7"))
ACTIVITY_SKIP_TYPES = frozenset(
    os.environ.get("ACTIVITY_SKIP_TYPES", "walking").split(",")
)

if not GARMIN_EMAIL or not GARMIN_PASSWORD:
    raise SystemExit("GARMIN_EMAIL and GARMIN_PASSWORD must be set")
if not BEARER_TOKEN:
    raise SystemExit("GARMIN_COLLECTOR_TOKEN must be set")

# Single global Garmin client. garminconnect persists OAuth tokens to TOKEN_DIR
# and silently refreshes them on use. A login is only fetched on cold start (and
# again if Garmin invalidates the refresh token, which is rare).
_client: Garmin | None = None
_login_at: str | None = None
_lock = threading.Lock()


def get_client() -> Garmin:
    global _client, _login_at
    with _lock:
        if _client is None:
            log.info("Initializing Garmin client (token_dir=%s)", TOKEN_DIR)
            os.makedirs(TOKEN_DIR, exist_ok=True)
            client = Garmin(GARMIN_EMAIL, GARMIN_PASSWORD)
            client.login(tokenstore=TOKEN_DIR)
            _client = client
            _login_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            log.info("Garmin login successful")
        return _client


# ── FastAPI app ─────────────────────────────────────────────────────────────

app = FastAPI(title="garmin-collector", version="0.1.0")
auth_scheme = HTTPBearer(auto_error=False)


def require_bearer(creds: HTTPAuthorizationCredentials | None = Depends(auth_scheme)):
    if creds is None or creds.scheme.lower() != "bearer" or creds.credentials != BEARER_TOKEN:
        raise HTTPException(status_code=401, detail="Unauthorized")


def parse_window(
    date_from: str | None, date_to: str | None
) -> tuple[str, str]:
    today = date.today()
    end = date.fromisoformat(date_to) if date_to else today
    start = date.fromisoformat(date_from) if date_from else end - timedelta(days=DEFAULT_BACKFILL_DAYS)
    if start > end:
        raise HTTPException(status_code=400, detail="from must be <= to")
    return str(start), str(end)


# ── Daily-metric extraction (mirrors the original sync.py fetch_day) ────────


def fetch_day(client: Garmin, target_date: str) -> dict:
    metrics: dict = {"date": target_date}

    try:
        stats = client.get_stats(target_date)
        metrics.update({
            "steps": stats.get("totalSteps"),
            "distance_m": stats.get("totalDistanceMeters"),
            "total_kcal": stats.get("totalKilocalories"),
            "active_kcal": stats.get("activeKilocalories"),
            "floors_ascended": stats.get("floorsAscended"),
            "moderate_intensity_min": stats.get("moderateIntensityMinutes"),
            "vigorous_intensity_min": stats.get("vigorousIntensityMinutes"),
            "avg_stress": stats.get("averageStressLevel"),
            "max_stress": stats.get("maxStressLevel"),
            "bb_highest": stats.get("bodyBatteryHighestValue"),
            "bb_lowest": stats.get("bodyBatteryLowestValue"),
            "bb_charged": stats.get("bodyBatteryChargedValue"),
            "bb_drained": stats.get("bodyBatteryDrainedValue"),
        })
    except Exception as e:
        log.warning("stats failed for %s: %s", target_date, e)

    try:
        hr = client.get_heart_rates(target_date)
        metrics.update({
            "resting_hr": hr.get("restingHeartRate"),
            "max_hr": hr.get("maxHeartRate"),
            "min_hr": hr.get("minHeartRate"),
        })
    except Exception as e:
        log.warning("heart_rates failed for %s: %s", target_date, e)

    try:
        hrv = client.get_hrv_data(target_date)
        summary = (hrv or {}).get("hrvSummary") or {}
        metrics.update({
            "hrv_last_night_avg": summary.get("lastNightAvg"),
            "hrv_last_night_5min_high": summary.get("lastNight5MinHigh"),
            "hrv_weekly_avg": summary.get("weeklyAvg"),
            "hrv_status": summary.get("status"),
        })
    except Exception as e:
        log.warning("hrv_data failed for %s: %s", target_date, e)

    try:
        sleep = client.get_sleep_data(target_date)
        dto = sleep.get("dailySleepDTO") or {}
        scores = dto.get("sleepScores") or {}
        overall = scores.get("overall") or {}
        metrics.update({
            "sleep_score": overall.get("value"),
            "sleep_duration_sec": dto.get("sleepTimeSeconds"),
            "deep_sleep_sec": dto.get("deepSleepSeconds"),
            "light_sleep_sec": dto.get("lightSleepSeconds"),
            "rem_sleep_sec": dto.get("remSleepSeconds"),
            "awake_sleep_sec": dto.get("awakeSleepSeconds"),
            "avg_sleep_stress": dto.get("avgSleepStress"),
            "avg_sleep_hr": dto.get("avgHeartRate"),
            "avg_sleep_respiration": dto.get("averageRespirationValue"),
        })
    except Exception as e:
        log.warning("sleep_data failed for %s: %s", target_date, e)

    try:
        resp = client.get_respiration_data(target_date)
        metrics["avg_waking_respiration"] = resp.get("avgWakingRespirationValue")
    except Exception as e:
        log.warning("respiration_data failed for %s: %s", target_date, e)

    try:
        spo2 = client.get_spo2_data(target_date)
        metrics.update({
            "avg_spo2": spo2.get("averageSpO2"),
            "lowest_spo2": spo2.get("lowestSpO2"),
        })
    except Exception as e:
        log.warning("spo2_data failed for %s: %s", target_date, e)

    try:
        mm = client.get_max_metrics(target_date)
        if isinstance(mm, list) and mm:
            generic = mm[0].get("generic") or {}
            metrics["vo2_max"] = generic.get("vo2MaxPreciseValue")
    except Exception as e:
        log.warning("max_metrics failed for %s: %s", target_date, e)

    return metrics


def fetch_activities(client: Garmin, start: str, end: str) -> list[dict]:
    raw = client.get_activities_by_date(start, end) or []
    out: list[dict] = []
    for a in raw:
        type_key = (a.get("activityType") or {}).get("typeKey")
        if not type_key or type_key in ACTIVITY_SKIP_TYPES:
            continue
        start_local = a.get("startTimeLocal")
        if not start_local:
            continue
        out.append({
            "activity_id": a.get("activityId"),
            "date": start_local[:10],
            "start_time_local": start_local,
            "type_key": type_key,
            "activity_name": a.get("activityName"),
            "duration_sec": a.get("duration"),
            "distance_m": a.get("distance"),
            "calories": a.get("calories"),
            "avg_hr": a.get("averageHR"),
            "max_hr": a.get("maxHR"),
            "aerobic_te": a.get("aerobicTrainingEffect"),
            "anaerobic_te": a.get("anaerobicTrainingEffect"),
            "training_effect_label": a.get("trainingEffectLabel"),
            "training_load": a.get("activityTrainingLoad"),
            "moderate_intensity_min": a.get("moderateIntensityMinutes"),
            "vigorous_intensity_min": a.get("vigorousIntensityMinutes"),
            "hr_zone_1_sec": a.get("hrTimeInZone_1"),
            "hr_zone_2_sec": a.get("hrTimeInZone_2"),
            "hr_zone_3_sec": a.get("hrTimeInZone_3"),
            "hr_zone_4_sec": a.get("hrTimeInZone_4"),
            "hr_zone_5_sec": a.get("hrTimeInZone_5"),
            "bb_delta": a.get("differenceBodyBattery"),
            "steps": a.get("steps"),
            "vo2_max": a.get("vO2MaxValue"),
        })
    return out


# ── Routes ──────────────────────────────────────────────────────────────────


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/status", dependencies=[Depends(require_bearer)])
def status():
    # Don't trigger login from /status — just report current state.
    return {
        "login_at": _login_at,
        "logged_in": _client is not None,
        "token_dir": TOKEN_DIR,
    }


@app.get("/daily-metrics", dependencies=[Depends(require_bearer)])
def daily_metrics(
    date_from: str | None = Query(None, alias="from"),
    date_to: str | None = Query(None, alias="to"),
):
    start, end = parse_window(date_from, date_to)
    client = get_client()
    out = []
    cur = date.fromisoformat(start)
    last = date.fromisoformat(end)
    while cur <= last:
        out.append(fetch_day(client, str(cur)))
        cur += timedelta(days=1)
    return out


@app.get("/activities", dependencies=[Depends(require_bearer)])
def activities(
    date_from: str | None = Query(None, alias="from"),
    date_to: str | None = Query(None, alias="to"),
):
    start, end = parse_window(date_from, date_to)
    client = get_client()
    return fetch_activities(client, start, end)

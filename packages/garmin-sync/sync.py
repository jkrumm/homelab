"""
Garmin Connect → SQLite daily metrics sync.
Runs on a 6-hour loop, fetches rolling 7-day window, upserts to daily_metrics table.
Pings UptimeKuma push monitor on success.
"""

import logging
import os
import sqlite3
import sys
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone

from garminconnect import Garmin

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger("garmin-sync")

DB_PATH = os.environ.get("DB_PATH", "/app/data/homelab.db")
TOKEN_DIR = os.environ.get("TOKEN_DIR", "/app/tokens")
SYNC_INTERVAL = int(os.environ.get("SYNC_INTERVAL", "21600"))  # 6 hours
BACKFILL_DAYS = int(os.environ.get("BACKFILL_DAYS", "7"))
UPTIME_KUMA_PUSH_URL = os.environ.get("UPTIME_KUMA_PUSH_URL", "")
GARMIN_EMAIL = os.environ.get("GARMIN_EMAIL", "")
GARMIN_PASSWORD = os.environ.get("GARMIN_PASSWORD", "")


def get_garmin_client() -> Garmin:
    """Create and authenticate Garmin client with token persistence."""
    client = Garmin(GARMIN_EMAIL, GARMIN_PASSWORD)
    os.makedirs(TOKEN_DIR, exist_ok=True)
    client.login(tokenstore=TOKEN_DIR)
    log.info("Garmin login successful")
    return client


def fetch_day(client: Garmin, target_date: str) -> dict:
    """Fetch all daily endpoints for a single date, return flat metric dict."""
    metrics = {"date": target_date}

    # Stats (activity + stress + body battery)
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

    # Heart rates
    try:
        hr = client.get_heart_rates(target_date)
        metrics.update({
            "resting_hr": hr.get("restingHeartRate"),
            "max_hr": hr.get("maxHeartRate"),
            "min_hr": hr.get("minHeartRate"),
        })
    except Exception as e:
        log.warning("heart_rates failed for %s: %s", target_date, e)

    # HRV
    try:
        hrv = client.get_hrv_data(target_date)
        summary = hrv.get("hrvSummary") or {}
        metrics.update({
            "hrv_last_night_avg": summary.get("lastNightAvg"),
            "hrv_last_night_5min_high": summary.get("lastNight5MinHigh"),
            "hrv_weekly_avg": summary.get("weeklyAvg"),
            "hrv_status": summary.get("status"),
        })
    except Exception as e:
        log.warning("hrv_data failed for %s: %s", target_date, e)

    # Sleep
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

    # Respiration
    try:
        resp = client.get_respiration_data(target_date)
        metrics["avg_waking_respiration"] = resp.get("avgWakingRespirationValue")
    except Exception as e:
        log.warning("respiration_data failed for %s: %s", target_date, e)

    # SpO2
    try:
        spo2 = client.get_spo2_data(target_date)
        metrics.update({
            "avg_spo2": spo2.get("averageSpO2"),
            "lowest_spo2": spo2.get("lowestSpO2"),
        })
    except Exception as e:
        log.warning("spo2_data failed for %s: %s", target_date, e)

    # VO2 Max
    try:
        mm = client.get_max_metrics(target_date)
        if isinstance(mm, list) and mm:
            generic = mm[0].get("generic") or {}
            metrics["vo2_max"] = generic.get("vo2MaxPreciseValue")
    except Exception as e:
        log.warning("max_metrics failed for %s: %s", target_date, e)

    return metrics


def is_day_complete(target_date: str) -> bool:
    """A day is complete if it ended more than 6 hours ago (buffer for late syncs)."""
    day_end = datetime(
        *date.fromisoformat(target_date).timetuple()[:3],
        tzinfo=timezone.utc,
    ) + timedelta(days=1)
    return datetime.now(timezone.utc) - day_end >= timedelta(hours=6)


def upsert_metrics(conn: sqlite3.Connection, metrics: dict):
    """Upsert a day's metrics. Only overwrites non-null values with non-null values."""
    target_date = metrics["date"]
    completed = 1 if is_day_complete(target_date) else 0
    synced_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    # Check if row exists
    existing = conn.execute(
        "SELECT * FROM daily_metrics WHERE date = ?", (target_date,)
    ).fetchone()

    if existing is None:
        # Insert new row
        metrics["completed"] = completed
        metrics["synced_at"] = synced_at
        cols = ", ".join(metrics.keys())
        placeholders = ", ".join(["?"] * len(metrics))
        conn.execute(
            f"INSERT INTO daily_metrics ({cols}) VALUES ({placeholders})",
            list(metrics.values()),
        )
        log.info("Inserted %s (completed=%d)", target_date, completed)
    else:
        # Update: only overwrite with non-null values, preserve existing non-null
        updates = []
        values = []
        for key, new_val in metrics.items():
            if key == "date":
                continue
            if new_val is not None:
                updates.append(f"{key} = ?")
                values.append(new_val)
            # If new_val is None but existing has a value, keep existing (do nothing)

        # Always update meta fields
        updates.append("synced_at = ?")
        values.append(synced_at)
        updates.append("completed = ?")
        values.append(completed)

        values.append(target_date)
        conn.execute(
            f"UPDATE daily_metrics SET {', '.join(updates)} WHERE date = ?",
            values,
        )
        log.info("Updated %s (completed=%d)", target_date, completed)


def ping_uptime_kuma(status: str = "up", msg: str = ""):
    """Ping UptimeKuma push monitor."""
    if not UPTIME_KUMA_PUSH_URL:
        log.debug("No UPTIME_KUMA_PUSH_URL configured, skipping ping")
        return
    try:
        url = f"{UPTIME_KUMA_PUSH_URL}?status={status}&msg={urllib.parse.quote(msg)}"
        urllib.request.urlopen(url, timeout=10)
        log.info("UptimeKuma ping: %s — %s", status, msg)
    except Exception as e:
        log.warning("UptimeKuma ping failed: %s", e)


def run_sync():
    """Execute one sync cycle."""
    log.info("Starting sync cycle (backfill=%d days)", BACKFILL_DAYS)

    client = get_garmin_client()

    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=30000")

    days_synced = 0
    days_skipped = 0
    errors = 0

    for i in range(BACKFILL_DAYS, -1, -1):  # oldest first
        target_date = str(date.today() - timedelta(days=i))

        # Skip completed days
        row = conn.execute(
            "SELECT completed FROM daily_metrics WHERE date = ?", (target_date,)
        ).fetchone()
        if row and row[0] == 1:
            days_skipped += 1
            continue

        try:
            metrics = fetch_day(client, target_date)
            upsert_metrics(conn, metrics)
            conn.commit()
            days_synced += 1
        except Exception as e:
            log.error("Failed to sync %s: %s", target_date, e)
            errors += 1

    conn.close()

    msg = f"synced={days_synced} skipped={days_skipped} errors={errors}"
    log.info("Sync cycle complete: %s", msg)

    if errors == 0:
        ping_uptime_kuma("up", msg)
    else:
        ping_uptime_kuma("down", msg)


def main():
    log.info("Garmin sync starting (interval=%ds, backfill=%d days)", SYNC_INTERVAL, BACKFILL_DAYS)

    if not GARMIN_EMAIL or not GARMIN_PASSWORD:
        log.error("GARMIN_EMAIL and GARMIN_PASSWORD must be set")
        sys.exit(1)

    while True:
        try:
            run_sync()
        except Exception as e:
            log.error("Sync cycle failed: %s", e, exc_info=True)
            ping_uptime_kuma("down", str(e))

        log.info("Sleeping %ds until next sync", SYNC_INTERVAL)
        time.sleep(SYNC_INTERVAL)


if __name__ == "__main__":
    main()

"""
Garmin Connect → SQLite daily metrics sync.
Polls every POLL_INTERVAL seconds; runs a sync when either:
  - sync_control.refresh_requested = 1 (manual trigger from API), or
  - now - last_completed_at >= SYNC_INTERVAL (scheduled cadence).
Fetches rolling 7-day window, upserts to daily_metrics table.
Pings UptimeKuma push monitor on success/failure.
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
SYNC_INTERVAL = int(os.environ.get("SYNC_INTERVAL", "14400"))  # 4 hours
POLL_INTERVAL = int(os.environ.get("POLL_INTERVAL", "30"))  # control-flag poll cadence
# Daily "wrap-up" sync hour (local time, 0-23). Set to -1 to disable.
# Default 22 (10pm) — by then today's daily aggregates are essentially final,
# so the dashboard can show today's row instead of waiting for the next 4h tick.
EVENING_SYNC_HOUR = int(os.environ.get("EVENING_SYNC_HOUR", "22"))
BACKFILL_DAYS = int(os.environ.get("BACKFILL_DAYS", "7"))
# When the activities table is empty, fetch this many days back. Single API call so cheap.
ACTIVITIES_INITIAL_BACKFILL_DAYS = int(os.environ.get("ACTIVITIES_INITIAL_BACKFILL_DAYS", "60"))
# Activity types to skip on upsert. Walking dominates the count and contributes ~3% of load —
# the activities chart shows intentional workouts only.
ACTIVITY_SKIP_TYPES = frozenset(
    os.environ.get("ACTIVITY_SKIP_TYPES", "walking").split(",")
)
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


def fetch_activities(client: Garmin, start: str, end: str) -> list[dict]:
    """Fetch activity summaries between start..end (yyyy-mm-dd, inclusive). Filters out skip types."""
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


def upsert_activities(conn: sqlite3.Connection, records: list[dict]) -> int:
    """INSERT OR REPLACE all activity records. Activities can be retroactively
    enriched by Garmin (load/TE updates), so we always rewrite."""
    if not records:
        return 0
    synced_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    cols = list(records[0].keys()) + ["synced_at"]
    placeholders = ", ".join(["?"] * len(cols))
    cols_str = ", ".join(cols)
    for r in records:
        values = [r.get(c) for c in records[0].keys()] + [synced_at]
        conn.execute(
            f"INSERT OR REPLACE INTO garmin_activities ({cols_str}) VALUES ({placeholders})",
            values,
        )
    return len(records)


def sync_activities(client: Garmin, conn: sqlite3.Connection) -> tuple[int, str]:
    """Fetch activities for a rolling window. Uses initial backfill if table empty."""
    existing = conn.execute("SELECT COUNT(*) FROM garmin_activities").fetchone()[0]
    window_days = ACTIVITIES_INITIAL_BACKFILL_DAYS if existing == 0 else BACKFILL_DAYS
    end_date = str(date.today())
    start_date = str(date.today() - timedelta(days=window_days))
    records = fetch_activities(client, start_date, end_date)
    n = upsert_activities(conn, records)
    conn.commit()
    msg = f"window={window_days}d records={n}{' (initial)' if existing == 0 else ''}"
    log.info("Activities sync: %s", msg)
    return n, msg


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


def run_sync() -> tuple[int, str]:
    """Execute one sync cycle. Returns (errors, msg)."""
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

    # Activities — single API call covering the whole window
    activities_msg = ""
    try:
        _, activities_msg = sync_activities(client, conn)
    except Exception as e:
        log.error("Activities sync failed: %s", e)
        errors += 1
        activities_msg = f"error: {e}"

    conn.close()

    msg = f"synced={days_synced} skipped={days_skipped} errors={errors} activities[{activities_msg}]"
    log.info("Sync cycle complete: %s", msg)

    if errors == 0:
        ping_uptime_kuma("up", msg)
    else:
        ping_uptime_kuma("down", msg)

    return errors, msg


# ── Control-flag helpers (cross-process via shared SQLite) ──────────────────


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def control_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=30000")
    return conn


def ensure_control_row():
    """Create sync_control table + seed singleton row. Idempotent — API does the same on startup."""
    conn = control_conn()
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS sync_control (
                id INTEGER PRIMARY KEY DEFAULT 1,
                refresh_requested INTEGER DEFAULT 0,
                requested_at TEXT,
                in_progress INTEGER DEFAULT 0,
                last_started_at TEXT,
                last_completed_at TEXT,
                last_status TEXT,
                last_message TEXT
            )
            """
        )
        conn.execute("INSERT OR IGNORE INTO sync_control (id) VALUES (1)")
        conn.commit()
    finally:
        conn.close()


def should_run_now() -> tuple[bool, str]:
    """Decide whether to run a sync this tick. Returns (should_run, reason)."""
    conn = control_conn()
    try:
        row = conn.execute(
            "SELECT refresh_requested, last_completed_at FROM sync_control WHERE id = 1"
        ).fetchone()
    finally:
        conn.close()

    if row is None:
        return True, "no-control-row"

    refresh_requested, last_completed_at = row
    if refresh_requested:
        return True, "manual-refresh"

    if not last_completed_at:
        return True, "first-run"

    try:
        last = datetime.strptime(last_completed_at, "%Y-%m-%dT%H:%M:%SZ").replace(
            tzinfo=timezone.utc
        )
    except ValueError:
        return True, "unparseable-timestamp"

    elapsed = (datetime.now(timezone.utc) - last).total_seconds()
    if elapsed >= SYNC_INTERVAL:
        return True, f"scheduled (elapsed={int(elapsed)}s)"

    # Evening wrap-up sync: trigger once per day after EVENING_SYNC_HOUR if the
    # last completed sync was earlier than that hour today (i.e. we haven't yet
    # captured today's near-final aggregates).
    if 0 <= EVENING_SYNC_HOUR <= 23:
        now_local = datetime.now().astimezone()
        last_local = last.astimezone(now_local.tzinfo)
        threshold_today = now_local.replace(
            hour=EVENING_SYNC_HOUR, minute=0, second=0, microsecond=0
        )
        if now_local >= threshold_today and last_local < threshold_today:
            return True, f"evening-wrap (>{EVENING_SYNC_HOUR:02d}:00 local)"

    return False, ""


def mark_started():
    conn = control_conn()
    try:
        conn.execute(
            """
            UPDATE sync_control
            SET in_progress = 1,
                last_started_at = ?,
                refresh_requested = 0
            WHERE id = 1
            """,
            (now_iso(),),
        )
        conn.commit()
    finally:
        conn.close()


def mark_finished(status: str, message: str):
    conn = control_conn()
    try:
        conn.execute(
            """
            UPDATE sync_control
            SET in_progress = 0,
                last_completed_at = ?,
                last_status = ?,
                last_message = ?
            WHERE id = 1
            """,
            (now_iso(), status, message),
        )
        conn.commit()
    finally:
        conn.close()


def main():
    log.info(
        "Garmin sync starting (sync_interval=%ds, poll_interval=%ds, backfill=%d days)",
        SYNC_INTERVAL,
        POLL_INTERVAL,
        BACKFILL_DAYS,
    )

    if not GARMIN_EMAIL or not GARMIN_PASSWORD:
        log.error("GARMIN_EMAIL and GARMIN_PASSWORD must be set")
        sys.exit(1)

    ensure_control_row()

    while True:
        try:
            should_run, reason = should_run_now()
            if should_run:
                log.info("Running sync (reason=%s)", reason)
                mark_started()
                try:
                    errors, msg = run_sync()
                    mark_finished("ok" if errors == 0 else "error", msg)
                except Exception as e:
                    log.error("Sync cycle failed: %s", e, exc_info=True)
                    mark_finished("error", str(e))
                    ping_uptime_kuma("down", str(e))
        except Exception as e:
            log.error("Loop tick failed: %s", e, exc_info=True)

        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()

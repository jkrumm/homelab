#!/usr/bin/env python3
"""Regression suite for the unresolved-`${VAR}` guard in `uptime-kuma/sync.py`.

On 2026-08-01 a deleted 1Password item broke `op run` wholesale; a later bare
`sync.py` invocation (no `op run` wrapper) substituted every `${VAR}` in
monitors.yaml with an empty string and wrote it straight into live monitors —
three URLs became `http://:PORT/...`, three bearer tokens went empty, six
monitors went down for ~17h. `load_config()`'s unresolved-name collection plus
`main()`'s abort-before-mutation gate (exit `EXIT_UNRESOLVED_ENV` = 2) is the
only thing standing between a bare invocation and a repeat. This suite pins
the properties that guard depends on.

Safety model — this suite NEVER reaches a real Uptime Kuma server:
`uptime_kuma_api` (the real package) is not installed in this interpreter, so
a fake module is injected into `sys.modules` *before* `sync.py` is imported.
The fake `UptimeKumaApi` opens no socket; every call it makes (login,
get_notifications, get_monitors, add_monitor, edit_monitor, delete_monitor,
disconnect) is only ever recorded to an in-memory call log. Tests that expect
the guard to abort assert the call log is empty for the API-touching methods
— a runtime tripwire, not code inspection. All config fixtures are temp YAML
files; the real `monitors.yaml` is only ever opened read-only, for the
non-env-literal grep in group 8.

Run (system `python3` on this Mac lacks pyyaml; `uptime-kuma/.venv` only
exists on the homelab server itself, since sync.py is documented to run
there — the hermes-agent venv is the closest local interpreter that already
has pyyaml, so it doubles as the standalone runner here):

    ~/.hermes/hermes-agent/venv/bin/python3 tests/test_uptime_kuma_sync_guard.py

Exit status is 0 only when every case matches.
"""

import importlib.util
import io
import os
import re
import sys
import tempfile
import types
from contextlib import contextmanager, redirect_stderr, redirect_stdout
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SYNC_PATH = REPO_ROOT / "uptime-kuma" / "sync.py"
MAIN_MONITORS_YAML = REPO_ROOT / "uptime-kuma" / "monitors.yaml"
PRIVATE_MONITORS_YAML = (
    REPO_ROOT.parent / "homelab-private" / "uptime-kuma" / "monitors.yaml"
)


# =============================================================================
# Fake uptime_kuma_api — no socket, ever. Injected into sys.modules before
# sync.py is imported, so `from uptime_kuma_api import UptimeKumaApi,
# MonitorType` binds to this instead of touching pip/network.
# =============================================================================

FAKE_KUMA_STATE = {"calls": [], "login_fail": False}

# Calls sync.py only makes once it is actually mutating/reading live monitor
# state (inside sync_monitors() or export_monitors()) — never on the
# guard-abort path. "login"/"disconnect"/"__init__" are excluded: main()
# calls those unconditionally, before the guard even runs.
API_TOUCHING_METHODS = {
    "get_notifications",
    "get_monitors",
    "add_monitor",
    "edit_monitor",
    "delete_monitor",
}


def reset_fake_kuma():
    FAKE_KUMA_STATE["calls"] = []
    FAKE_KUMA_STATE["login_fail"] = False


def api_touching_calls():
    return [c for c in FAKE_KUMA_STATE["calls"] if c[0] in API_TOUCHING_METHODS]


class FakeMonitorType:
    HTTP = "http"
    KEYWORD = "keyword"
    DOCKER = "docker"
    PUSH = "push"
    MYSQL = "mysql"
    GROUP = "group"
    PING = "ping"
    PORT = "port"
    DNS = "dns"


class FakeUptimeKumaApi:
    """Records every call; opens no socket; never reaches a real server."""

    def __init__(self, url):
        FAKE_KUMA_STATE["calls"].append(("__init__", url))

    def login(self, username, password):
        FAKE_KUMA_STATE["calls"].append(("login", username))
        if FAKE_KUMA_STATE["login_fail"]:
            raise RuntimeError("fake login failure (simulated, no real network)")

    def disconnect(self):
        FAKE_KUMA_STATE["calls"].append(("disconnect",))

    def get_notifications(self):
        FAKE_KUMA_STATE["calls"].append(("get_notifications",))
        return []

    def get_monitors(self):
        FAKE_KUMA_STATE["calls"].append(("get_monitors",))
        return []

    def add_monitor(self, **kwargs):
        FAKE_KUMA_STATE["calls"].append(("add_monitor", kwargs.get("name")))
        return {"monitorID": 999}

    def edit_monitor(self, monitor_id, **kwargs):
        FAKE_KUMA_STATE["calls"].append(("edit_monitor", monitor_id))
        return True

    def delete_monitor(self, monitor_id):
        FAKE_KUMA_STATE["calls"].append(("delete_monitor", monitor_id))
        return True


def _install_fake_uptime_kuma_api():
    fake_mod = types.ModuleType("uptime_kuma_api")
    fake_mod.UptimeKumaApi = FakeUptimeKumaApi
    fake_mod.MonitorType = FakeMonitorType
    sys.modules["uptime_kuma_api"] = fake_mod


_install_fake_uptime_kuma_api()

_spec = importlib.util.spec_from_file_location("uk_sync_under_test", SYNC_PATH)
sync = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(sync)  # module-level `from uptime_kuma_api import ...`
# resolves against the fake installed above — `if __name__ == "__main__"` does
# not fire here, so main() only ever runs when this suite calls it.


# =============================================================================
# Harness — scoped env + captured main() invocation.
# =============================================================================


@contextmanager
def scoped_env(set_vars=None, unset_vars=None, password="test-password"):
    """Save/restore exactly the env keys this invocation touches."""
    set_vars = dict(set_vars or {})
    unset_vars = list(unset_vars or [])
    if password is None:
        unset_vars.append("UPTIME_KUMA_PASSWORD")
    else:
        set_vars["UPTIME_KUMA_PASSWORD"] = password

    keys = set(set_vars) | set(unset_vars)
    saved = {k: os.environ.get(k) for k in keys}
    try:
        for k in unset_vars:
            os.environ.pop(k, None)
        for k, v in set_vars.items():
            os.environ[k] = v
        yield
    finally:
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


def run_main(argv, *, set_vars=None, unset_vars=None, password="test-password",
             login_fail=False):
    """Run sync.main() in-process against the fake API, capturing everything."""
    reset_fake_kuma()
    FAKE_KUMA_STATE["login_fail"] = login_fail
    old_argv = sys.argv
    stdout_buf, stderr_buf = io.StringIO(), io.StringIO()
    exit_code = 0
    try:
        with scoped_env(set_vars=set_vars, unset_vars=unset_vars, password=password):
            sys.argv = ["sync.py"] + argv
            try:
                with redirect_stdout(stdout_buf), redirect_stderr(stderr_buf):
                    sync.main()
            except SystemExit as e:
                exit_code = e.code if isinstance(e.code, int) else (1 if e.code else 0)
    finally:
        sys.argv = old_argv
    return exit_code, stdout_buf.getvalue(), stderr_buf.getvalue()


def write_yaml(tmpdir: Path, name: str, content: str) -> str:
    path = tmpdir / name
    path.write_text(content)
    return str(path)


UNRESOLVED_FIXTURE = """\
settings:
  defaults: {{}}
groups:
  - name: TestGroup
    monitors:
      - name: test-monitor
        type: http
        url: http://${{{var}}}:8080/
"""

RESOLVED_FIXTURE = """\
settings:
  defaults:
    interval: 60
    timeout: 90
    maxretries: 3
    retry_interval: 60
    accepted_statuscodes:
      - 200-299
groups:
  - name: TestGroup
    interval: 200
    monitors:
      - name: test-monitor
        type: http
        url: ${var}
"""


# =============================================================================
# 1. Unset variable aborts: exit 2, name on stderr, API never touched.
# =============================================================================


def test_unset_variable_aborts():
    failures = []
    with tempfile.TemporaryDirectory() as td:
        cfg = write_yaml(Path(td), "monitors.yaml",
                          UNRESOLVED_FIXTURE.format(var="TEST_MISSING_VAR"))
        rc, out, err = run_main(["--config", cfg], unset_vars=["TEST_MISSING_VAR"])

        if rc != 2:
            failures.append(f"expected exit 2, got {rc} (stdout={out!r} stderr={err!r})")
        if "TEST_MISSING_VAR" not in err:
            failures.append(f"unresolved name not printed to stderr: {err!r}")
        touching = api_touching_calls()
        if touching:
            failures.append(f"API was touched despite the guard: {touching!r}")

    total = 1
    return total, (total if not failures else 0), failures


# =============================================================================
# 2. Set-to-empty aborts identically to unset.
# =============================================================================


def test_empty_variable_aborts_identically():
    failures = []
    with tempfile.TemporaryDirectory() as td:
        cfg = write_yaml(Path(td), "monitors.yaml",
                          UNRESOLVED_FIXTURE.format(var="TEST_EMPTY_VAR"))

        rc_unset, _, err_unset = run_main(
            ["--config", cfg], unset_vars=["TEST_EMPTY_VAR"])
        rc_empty, _, err_empty = run_main(
            ["--config", cfg], set_vars={"TEST_EMPTY_VAR": ""})

        if rc_unset != 2 or rc_empty != 2:
            failures.append(
                f"expected both to abort with exit 2, got unset={rc_unset} "
                f"empty={rc_empty}")
        if "TEST_EMPTY_VAR" not in err_unset or "TEST_EMPTY_VAR" not in err_empty:
            failures.append(
                f"unresolved name missing from stderr — unset={err_unset!r} "
                f"empty={err_empty!r}")
        touching = api_touching_calls()
        if touching:
            failures.append(f"API was touched despite the guard: {touching!r}")

    total = 1
    return total, (total if not failures else 0), failures


# =============================================================================
# 3. --dry-run aborts too — the pre-flight must not be more permissive than
#    a real run.
# =============================================================================


def test_dry_run_aborts_too():
    failures = []
    with tempfile.TemporaryDirectory() as td:
        cfg = write_yaml(Path(td), "monitors.yaml",
                          UNRESOLVED_FIXTURE.format(var="TEST_DRYRUN_MISSING"))
        rc, out, err = run_main(["--config", cfg, "--dry-run"],
                                 unset_vars=["TEST_DRYRUN_MISSING"])

        if rc != 2:
            failures.append(f"--dry-run did not abort: rc={rc} stdout={out!r} "
                             f"stderr={err!r}")
        if "TEST_DRYRUN_MISSING" not in err:
            failures.append(f"unresolved name not printed to stderr: {err!r}")
        touching = api_touching_calls()
        if touching:
            failures.append(
                f"--dry-run reached the API despite the guard: {touching!r}")

    total = 1
    return total, (total if not failures else 0), failures


# =============================================================================
# 4. A fully-resolved environment does NOT abort — the false-positive check.
# =============================================================================


def test_resolved_environment_does_not_abort():
    failures = []
    with tempfile.TemporaryDirectory() as td:
        cfg = write_yaml(Path(td), "monitors.yaml",
                          RESOLVED_FIXTURE.format(var="TEST_OK_URL"))
        rc, out, err = run_main(
            ["--config", cfg],
            set_vars={"TEST_OK_URL": "http://example.local:8080/health"})

        if rc == 2:
            failures.append(
                f"a fully-resolved config was blocked by the guard: "
                f"stdout={out!r} stderr={err!r}")
        elif rc != 0:
            failures.append(f"unexpected non-zero exit {rc} for a resolved "
                             f"config: stdout={out!r} stderr={err!r}")
        touching = {c[0] for c in api_touching_calls()}
        expected = {"get_notifications", "get_monitors", "add_monitor"}
        if not expected.issubset(touching):
            failures.append(
                f"expected sync to actually run and reach {expected}, only "
                f"reached {touching} — a false positive isn't the only way "
                f"this guard can regress")

    total = 1
    return total, (total if not failures else 0), failures


# =============================================================================
# 5. Collection spans BOTH config files — a guard checking only the first
#    file was the explicit design trap this pins against.
# =============================================================================


def test_collection_spans_both_config_files():
    failures = []
    passed = 0
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)

        # Case A: main config clean, extra config carries the unresolved var.
        main_cfg = write_yaml(tmp, "main-a.yaml",
                               RESOLVED_FIXTURE.format(var="TEST_MAIN_OK"))
        extra_cfg = write_yaml(
            tmp, "extra-a.yaml",
            UNRESOLVED_FIXTURE.format(var="TEST_EXTRA_MISSING").replace(
                "TestGroup", "ExtraGroup"))
        rc, out, err = run_main(
            ["--config", main_cfg, "--extra-config", extra_cfg],
            set_vars={"TEST_MAIN_OK": "http://ok.local/"},
            unset_vars=["TEST_EXTRA_MISSING"])
        case_a_failures = []
        if rc != 2:
            case_a_failures.append(
                f"case A (clean main, dirty extra): expected exit 2, got {rc} "
                f"(stdout={out!r} stderr={err!r})")
        if "TEST_EXTRA_MISSING" not in err:
            case_a_failures.append(
                f"case A: extra-config's unresolved var missing from stderr: "
                f"{err!r} — a guard checking only the first file would miss this")
        if api_touching_calls():
            case_a_failures.append(f"case A: API touched: {api_touching_calls()!r}")
        failures.extend(case_a_failures)
        passed += 0 if case_a_failures else 1

        # Case B: main config carries the unresolved var, extra config clean.
        main_cfg2 = write_yaml(
            tmp, "main-b.yaml",
            UNRESOLVED_FIXTURE.format(var="TEST_MAIN_MISSING"))
        extra_cfg2 = write_yaml(
            tmp, "extra-b.yaml",
            RESOLVED_FIXTURE.format(var="TEST_EXTRA_OK").replace(
                "TestGroup", "ExtraGroup"))
        rc2, out2, err2 = run_main(
            ["--config", main_cfg2, "--extra-config", extra_cfg2],
            set_vars={"TEST_EXTRA_OK": "http://ok.local/"},
            unset_vars=["TEST_MAIN_MISSING"])
        case_b_failures = []
        if rc2 != 2:
            case_b_failures.append(
                f"case B (dirty main, clean extra): expected exit 2, got {rc2} "
                f"(stdout={out2!r} stderr={err2!r})")
        if "TEST_MAIN_MISSING" not in err2:
            case_b_failures.append(
                f"case B: main-config's unresolved var missing from stderr: "
                f"{err2!r}")
        if api_touching_calls():
            case_b_failures.append(f"case B: API touched: {api_touching_calls()!r}")
        failures.extend(case_b_failures)
        passed += 0 if case_b_failures else 1

    return 2, passed, failures


# =============================================================================
# 6. --export is unaffected — bypasses substitution by design, re-emits a
#    literal ${UPTIME_MONITOR_TOKEN}, must not abort on unset vars.
# =============================================================================


def test_export_unaffected():
    failures = []
    with tempfile.TemporaryDirectory() as td:
        cfg = str(Path(td) / "monitors.yaml")  # deliberately does not exist
        rc, out, err = run_main(["--config", cfg, "--export"], unset_vars=[])

        if rc != 0:
            failures.append(f"--export aborted unexpectedly: rc={rc} "
                             f"stdout={out!r} stderr={err!r}")
        exported = Path(cfg + ".exported")
        if not exported.exists():
            failures.append(f"expected export output at {exported}, not found")
        else:
            body = exported.read_text()
            if "${UPTIME_MONITOR_TOKEN}" not in body:
                failures.append(
                    f"export no longer re-emits the literal "
                    f"${{UPTIME_MONITOR_TOKEN}} placeholder: {body[:300]!r}")
        touching = {c[0] for c in api_touching_calls()}
        if touching - {"get_monitors"}:
            failures.append(f"export reached unexpected API calls: {touching!r}")

    total = 1
    return total, (total if not failures else 0), failures


# =============================================================================
# 7. Exit code 2 is distinct from the failure modes it must not be confused
#    with (missing password, Kuma login failure) — both are 1, not 2.
# =============================================================================


def test_exit_code_distinct_from_other_failures():
    failures = []

    rc_password, _, _ = run_main([], password=None)
    if rc_password == 2:
        failures.append(f"missing-password exit code collided with the guard's "
                         f"exit 2 (got {rc_password})")

    with tempfile.TemporaryDirectory() as td:
        cfg = write_yaml(Path(td), "monitors.yaml",
                          RESOLVED_FIXTURE.format(var="TEST_LOGIN_OK"))
        rc_login, _, _ = run_main(
            ["--config", cfg],
            set_vars={"TEST_LOGIN_OK": "http://ok.local/"}, login_fail=True)
        if rc_login == 2:
            failures.append(f"Kuma login failure exit code collided with the "
                             f"guard's exit 2 (got {rc_login})")

        rc_guard, _, _ = run_main(
            ["--config", write_yaml(Path(td), "unresolved.yaml",
                                     UNRESOLVED_FIXTURE.format(var="TEST_DISTINCT"))],
            unset_vars=["TEST_DISTINCT"])
        if rc_guard != 2:
            failures.append(f"guard's own exit code drifted off 2 (got {rc_guard})")

    total = 1
    return total, (total if not failures else 0), failures


# =============================================================================
# 8. Non-env ${...} literals — the substitution regex matches ANY ${...} in
#    the YAML, not just env refs. Pin current real-file behaviour (grep) and
#    document the trap with a synthetic literal.
# =============================================================================


IDENTIFIER_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def _grep_var_refs(path: Path):
    if not path.exists():
        return None
    return re.findall(r"\$\{([^}]+)\}", path.read_text())


def test_real_configs_have_no_stray_literals():
    failures = []
    report = []

    for label, path in (
        ("uptime-kuma/monitors.yaml", MAIN_MONITORS_YAML),
        ("../homelab-private/uptime-kuma/monitors.yaml", PRIVATE_MONITORS_YAML),
    ):
        refs = _grep_var_refs(path)
        if refs is None:
            report.append(f"{label}: not found locally, skipped")
            continue
        stray = [r for r in refs if not IDENTIFIER_RE.match(r)]
        report.append(f"{label}: {len(refs)} ${{...}} refs, "
                       f"{len(set(refs))} unique, {len(stray)} non-env-shaped")
        if stray:
            failures.append(
                f"{label}: found ${{...}} literal(s) that are not valid env-var "
                f"names — these would abort the guard: {stray!r}")

    print("  [grep] " + " | ".join(report))

    total = 1
    return total, (total if not failures else 0), failures


def test_synthetic_non_env_literal_would_abort():
    """Documents the trap: a literal ${...} with non-identifier content (e.g.
    a stray description) is matched by the substitution regex exactly like a
    real env ref, and WOULD trip the guard. This is correct/expected —
    pinned here so it's a known behaviour, not a surprise."""
    failures = []
    with tempfile.TemporaryDirectory() as td:
        content = (
            "settings:\n  defaults: {}\ngroups:\n  - name: TestGroup\n"
            "    monitors:\n      - name: test-monitor\n        type: http\n"
            "        url: http://example.local/\n"
            "        headers:\n"
            "          X-Note: '${this is not an env var}'\n"
        )
        cfg = write_yaml(Path(td), "monitors.yaml", content)
        rc, out, err = run_main(["--config", cfg])

        if rc != 2:
            failures.append(
                f"a non-identifier ${{...}} literal did not abort as expected: "
                f"rc={rc} stdout={out!r} stderr={err!r}")
        if "this is not an env var" not in err:
            failures.append(f"the literal's raw content should be printed as "
                             f"the 'unresolved name': {err!r}")

    total = 1
    return total, (total if not failures else 0), failures


# =============================================================================

GROUPS = [
    ("1. unset variable aborts", test_unset_variable_aborts),
    ("2. set-to-empty aborts identically", test_empty_variable_aborts_identically),
    ("3. --dry-run aborts too", test_dry_run_aborts_too),
    ("4. resolved env does NOT abort", test_resolved_environment_does_not_abort),
    ("5. collection spans both config files", test_collection_spans_both_config_files),
    ("6. --export is unaffected", test_export_unaffected),
    ("7. exit 2 distinct from other failures", test_exit_code_distinct_from_other_failures),
    ("8a. real configs — no stray literals", test_real_configs_have_no_stray_literals),
    ("8b. synthetic non-env literal documented", test_synthetic_non_env_literal_would_abort),
]


def main() -> int:
    all_failures = []
    grand_total = grand_passed = 0

    for name, fn in GROUPS:
        total, passed, failures = fn()
        grand_total += total
        grand_passed += passed
        print(f"{name:<42} {passed}/{total}")
        all_failures.extend(f"[{name}] {msg}" for msg in failures)

    if all_failures:
        print("\nFAILURES:")
        for msg in all_failures:
            print(f"  {msg}")
        print(f"\n{grand_passed}/{grand_total} passed, "
              f"{grand_total - grand_passed} failed")
        return 1

    print(f"\nall {grand_total} cases as expected")
    return 0


if __name__ == "__main__":
    sys.exit(main())

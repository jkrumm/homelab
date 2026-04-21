#!/usr/bin/env bash
# Homelab Dashboard — RALPH Loop Runner (Strength Tracker v2)
#
# Usage:
#   ./scripts/ralph.sh              # Run all pending groups
#   ./scripts/ralph.sh 3            # Run only group 3
#   ./scripts/ralph.sh --reset 3    # Reset group 3 to pending, then run
#   ./scripts/ralph.sh --status     # Print status and exit
#
# Logs: .ralph-logs/group-N.log
# Watch live: tail -f .ralph-logs/group-N.log
#
# Prerequisites:
#   brew install coreutils   # for gtimeout
#   claude CLI must be in PATH

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DOCS_DIR="$REPO_ROOT/docs/ralph"
PROMPTS_DIR="$DOCS_DIR/prompts"
STATE_FILE="$REPO_ROOT/.ralph-tasks.json"
LOGS_DIR="$REPO_ROOT/.ralph-logs"
REPORT_FILE="$DOCS_DIR/RALPH_REPORT.md"

MAX_RETRIES=3
CLAUDE_TIMEOUT=2700  # 45 minutes per group

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

TOTAL_GROUPS=6

GROUP_TITLES=(
  ""  # 1-indexed
  "Schema Foundation"
  "Visx Migration & Strength Trajectory"
  "Load Quality & Efficiency"
  "Balance & Composite Hero"
  "Readiness & Deload"
  "Polish, Sparklines, Drop Recharts"
)

log_info()    { echo -e "${BLUE}[ralph]${NC} $*"; }
log_success() { echo -e "${GREEN}[ralph]${NC} $*"; }
log_warn()    { echo -e "${YELLOW}[ralph]${NC} $*"; }
log_error()   { echo -e "${RED}[ralph]${NC} $*"; }

require_commands() {
  local missing=0
  for cmd in claude gtimeout python3; do
    if ! command -v "$cmd" &>/dev/null; then
      log_error "$cmd not found."
      missing=1
    fi
  done
  [[ $missing -eq 0 ]] || { echo "Install: brew install coreutils"; exit 1; }
}

# ── State management ──────────────────────────────────────────────────────────

init_state() {
  [[ -f "$STATE_FILE" ]] && { log_info "Resuming from existing state."; return; }
  log_info "Initializing task state..."
  python3 - <<PYEOF
import json
titles = ["Schema Foundation", "Visx Migration & Strength Trajectory", "Load Quality & Efficiency", "Balance & Composite Hero", "Readiness & Deload", "Polish, Sparklines, Drop Recharts"]
groups = [{"id": i+1, "title": t, "status": "pending", "attempts": 0,
           "started_at": None, "completed_at": None}
          for i, t in enumerate(titles)]
state = {"groups": groups, "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"}
with open("$STATE_FILE", "w") as f:
    json.dump(state, f, indent=2)
print("State initialized.")
PYEOF
}

get_field() {
  local gid=$1 field=$2
  python3 -c "
import json
with open('$STATE_FILE') as f:
    state = json.load(f)
for g in state['groups']:
    if g['id'] == $gid:
        print(g.get('$field', ''))
        break
"
}

set_field() {
  local gid=$1 field=$2 val=$3
  python3 - <<PYEOF
import json
with open('$STATE_FILE') as f:
    state = json.load(f)
for g in state['groups']:
    if g['id'] == $gid:
        val = '$val'
        if val in ('True', 'False', 'None'):
            val = {'True': True, 'False': False, 'None': None}[val]
        g['$field'] = val
        break
with open('$STATE_FILE', 'w') as f:
    json.dump(state, f, indent=2)
PYEOF
}

inc_attempts() {
  local gid=$1
  python3 - <<PYEOF
import json
with open('$STATE_FILE') as f:
    state = json.load(f)
for g in state['groups']:
    if g['id'] == $gid:
        g['attempts'] = g.get('attempts', 0) + 1
        break
with open('$STATE_FILE', 'w') as f:
    json.dump(state, f, indent=2)
PYEOF
}

print_status() {
  python3 - <<PYEOF
import json
with open('$STATE_FILE') as f:
    state = json.load(f)
icons = {'complete': '✅', 'blocked': '🚫', 'pending': '⬜', 'in_progress': '🔄'}
total = len(state['groups'])
done = sum(1 for g in state['groups'] if g['status'] == 'complete')
blocked = sum(1 for g in state['groups'] if g['status'] == 'blocked')
pending = total - done - blocked
print(f"  {total} groups | {done} complete | {pending} pending | {blocked} blocked")
print()
for g in state['groups']:
    icon = icons.get(g['status'], '⬜')
    attempts = f"  (attempt {g['attempts']})" if g['attempts'] > 0 else ""
    print(f"  {icon}  Group {g['id']}: {g['title']}{attempts}")
PYEOF
}

# ── Validation ────────────────────────────────────────────────────────────────

validate() {
  local label=${1:-""}
  log_info "Validation${label:+ ($label)}..."
  cd "$REPO_ROOT"

  # Workspace resolution (allow lockfile updates — Group 1 adds/removes deps)
  if ! bun install 2>&1; then
    log_error "bun install failed"
    return 1
  fi

  # Lint — zero warnings expected
  if ! bun run lint 2>&1; then
    log_error "oxlint failed"
    return 1
  fi

  # Formatting — auto-fix and auto-commit if Claude forgot. This self-heals the common
  # failure mode where a group skips `bun run format` before committing.
  if grep -q '"format"' package.json 2>/dev/null; then
    if ! bun run format 2>&1; then
      log_error "bun run format failed"
      return 1
    fi
    if [[ -n "$(git status --porcelain packages/ 2>/dev/null)" ]]; then
      log_warn "Auto-format modified files — creating cleanup commit."
      git add packages
      if ! git -c commit.gpgsign=false commit --no-verify -m "style: post-group auto-format" 2>&1; then
        log_warn "Auto-format commit failed — continuing with uncommitted format changes."
      fi
    fi
  fi

  # API typecheck
  if [[ -f "packages/api/tsconfig.json" ]]; then
    if ! (cd packages/api && bun tsc --noEmit 2>&1); then
      log_error "API typecheck failed"
      return 1
    fi
  fi

  # Dashboard typecheck + build
  if [[ -f "packages/dashboard/tsconfig.json" ]]; then
    if ! (cd packages/dashboard && bun tsc --noEmit 2>&1); then
      log_error "Dashboard typecheck failed"
      return 1
    fi
    if ! (cd packages/dashboard && bun run build 2>&1); then
      log_error "Dashboard build failed"
      return 1
    fi
  fi

  log_success "Validation passed"
  return 0
}

# ── Claude invocation ─────────────────────────────────────────────────────────

run_group() {
  local group_id=$1
  local prompt_file="$PROMPTS_DIR/group-$group_id.md"
  local context_file="$DOCS_DIR/shared-context.md"
  local log_file="$LOGS_DIR/group-$group_id.log"

  mkdir -p "$LOGS_DIR"

  if [[ ! -f "$prompt_file" ]]; then
    log_error "Prompt not found: $prompt_file"
    return 1
  fi

  local full_prompt
  full_prompt="$(cat "$context_file")"$'\n\n---\n\n'"$(cat "$prompt_file")"

  log_info "Claude running (timeout: ${CLAUDE_TIMEOUT}s) → log: .ralph-logs/group-$group_id.log"
  log_info "Watch live: tail -f .ralph-logs/group-$group_id.log"
  echo ""

  local exit_code=0
  if CLAUDE_CODE_ENABLE_TASKS=true CLAUDECODE="" gtimeout "$CLAUDE_TIMEOUT" claude \
    -p "$full_prompt" \
    --model sonnet \
    --effort high \
    --dangerously-skip-permissions \
    --output-format stream-json \
    --verbose \
    --no-session-persistence \
    < /dev/null > "$log_file" 2>&1; then
    exit_code=0
  else
    exit_code=$?
  fi

  # Check completion signal BEFORE the timeout guard
  grep -q "RALPH_TASK_COMPLETE: Group $group_id" "$log_file" && return 0
  grep -q "RALPH_TASK_BLOCKED: Group $group_id" "$log_file" && return 2

  [[ $exit_code -eq 124 ]] && { log_error "Timed out after ${CLAUDE_TIMEOUT}s"; return 1; }

  log_warn "Claude finished but no completion signal in log."
  return 1
}

# ── Report ────────────────────────────────────────────────────────────────────

generate_report() {
  python3 - <<PYEOF
import json
with open('$STATE_FILE') as f:
    state = json.load(f)
icons = {'complete': '✅', 'blocked': '🚫', 'pending': '⬜', 'in_progress': '🔄'}
total = len(state['groups'])
done = sum(1 for g in state['groups'] if g['status'] == 'complete')
blocked = sum(1 for g in state['groups'] if g['status'] == 'blocked')
pending = total - done - blocked
lines = [
    "# RALPH Report",
    "",
    f"Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)",
    f"Groups: {total} total | {done} complete | {pending} pending | {blocked} blocked",
    "", "## Status", "",
]
for g in state['groups']:
    icon = icons.get(g['status'], '⬜')
    attempts = f" (attempts: {g['attempts']})" if g['attempts'] > 0 else ""
    lines.append(f"- {icon} **Group {g['id']}**: {g['title']}{attempts}")
lines += ["", "## Next Steps", ""]
if done == total:
    lines += ["All groups complete.", "", "1. Review: \`git log --oneline -20\`", "2. Run full validation", "3. Deploy: push + pull on server", "4. Create PR if needed: \`/pr\`"]
elif pending > 0:
    lines.append("Run \`./scripts/ralph.sh\` to continue.")
with open('$REPORT_FILE', 'w') as f:
    f.write('\n'.join(lines) + '\n')
print(f"Report: $REPORT_FILE")
PYEOF
}

# ── Main ──────────────────────────────────────────────────────────────────────

main() {
  local target_group=""
  local do_reset=false
  local status_only=false

  while [[ $# -gt 0 ]]; do
    case $1 in
      --status) status_only=true; shift ;;
      --reset) do_reset=true; target_group="${2:?'--reset requires a group number'}"; shift 2 ;;
      [0-9]*) target_group="$1"; shift ;;
      *) echo "Unknown: $1"; echo "Usage: ralph.sh [group] [--reset group] [--status]"; exit 1 ;;
    esac
  done

  echo ""
  echo -e "${BOLD}  RALPH Loop — Homelab Dashboard${NC}"
  echo ""

  require_commands
  cd "$REPO_ROOT"
  init_state

  if $status_only; then print_status; exit 0; fi

  if $do_reset; then
    log_info "Resetting Group $target_group to pending..."
    set_field "$target_group" "status" "pending"
    python3 - <<PYEOF
import json
with open('$STATE_FILE') as f:
    state = json.load(f)
for g in state['groups']:
    if g['id'] == $target_group:
        g['attempts'] = 0; break
with open('$STATE_FILE', 'w') as f:
    json.dump(state, f, indent=2)
PYEOF
  fi

  print_status; echo ""

  local groups_to_run=()
  if [[ -n "$target_group" ]]; then
    groups_to_run=("$target_group")
  else
    for i in $(seq 1 $TOTAL_GROUPS); do groups_to_run+=("$i"); done
  fi

  for group_id in "${groups_to_run[@]}"; do
    local status
    status=$(get_field "$group_id" "status")

    if [[ "$status" == "complete" ]]; then
      echo -e "  ✅  Group $group_id: ${GROUP_TITLES[$group_id]} — skipped (complete)"
      continue
    fi
    if [[ "$status" == "blocked" ]]; then
      echo -e "  🚫  Group $group_id: ${GROUP_TITLES[$group_id]} — skipped (blocked)"
      continue
    fi

    local attempts
    attempts=$(get_field "$group_id" "attempts")

    if [[ "$attempts" -ge "$MAX_RETRIES" ]]; then
      log_warn "Group $group_id reached max retries. Marking blocked."
      set_field "$group_id" "status" "blocked"
      continue
    fi

    echo ""
    echo "  ────────────────────────────────────────────"
    echo -e "  ${BOLD}Group $group_id: ${GROUP_TITLES[$group_id]}${NC}"
    echo "  Attempt: $((attempts + 1)) / $MAX_RETRIES"
    echo "  ────────────────────────────────────────────"
    echo ""

    # Pre-group validation (skip group 1 — nothing to validate yet)
    if [[ "$group_id" -gt 1 ]]; then
      if ! validate "pre-group $group_id"; then
        log_error "Pre-group validation failed. Fix before continuing."
        exit 1
      fi
      echo ""
    fi

    set_field "$group_id" "status" "in_progress"
    inc_attempts "$group_id"

    run_result=0
    run_group "$group_id" || run_result=$?
    echo ""

    if [[ $run_result -eq 0 ]]; then
      log_success "Group $group_id complete."
      set_field "$group_id" "status" "complete"
      set_field "$group_id" "completed_at" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
      echo ""
      if validate "post-group $group_id"; then
        log_success "Post-group validation passed"
      else
        log_warn "Post-group validation FAILED. Review log and fix."
        log_warn "Retry: ./scripts/ralph.sh --reset $group_id"
      fi
    elif [[ $run_result -eq 2 ]]; then
      log_warn "Group $group_id blocked. See: .ralph-logs/group-$group_id.log"
      set_field "$group_id" "status" "blocked"
    else
      log_error "Group $group_id failed (attempt $((attempts + 1)) / $MAX_RETRIES)"
      set_field "$group_id" "status" "pending"
      log_info "Log: .ralph-logs/group-$group_id.log"
      new_attempts=$(get_field "$group_id" "attempts")
      if [[ "$new_attempts" -ge "$MAX_RETRIES" ]]; then
        set_field "$group_id" "status" "blocked"
      elif [[ -z "$target_group" ]]; then
        log_warn "Stopping. Fix Group $group_id before proceeding."
        break
      fi
    fi

    echo ""
  done

  echo ""
  generate_report
  echo ""
  echo -e "${BOLD}  RALPH loop done.${NC}"
  echo ""
  print_status
  echo ""
}

main "$@"

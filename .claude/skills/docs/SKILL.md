---
name: docs
description: HomeLab documentation maintenance — audit infrastructure changes and update README.md, CLAUDE.md, docs/, and skill files
context: main
---

# docs

**When to use:**

- After adding/removing services in docker-compose.yml
- After creating/modifying scripts
- After changing ports, paths, or configurations
- After adding/modifying API routes in `api/src/`
- Before committing infrastructure changes
- When detecting new multi-component stacks

**What this skill does:**

1. Scans docker-compose.yml for new/removed services
2. Checks scripts/ directory for new scripts
3. Audits config files and mount points
4. Detects multi-component stacks with `com.centurylinklabs.watchtower.enable: "false"`
5. Updates README.md and CLAUDE.md cheatsheets
6. Synchronizes Table of Contents
7. Updates behavior documentation in docs/
8. Prompts to extend /upgrade-stack for new stacks
9. **If `api/src/` changed: syncs Hermes skills** — regenerates `homelab-api/SKILL.md` from OpenAPI spec and updates the relevant domain skill (infrastructure, tasks, schedule, weather, slack)

**What this skill does NOT do:**

- Execute infrastructure changes (only documents them)
- Commit changes automatically (use /commit after review)
- Modify scripts or configurations
- Create new services or scripts

---

## Audit Checklist

When running this skill, I will check:

### Infrastructure Changes

- [ ] New/removed services in docker-compose.yml
- [ ] New scripts in `scripts/` or repo root
- [ ] Modified config files in `config/`
- [ ] Changed uptime-kuma/monitors.yaml
- [ ] Storage mount point changes
- [ ] New/modified routes in `api/src/` → sync Hermes skills (see Phase 3 below)

### Multi-Component Stack Detection

- [ ] Services with `com.centurylinklabs.watchtower.enable: "false"`
- [ ] Group services by prefix (`immich_*`)
- [ ] Check if stack exists in `.claude/skills/upgrade-stack/SKILL.md`
- [ ] Prompt to add new stacks to /upgrade-stack

**Current stacks in /upgrade-stack:**

- Caddy (custom local build, `docker compose build`)
- Immich (server, ML, postgres, redis)

### Documentation Sync

- [ ] README.md "Quick Commands Cheatsheet"
- [ ] README.md Table of Contents
- [ ] CLAUDE.md "Quick Reference Card"
- [ ] CLAUDE.md "Services Reference" tables
- [ ] CLAUDE.md "Available Scripts" table
- [ ] docs/\*.md behavior documentation

---

## Documentation Standards

### Cheatsheet Categories (in order)

1. SSH Access
2. Docker Operations
3. Git Workflow
4. System Health
5. Watchdog Management
6. Container Diagnostics
7. Uptime Kuma Config-as-Code
8. SigNoz (Observability)
9. HDD Diagnostics
10. Database Backup
11. 1Password Secrets
12. Emergency Commands

### Command Format

**README.md (verbose, copy-paste ready):**

```bash
# Full SSH wrapper for remote execution
ssh homelab "docker compose ps"
```

**CLAUDE.md (table format, concise):**

```markdown
| `docker compose ps` | View all services |
```

### Behavior Documentation (docs/\*.md)

Create detailed behavior docs for complex scripts with:

- Multiple failure modes or recovery paths
- Self-healing logic users need to understand
- Configuration affecting system behavior

**Required sections:**

1. Overview - Purpose and design principles
2. Health checks - What the script monitors
3. Failure scenarios - Each failure type with behavior
4. Recovery behaviors - Escalation level actions
5. Manual intervention - When and how
6. Configuration - Key variables and effects

**Naming:** `docs/<script-name>-behaviors.md`

---

## Workflow

### Phase 1: Audit

Scan and identify changes:

```markdown
## Documentation Audit Results

### New Services

- [Service Name] (port X, URL, purpose)
  Type: Public/Private/Internal

### New Scripts

- [Script name] in scripts/
  Purpose: [brief description]

### Modified Configurations

- [Config file]: [what changed]

### Multi-Component Stack Check

✅ SigNoz: 4 services, already in /upgrade-stack
✅ Immich: 4 services, already in /upgrade-stack
⚠️ NEW: Plausible detected (3 services with watchtower opted-out)
→ Prompt: Add Plausible to /upgrade-stack?

### Outdated Documentation

- [Command/service] needs update in [file]
```

### Phase 2: Update Documentation

If changes found, update:

**README.md:**

- Infrastructure Overview (service count)
- Service Access Cheatsheet (Public/Private/Internal tables)
- Quick Commands Cheatsheet (new service commands)
- Table of Contents (if structure changed)

**CLAUDE.md:**

- Services Reference (Public/Private/Internal tables)
- Quick Reference Card (command tables)
- Available Scripts table

**docs/\*.md:**

- Update behavior documentation if script logic changed
- Verify timeouts and states match code

### Phase 3: Hermes Skill Sync (if `api/src/` changed)

If any routes were added, removed, or modified in `api/src/`:

**Hermes uses a two-layer skill architecture:**

- **`homelab-api/SKILL.md`** — full endpoint reference (fallback). Regenerated from OpenAPI spec.
- **Domain skills** — behavioral guidance with curl commands, decision trees, field semantics, formatting rules. These are hand-written and live alongside `homelab-api`:

| Domain skill     | Covers these endpoint groups                                              |
| ---------------- | ------------------------------------------------------------------------- |
| `infrastructure` | UptimeKuma (`/uptime-kuma/*`), Docker (`/docker/*`), Summary (`/summary`) |
| `tasks`          | TickTick (`/ticktick/*`), Summary ticktick section                        |
| `schedule`       | Gmail (`/gmail/emails/*`), Calendar (`/gmail/calendar`)                   |
| `weather`        | Weather (`/weather/*`)                                                    |
| `slack`          | Slack (`/slack/*`)                                                        |

**Steps:**

1. Fetch the live OpenAPI spec: `curl -s https://api.jkrumm.com/docs/json`
2. Regenerate `~/SourceRoot/claude-local/hermes/skills/homelab-api/SKILL.md` — update endpoint tables to match the spec. Preserve the frontmatter, Usage Pattern section, and Notes section (which lists domain skills).
3. If the changed route falls under a domain skill (see table above), update that domain skill's curl commands and field semantics to match the new API. Domain skills live at `~/SourceRoot/claude-local/hermes/skills/{name}/SKILL.md`.
4. If the change adds a new endpoint group that doesn't fit an existing domain skill, consider creating a new one following the pattern: decision tree, curl commands, field semantics, response formatting guidance.
5. Note changes in the commit message. Homelab API changes and skill updates go in separate commits (different repos).

### Phase 4: Extend /upgrade-stack (if needed)

If new multi-component stack detected:

1. Prompt user: "New stack {name} detected. Add to /upgrade-stack?"
2. If approved, read `.claude/skills/upgrade-stack/SKILL.md`
3. Add new section to "Manually-Managed Containers"
4. Document version sources and compatibility requirements
5. Note in commit message

---

## Files Updated

| File                                                           | What Gets Updated                                                                               |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `README.md`                                                    | Quick Commands Cheatsheet, ToC, Service tables                                                  |
| `CLAUDE.md`                                                    | Quick Reference Card, Services Reference, Scripts table                                         |
| `docs/watchdog-behaviors.md`                                   | Failure scenarios, recovery states                                                              |
| `docs/*.md`                                                    | Behavior documentation for modified scripts                                                     |
| `uptime-kuma/monitors.yaml`                                    | If monitor config changed                                                                       |
| `.claude/skills/upgrade-stack/SKILL.md`                        | New multi-component stacks                                                                      |
| `.claude/skills/docs/SKILL.md`                                 | This file - if audit scope changes                                                              |
| `~/SourceRoot/claude-local/hermes/skills/homelab-api/SKILL.md` | Endpoint tables regenerated from live OpenAPI spec when `api/src/` changes                      |
| `~/SourceRoot/claude-local/hermes/skills/{domain}/SKILL.md`    | Domain skill (infrastructure, tasks, schedule, weather, slack) updated if its endpoints changed |

---

## Validation Checklist

After updates:

- [ ] All docker-compose.yml services documented
- [ ] All scripts in scripts/ have usage docs
- [ ] Port numbers match docker-compose.yml
- [ ] Mount paths match server layout
- [ ] SSH commands use correct host aliases
- [ ] op prefix included where needed
- [ ] Markdown links work (no broken anchors)
- [ ] Table formatting correct
- [ ] Behavior docs match actual script code
- [ ] Multi-component stacks with watchtower opted-out in /upgrade-stack
- [ ] This skill file covers all doc types

---

## Output Format

```markdown
## Documentation Updated

**Files modified:**

- README.md: [specific changes]
- CLAUDE.md: [specific changes]
- docs/\*.md: [specific changes]
- .claude/skills/\*.md: [specific changes]

**Services added:**

- [Service name]: [port, URL, purpose]

**Commands added:**

- [Command]: [description]

**Multi-component stacks:**

- [Stack name]: Added to /upgrade-stack

**Next steps:**

- Review changes: `git diff`
- Commit: `/commit`
```

---

## Integration

### With /upgrade-stack

- Detects new stacks with WUD notify-only or ignore labels
- Prompts to add to `.claude/skills/upgrade-stack/SKILL.md`
- Updates "Manually-Managed Containers" section automatically

### With /commit

After documentation updates:

```bash
/commit
```

Creates commit with docs changes.

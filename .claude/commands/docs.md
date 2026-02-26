# docs

**Description:** HomeLab documentation maintenance - audit infrastructure and update README.md, CLAUDE.md, docs/, and command files.

**Context:** main

**When to use:**
- After adding/removing services in docker-compose.yml
- After creating/modifying scripts
- After changing ports, paths, or configurations
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

### Multi-Component Stack Detection
- [ ] Services with `com.centurylinklabs.watchtower.enable: "false"`
- [ ] Group services by prefix (`signoz-*`, `immich_*`, `plausible_*`)
- [ ] Check if stack exists in `.claude/commands/upgrade-stack.md`
- [ ] Prompt to add new stacks to /upgrade-stack

**Current stacks in /upgrade-stack:**
- Caddy (custom local build, `docker compose build`)
- SigNoz (signoz unified binary, otel-collector, schema-migrators, zookeeper, clickhouse)
- Immich (server, ML, postgres, redis)
- Plausible (shared clickhouse + immich_postgres)

### Documentation Sync
- [ ] README.md "Quick Commands Cheatsheet"
- [ ] README.md Table of Contents
- [ ] CLAUDE.md "Quick Reference Card"
- [ ] CLAUDE.md "Services Reference" tables
- [ ] CLAUDE.md "Available Scripts" table
- [ ] docs/*.md behavior documentation

---

## Documentation Standards

### Cheatsheet Categories (in order)
1. SSH Access
2. Docker Operations
3. Git Workflow
4. System Health
5. Watchdog Management
6. Container Diagnostics
7. [redacted] ([redacted]s)
8. Uptime Kuma Config-as-Code
9. SigNoz (Observability)
10. HDD Diagnostics
11. Database Backup
12. Doppler Secrets
13. Emergency Commands

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

### Behavior Documentation (docs/*.md)

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
⚠️  NEW: Plausible detected (3 services with watchtower opted-out)
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

**docs/*.md:**
- Update behavior documentation if script logic changed
- Verify timeouts and states match code

### Phase 3: Extend /upgrade-stack (if needed)

If new multi-component stack detected:

1. Prompt user: "New stack {name} detected. Add to /upgrade-stack?"
2. If approved, read `.claude/commands/upgrade-stack.md`
3. Add new section to "Supported Stacks"
4. Document version sources and compatibility requirements
5. Note in commit message

---

## Files Updated

| File | What Gets Updated |
|------|-------------------|
| `README.md` | Quick Commands Cheatsheet, ToC, Service tables |
| `CLAUDE.md` | Quick Reference Card, Services Reference, Scripts table |
| `docs/watchdog-behaviors.md` | Failure scenarios, recovery states |
| `docs/*.md` | Behavior documentation for modified scripts |
| `uptime-kuma/monitors.yaml` | If monitor config changed |
| `.claude/commands/upgrade-stack.md` | New multi-component stacks |
| `.claude/commands/docs.md` | This file - if audit scope changes |

---

## Validation Checklist

After updates:

- [ ] All docker-compose.yml services documented
- [ ] All scripts in scripts/ have usage docs
- [ ] Port numbers match docker-compose.yml
- [ ] Mount paths match server layout
- [ ] SSH commands use correct host aliases
- [ ] Doppler prefix included where needed
- [ ] Markdown links work (no broken anchors)
- [ ] Table formatting correct
- [ ] Behavior docs match actual script code
- [ ] Multi-component stacks with watchtower opted-out in /upgrade-stack
- [ ] This command file covers all doc types

---

## Output Format

```markdown
## Documentation Updated

**Files modified:**
- README.md: [specific changes]
- CLAUDE.md: [specific changes]
- docs/*.md: [specific changes]
- .claude/commands/*.md: [specific changes]

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
- Prompts to add to upgrade-stack.md
- Updates "Supported Stacks" section automatically

### With /commit
After documentation updates:
```bash
/commit
```
Creates commit with docs changes.

---

## Example Session

```
User: /docs
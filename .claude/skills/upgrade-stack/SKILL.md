---
name: upgrade-stack
description: Upgrade assistant for ALL manually-managed Docker containers with dependency checking, shared infrastructure awareness, and breaking change analysis
context: fork
---

# upgrade-stack

**When to use:**
- Upgrading any container with `com.centurylinklabs.watchtower.enable: "false"` (manually-managed)
- Checking all manually-managed containers for updates
- Planning database upgrades that affect multiple applications
- Verifying compatibility for shared infrastructure (Postgres)
- Rebuilding Caddy after a new Caddy 2.x release

**What this skill does:**
1. Identifies all manually-managed containers from docker-compose.yml
2. Researches latest stable versions and release notes for each
3. Analyzes breaking changes and migration requirements
4. **Checks shared database compatibility** (Postgres → Immich + Plausible)
5. Generates upgrade plan with tested version combinations
6. Provides upgrade order based on dependencies
7. Creates backup commands before upgrade
8. Provides rollback instructions

**What this skill does NOT do:**
- Execute the upgrade (you review and apply manually)
- Upgrade containers auto-updated by Watchtower (containers without `com.centurylinklabs.watchtower.enable: "false"`)
- Modify files without explicit approval

---

## Manually-Managed Containers

### Special Tier: Custom Builds

#### caddy
- **Type**: Custom local build (Dockerfile, NOT a registry image)
- **Base images**: `caddy:2-builder` + `caddy:2`
- **Why manual**: Requires `docker compose build` — Watchtower cannot rebuild from Dockerfiles
- **Plugin**: `caddy-dns/cloudflare` (required for DNS-01 ACME challenge)
- **Upgrade**: Rebuild from latest `caddy:2` base image when a new Caddy 2.x release is worth taking
- **Version source**: https://github.com/caddyserver/caddy/releases
- **Upgrade command**:
  ```bash
  ssh homelab "cd ~/homelab && docker compose build caddy && op run --env-file=.env.tpl -- docker compose up -d --force-recreate caddy"
  ```
- **No rollback complexity**: Caddy is stateless (config in Caddyfile, certs in caddy_data volume)

### Database Tier (Shared Infrastructure)

#### immich_redis
- **Current**: `docker.io/redis:7.4-alpine` (SHA-pinned)
- **Why pinned**: Digest-pinned for stability
- **Used by**: Immich only
- **Upgrade impact**: Only affects Immich
- **Version source**: https://github.com/redis/redis/releases

#### immich_postgres
- **Current**: `ghcr.io/immich-app/postgres:14-vectorchord0.4.3-pgvectors0.2.0` (SHA-pinned)
- **Why pinned**: Custom extensions (VectorChord for vector search), breaking migrations
- **Used by**: Immich (`immich` database), Plausible (shared, `plausible_db` database)
- **Upgrade impact**: Affects both Immich AND Plausible
- **Compatibility requirements**:
  - Immich: Postgres >= 14, < 19
  - Plausible: Postgres >= 12
- **Version source**: https://github.com/immich-app/immich/pkgs/container/postgres

### Application Tier

#### immich-server + immich-machine-learning
- **Current**: `ghcr.io/immich-app/immich-server:release` / `immich-machine-learning:release-openvino`
- **Why pinned**: Database migrations (postgres schema changes between versions)
- **Depends on**: immich_postgres, immich_redis
- **Version source**: https://github.com/immich-app/immich/releases

#### plausible
- **Current**: `ghcr.io/plausible/community-edition:v3.2.0`
- **Why pinned**: Database migrations, schema changes
- **Depends on**: Postgres (shared with Immich, `plausible_db`)
- **Compatibility requirements**:
  - Postgres >= 12
- **Version source**: https://github.com/plausible/analytics/releases

---

## Usage

```bash
# Check all manually-managed containers
/upgrade-stack --check-all

# Rebuild Caddy (new Caddy 2.x release)
/upgrade-stack caddy

# Upgrade specific database (checks all dependents)
/upgrade-stack postgres      # Checks Immich + Plausible compatibility
/upgrade-stack redis         # Checks Immich compatibility

# Upgrade specific application stack
/upgrade-stack immich        # Checks Immich components + Postgres + Redis
/upgrade-stack plausible     # Checks Plausible + shared Postgres

# Check single container
/upgrade-stack immich_redis
/upgrade-stack immich_postgres
```

---

## Dependency Graph

```
DATABASE TIER                  APPLICATION TIER

immich_redis      ◄──────────  Immich (Server + ML)

immich_postgres   ◄──────────  Immich (Server + ML)
                  ◄──────────  Plausible
```

**Key insight**: Upgrading Postgres affects MULTIPLE applications. Always check all dependents.

---

## Upgrade Order (Recommended)

1. **caddy** (zero risk, stateless, independent)
2. **immich_redis** (low risk, only affects Immich)
3. **immich + immich_postgres** (medium risk, shared Postgres but separate schema)
4. **plausible** (medium risk, shared Postgres)

**Never upgrade in this order:**
- ❌ Database first → app second (may break running apps)
- ✅ Research all dependents first → backup → upgrade database → verify all apps

---

## Container-Specific Notes

### caddy
- **No image tag** — always rebuilds from `caddy:2` and `caddy:2-builder` latest
- **No backup needed** — stateless; Caddyfile is in git, certs survive in `caddy_data` volume
- **Check**: `docker logs caddy --tail=20` after rebuild to confirm TLS + routing intact

### immich_redis
- **Migration path**: Redis 7.4 LTS is current; watch for Immich adopting Valkey
- **Rollback**: Easy (stop container, revert image, restart — Redis is ephemeral cache)

### immich_postgres
- **Critical**: VectorChord reindexing required after extension upgrade
- **Commands**: `ALTER EXTENSION vchord UPDATE; REINDEX INDEX face_index; REINDEX INDEX clip_index;`
- **Rollback**: Medium (requires database restore from pg_dumpall)

### immich-server + immich-machine-learning
- **Always upgrade together** with postgres if postgres version changes
- **`release` tag**: Immich uses a rolling `release` tag, so check release notes before any pull

### plausible
- **Rollback**: Medium (requires Postgres backup restore)

---

## Workflow

### 1. Version Discovery
- Parse docker-compose.yml for current versions/tags/SHA hashes
- Identify all containers with `com.centurylinklabs.watchtower.enable: "false"`
- Build dependency graph

### 2. Research Latest Versions
- Query GitHub releases API for latest stable versions
- Check Docker Hub / ghcr.io for official image tags
- Identify LTS vs stable releases
- Check for security advisories

### 3. Breaking Change Analysis
- Read CHANGELOG between versions
- Check GitHub issues with "breaking-change" label
- Search for migration guides
- Identify deprecated features in config files

### 4. Shared Database Compatibility Check
- For Postgres upgrades: Check Immich + Plausible requirements
- For Redis upgrades: Check Immich requirements
- Highlight incompatibilities with ⚠️ or ❌

### 5. Migration Planning
- Database backup commands (specific to each DB)
- Volume snapshot recommendations
- Upgrade order (databases after checking all dependents)
- Rollback procedure

### 6. Upgrade Execution (manual)
- User reviews plan
- User backs up data
- For registry images: User updates docker-compose.yml versions (and SHA hashes if needed)
- For caddy: `docker compose build caddy && op run --env-file=.env.tpl -- docker compose up -d --force-recreate caddy`
- For others: `op run --env-file=.env.tpl -- docker compose up -d [container]`
- User verifies health for ALL affected applications

### 7. Verification
- Health check commands for all affected containers
- Log inspection for errors
- Data integrity checks (queries, dashboards)
- Verify shared database connectivity for all dependents

---

## Output Format

```markdown
# {Container/Stack} Upgrade Analysis

## Current State
- Container: [name]
- Image: [image:tag@sha256 or "custom local build"]
- Version: [extracted version]
- Watchtower: Excluded (com.centurylinklabs.watchtower.enable: "false")

## Latest Stable Version
- Version: [latest] (released [date])
- LTS: [version] (if applicable)

## Update Available
✅ Yes / ⏸️ Already latest / ⚠️ Custom version ahead

## Breaking Changes ([current] → [latest])
1. [description] — Migration required: Yes/No

## Shared Infrastructure Impact (if database)
Upgrading [database] affects:
├── [App 1] (requires [version range]) ✅/⚠️/❌
└── [App 2] (requires [version range]) ✅/⚠️/❌

## Upgrade Complexity
🟢 Low / 🟡 Medium / 🔴 High

## Recommended Action
- **Upgrade to [version]** / **Stay on current** / **Monitor [issue]**

## Pre-Upgrade Checklist
- [ ] Backup [database/volume]: `[command]`
- [ ] Read release notes: [URL]

## Upgrade Steps
[numbered steps]

## Rollback Plan
[steps]

## Verification Commands
[commands]
```

---

## Integration with /docs

When containers with `com.centurylinklabs.watchtower.enable: "false"` are added or removed:
1. Detect change in docker-compose.yml
2. Prompt: "New manually-managed container detected: {name}. Update /upgrade-stack skill?"
3. Add container to appropriate tier (database vs application vs custom build)
4. Update dependency graph if it shares Postgres

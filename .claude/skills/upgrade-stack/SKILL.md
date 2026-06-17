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

**What this skill does:**

1. Identifies all manually-managed containers from docker-compose.yml
2. Researches latest stable versions and release notes for each
3. Analyzes breaking changes and migration requirements
4. **Checks shared database compatibility** (Postgres → Immich)
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

Two stacks pin images and opt out of Watchtower (`com.centurylinklabs.watchtower.enable: "false"`):
the four **Immich-stack** services and the two **Karakeep sidecars** (`karakeep-chrome`,
`karakeep-meili`). Everything else — including Caddy (`caddybuilds/caddy-cloudflare:latest`)
and the Karakeep **web app** itself (`karakeep:release`, a floating tag that Watchtower
updates) — is Watchtower-managed and out of scope for this skill.

### Database Tier (Shared Infrastructure)

#### immich_redis

- **Current**: `docker.io/valkey/valkey:9` (SHA-pinned)
- **Why pinned**: Digest-pinned for stability
- **Used by**: Immich only
- **Upgrade impact**: Only affects Immich
- **Version source**: https://github.com/valkey-io/valkey/releases

#### immich_postgres

- **Current**: `ghcr.io/immich-app/postgres:14-vectorchord0.4.3-pgvectors0.2.0` (SHA-pinned)
- **Why pinned**: Custom extensions (VectorChord for vector search), breaking migrations
- **Used by**: Immich (`immich` database)
- **Upgrade impact**: Only affects Immich
- **Compatibility requirements**:
  - Immich: Postgres >= 14, < 19
- **Version source**: https://github.com/immich-app/immich/pkgs/container/postgres

### Application Tier

#### immich-server + immich-machine-learning

- **Current**: `ghcr.io/immich-app/immich-server:release` / `immich-machine-learning:release-openvino`
- **Why pinned**: Database migrations (postgres schema changes between versions)
- **Depends on**: immich_postgres, immich_redis
- **Version source**: https://github.com/immich-app/immich/releases

### Karakeep Tier

Karakeep is a three-container stack. Only the **two sidecars are pinned and
Watchtower-excluded** — the web app floats on `release` and Watchtower updates it.

#### karakeep (web app) — NOT in scope (Watchtower-managed)

- **Image**: `ghcr.io/karakeep-app/karakeep:release` (floating tag, auto-updated 04:00)
- Listed for context only: the app release is what **drives** which Meili/Chrome versions
  the sidecars must match. Read its release notes when a sidecar bump is needed.
- **Version source**: https://github.com/karakeep-app/karakeep/releases

#### karakeep-meili

- **Current**: `getmeili/meilisearch:v1.41.0`
- **Why pinned**: Karakeep's search integration is tested against a specific Meilisearch
  version, and Meili does **not** auto-migrate its on-disk index across some version
  boundaries (can require a dump + import). Upstream Karakeep's own compose pins it.
- **Used by**: Karakeep only.
- **Index is rebuildable**: the Meili volume (`/mnt/hdd/karakeep/meili`) is a derived index
  over Karakeep's source-of-truth SQLite DB — intentionally NOT restic-backed-up. The safe
  upgrade path is usually stop → wipe the meili volume → start the new version → trigger a
  Karakeep re-index, rather than fighting an in-place Meili migration.
- **Version source**: https://github.com/meilisearch/meilisearch/releases

#### karakeep-chrome

- **Current**: `gcr.io/zenika-hub/alpine-chrome:124`
- **Why pinned**: tracks a Chromium major; crawl + screenshot behaviour shifts across
  majors, so bumps are deliberate. Stateless → trivial rollback.
- **Used by**: Karakeep only (crawl + screenshots).
- **Version source**: https://hub.docker.com/r/zenika/alpine-chrome/tags

**How to investigate a Karakeep bump (before changing pins):**

1. Open the Karakeep release you're on/targeting and read its `docker/docker-compose.yml`
   at that git tag — it pins the **exact Meili + Chrome versions that release was tested
   against**. Match our two pins to those values.
2. If upstream moved Meili, read the Meilisearch release notes between the two versions for
   "dumpless upgrade" support; if an in-place migration isn't supported, plan the
   wipe-and-reindex path (the index is rebuildable, so this is low-risk).
3. The usual trigger is the **reverse** of Immich: Watchtower lands an app update first,
   then you reconcile the sidecar pins to the new release's tested versions.

**Rollback:**

- **App**: `release` is floating — to roll back, pin `karakeep` to the prior image digest.
- **Meili / Chrome**: revert the pin; Meili re-indexes from SQLite, Chrome is stateless.
- **Data**: Karakeep SQLite + crawled assets (`/mnt/hdd/karakeep/data`) are restic-backed-up.

---

## Usage

```bash
# Check all manually-managed containers
/upgrade-stack --check-all

# Upgrade specific database (checks all dependents)
/upgrade-stack postgres      # Checks Immich compatibility
/upgrade-stack redis         # Checks Immich compatibility

# Upgrade specific application stack
/upgrade-stack immich        # Checks Immich components + Postgres + Redis
/upgrade-stack karakeep      # Reconciles pinned Meili/Chrome sidecars to the app release
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

karakeep-meili    ◄──────────  Karakeep (web app — Watchtower-managed)
karakeep-chrome   ◄──────────  Karakeep (web app — Watchtower-managed)
```

**Key insight**: Upgrading Postgres affects Immich; the Karakeep coupling runs the other
way — the **app** auto-updates and you reconcile its pinned sidecars to match. Always verify
before upgrading.

---

## Upgrade Order (Recommended)

1. **immich_redis** (low risk, only affects Immich)
2. **immich + immich_postgres** (medium risk, schema migrations required)

**Never upgrade in this order:**

- ❌ Database first → app second (may break running apps)
- ✅ Research all dependents first → backup → upgrade database → verify all apps

---

## Container-Specific Notes

### immich_redis

- **Migration path**: Already migrated from Redis to Valkey 9 (digest-pinned). Bump the SHA to match the upstream Immich release for digest hygiene.
- **Rollback**: Easy (stop container, revert image, restart — the cache is ephemeral)

### immich_postgres

- **Critical**: VectorChord reindexing required after extension upgrade
- **Commands**: `ALTER EXTENSION vchord UPDATE; REINDEX INDEX face_index; REINDEX INDEX clip_index;`
- **Rollback**: Medium (requires database restore from pg_dumpall)

### immich-server + immich-machine-learning

- **Always upgrade together** with postgres if postgres version changes
- **`release` tag**: Immich uses a rolling `release` tag, so check release notes before any pull

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

- For Postgres upgrades: Check Immich requirements
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
- For the Immich stack (rolling `release` tags): `make immich-upgrade` — git pull + `docker compose pull` + recreate. Raw `docker` is hook-blocked; always go through the make target.
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

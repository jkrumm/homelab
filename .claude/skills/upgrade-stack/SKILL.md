---
name: upgrade-stack
description: Upgrade assistant for ALL manually-managed Docker containers with dependency checking, shared infrastructure awareness, and breaking change analysis
context: fork
---

# upgrade-stack

**When to use:**

- Upgrading any container with `com.centurylinklabs.watchtower.enable: "false"` (manually-managed)
- Checking all manually-managed containers for updates

**What this skill does:**

1. Identifies all manually-managed containers from docker-compose.yml
2. Researches latest stable versions and release notes for each
3. Analyzes breaking changes and migration requirements
4. Generates upgrade plan with tested version combinations
5. Provides upgrade order based on dependencies
6. Creates backup commands before upgrade
7. Provides rollback instructions

**What this skill does NOT do:**

- Execute the upgrade (you review and apply manually)
- Upgrade containers auto-updated by Watchtower (containers without `com.centurylinklabs.watchtower.enable: "false"`)
- Upgrade a stack without checking its release notes for breaking changes first

---

## Manually-Managed Containers

Only the two **Karakeep sidecars** (`karakeep-chrome`, `karakeep-meili`) pin images and opt out
of Watchtower (`com.centurylinklabs.watchtower.enable: "false"`). Everything else — including Caddy (`caddybuilds/caddy-cloudflare:latest`)
and the Karakeep **web app** itself (`karakeep:release`, a floating tag that Watchtower
updates) — is Watchtower-managed and out of scope for this skill.

### Karakeep Tier

Karakeep is a three-container stack. Only the **two sidecars are pinned and
Watchtower-excluded** — the web app floats on `release` and Watchtower updates it.

#### karakeep (web app) — NOT in scope (Watchtower-managed)

- **Image**: `ghcr.io/karakeep-app/karakeep:release` (floating tag, auto-updated 06:00)
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

- **Current**: `ghcr.io/karakeep-app/karakeep-chrome:156.0.8078.47-r1`
- **Why pinned**: tracks a Chromium major; crawl + screenshot behaviour shifts across
  majors, so bumps are deliberate. Stateless → trivial rollback.
- **Used by**: Karakeep only (crawl + screenshots).
- **Version source**: https://github.com/karakeep-app/karakeep/pkgs/container/karakeep-chrome
- **Was `gcr.io/zenika-hub/alpine-chrome:124` until 2026-08-27.** That image is abandoned
  and its manifest no longer resolves (the GCR project has billing disabled), so the
  container was running purely off a cached layer — one `compose pull` or `image prune`
  from losing crawling for good. Karakeep's own image replaces it: its entrypoint forwards
  :9222 itself, so `--remote-debugging-*` must **not** be passed (it breaks the
  forwarding), sandboxing is handled inside the image, and `init: true` is required.
  Chrome still answers `/json/version` with **500** for a non-IP `Host` header — that is
  Chrome's own guard, not a misconfiguration; Karakeep resolves the service name to an IP
  before connecting.

**How to investigate a Karakeep bump (before changing pins):**

1. Open the Karakeep release you're on/targeting and read its `docker/docker-compose.yml`
   at that git tag — it pins the **exact Meili + Chrome versions that release was tested
   against**. Match our two pins to those values.
2. If upstream moved Meili, read the Meilisearch release notes between the two versions for
   "dumpless upgrade" support; if an in-place migration isn't supported, plan the
   wipe-and-reindex path (the index is rebuildable, so this is low-risk).
3. The usual trigger: Watchtower lands an app update first,
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

# Upgrade the Karakeep stack
/upgrade-stack karakeep      # Reconciles pinned Meili/Chrome sidecars to the app release
# Check single container
/upgrade-stack karakeep-meili
```

---

## Dependency Graph

```
SIDECARS                       APPLICATION

karakeep-meili    ◄──────────  Karakeep (web app — Watchtower-managed)
karakeep-chrome   ◄──────────  Karakeep (web app — Watchtower-managed)
```

**Key insight**: the **app** auto-updates and you reconcile its pinned sidecars to match.
Always verify before upgrading.

---

## Upgrade Order (Recommended)

Research all dependents first → backup → upgrade the sidecar → verify the app.

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

### 4. Migration Planning

- Database backup commands (specific to each DB)
- Volume snapshot recommendations
- Upgrade order (after checking all dependents)
- Rollback procedure

**Verify a backup, never infer one.** A file existing is not a backup. Confirm: it
decompresses (`gzip -t`), it is complete (`pg_dump`'s trailing "dump complete" marker),
it is offsite (`restic ls latest <path>`), and its contents match the live DB (row counts
per table). Take a fresh verified dump immediately before any major bump — and state
plainly what was checked versus what is assumed.

### 5. Upgrade Execution (manual)

- User reviews plan
- User backs up data
- For registry images: User updates docker-compose.yml versions (and SHA hashes if needed)
- User verifies health for ALL affected applications

### 6. Verification

- Health check commands for all affected containers
- Log inspection for errors
- Data integrity checks (queries, dashboards)

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
3. Add container to appropriate tier (sidecar vs application vs custom build)
4. Update the dependency graph

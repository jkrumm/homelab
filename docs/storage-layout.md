# Storage layout

## Mount points

| Path               | Type                     | Purpose                                    |
| ------------------ | ------------------------ | ------------------------------------------ |
| `/home/jkrumm/ssd` | Internal SSD             | Fast storage, databases                    |
| `/mnt/hdd`         | External HDD (encrypted) | Media, backups, large files, restic cache  |
| `/mnt/transfer`    | exFAT partition (`sdb3`, 2.3 TiB) | Second partition of the same physical disk as `/mnt/hdd`; empty since 2026-11-14 (its 2025-01 film copy was retired, `/mnt/hdd/Filme` is the library); partition and mount stay |

Where personal data lives and which job makes each copy: `dotfiles/docs/storage.md` (the map).

Both HDD mounts and the crypttab entry carry `nofail,x-systemd.device-timeout=30s`
(host config, not in this repo): a missing drive no longer drops boot into the
emergency shell (2026-10-21). With the HDD absent, the immutable bare `/mnt/hdd`
(`scripts/hdd-mountpoint-guard.sh`) keeps HDD containers from starting on the SSD.

## Key directories

```
/home/jkrumm/
├── homelab/              # This repository
├── backups/              # age-encrypted 1Password exports (1password/) only — restic source home-backups
├── ssd/
│   ├── SSD/
│   │   ├── Bilder/       # Photos (ImageShare/ + B2-Mirror/ are
│   │   │                 # leftovers of the decommissioned image-share — kept, restic-covered)
│   │   ├── Bücher/       # Calibre library
│   │   ├── Dokumente/    # Documents (the empty Obsidian/ folder is no sync target)
│   │   ├── Videos/       # Personal videos
│   │   ├── Public/       # ex-dufs public files (service retired, data kept)
│   │   └── Dev/          # incl. image-share/ snapshots (decommissioned, kept, restic-covered)
│   ├── uptime-kuma/      # UptimeKuma data
│   └── image-share/      # decommissioned service's sqlite DB + renditions cache (kept, not backed up)

/mnt/hdd/
├── fuji/
│   ├── RAWs/             # Fuji RAW archive (169 GiB)
│   └── Videos/           # Fuji video archive (not restic-covered, not indexed)
├── Videos/               # Big personal videos (drone, projects); not restic-covered, mirrored to the mini's external SSD by the ext-mirror job
├── restic/cache/         # Restic local cache (~200 MB metadata)
├── beszel.retired-2026/  # Beszel hub data, retired 2026-11-19 (Issue 2102); delete after 2026-12-19
├── filebrowser/          # FileBrowser config
├── backups/              # FPP MySQL hourly dump + weatherorb-accounts/ (retired V1 DB dumps, no longer pulled) (restic source)
└── weatherorb-archive/   # S3 bucket the Mac mini pushes to (sha256-verified, write-once, files sealed chattr +i; NOT restic-backed)
```

# Homelab .env.tpl — secrets and config via 1Password
# Usage: op run --env-file=.env.tpl -- docker compose up -d
# Also used by homelab-private (absolute path reference)

# --- Cloudflare ---
# Token + account + primary zone ID live in `common` — shared with VPS.
# Tunnel token + tunnel ID are per-server (HomeLab and VPS run separate tunnels).
CLOUDFLARE_API_TOKEN=op://common/cloudflare/DNS_API_TOKEN
CLOUDFLARE_ACCOUNT_ID=op://common/cloudflare/ACCOUNT_ID
CLOUDFLARE_ZONE_ID=op://common/cloudflare/ZONE_ID_JKRUMM_COM
CLOUDFLARE_TOKEN=op://homelab/cloudflare-tunnel/TOKEN
CLOUDFLARE_TUNNEL_ID=op://homelab/config/CLOUDFLARE_TUNNEL_ID

# --- Infrastructure ---
POSTGRES_DB_PASSWORD=op://homelab/postgres/PASSWORD
SAMBA_PASSWORD=op://homelab/samba/PASSWORD
COUCHDB_PASSWORD=op://homelab/couchdb/PASSWORD
DUFS_PASSWORD=op://homelab/dufs/PASSWORD
IMMICH_API_KEY=op://homelab/immich/API_KEY

# --- Garmin Collector (HTTP query layer — argo API on VPS reads via Tailscale) ---
GARMIN_EMAIL=op://homelab/garmin/EMAIL
GARMIN_PASSWORD=op://homelab/garmin/PASSWORD
GARMIN_COLLECTOR_TOKEN=op://common/garmin-collector/TOKEN
# Bearer for argo's Gmail endpoint — relogin_auto.py reads the Garmin MFA code from it.
ARGO_API_TOKEN=op://common/api/SECRET

# --- Karakeep (read-later, Tailscale-only — AI tagging via IU unified endpoint) ---
KARAKEEP_NEXTAUTH_SECRET=op://homelab/karakeep/NEXTAUTH_SECRET
KARAKEEP_MEILI_MASTER_KEY=op://homelab/karakeep/MEILI_MASTER_KEY
# IU unified OpenAI-compatible endpoint — same creds modelpick/audio-proxy use
KARAKEEP_OPENAI_BASE_URL=op://common/anthropic/OPENAI_BASE_URL
KARAKEEP_OPENAI_API_KEY=op://common/anthropic/API_KEY

# --- Image Share (personal photo library — public, single host share.jkrumm.com) ---
IMAGE_SHARE_API_SECRET=op://homelab/image-share/API_SECRET
# B2 coordinates reused from the shared bucket item + the service's own scoped key
# (`image-share-b2`: bucket `jkrumm`, prefix `img/`, list/read/write/DELETE — the sole
# delete-capable key wired into automation; see vps/docs/image-cdn.md key inventory).
IMAGE_SHARE_B2_ENDPOINT=op://common/backblaze-s3/ENDPOINT
IMAGE_SHARE_B2_REGION=op://common/backblaze-s3/REGION
IMAGE_SHARE_B2_BUCKET=op://common/backblaze-s3/BUCKET
IMAGE_SHARE_B2_KEY_ID=op://homelab/image-share/B2_KEY_ID
IMAGE_SHARE_B2_APP_KEY=op://homelab/image-share/B2_APP_KEY

# --- Restic → Backblaze B2 ---
# Repo password — NEVER changes after init (encrypts the repo)
RESTIC_PASSWORD=op://homelab/restic/PASSWORD
# Shared B2 application key — APPEND-ONLY (no delete perms, ransomware-safe).
# Also used by VPS pg-dump. Master key for prune/init lives in Private/Backblaze B2.
B2_RESTIC_KEY_ID=op://common/backblaze-s3/ACCESS_KEY_ID
B2_RESTIC_APP_KEY=op://common/backblaze-s3/SECRET_ACCESS_KEY
# UptimeKuma push URL — backup heartbeat (post-success / post-failure)
RESTIC_HEARTBEAT_URL=op://homelab/restic/HEARTBEAT_URL

# --- Slack ---
SLACK_WEBHOOK_ALERTS=op://common/slack/WEBHOOK_ALERTS
SLACK_WEBHOOK_MEDIA=op://common/slack/WEBHOOK_MEDIA
SLACK_WATCHTOWER_URL=op://common/slack/WATCHTOWER_URL

# --- Media (homelab-private services) ---
WIREGUARD_PRIVATE_KEY=op://homelab/protonvpn/WIREGUARD_PRIVATE_KEY
TORRENT_APP_TOKEN=op://homelab/torrent-app/TOKEN
PROWLARR_API_KEY=op://homelab/prowlarr/API_KEY
QBITTORRENT_PASSWORD=op://homelab/qbittorrent/PASSWORD
TMDB_API_KEY=op://homelab/torrent-app/TMDB_API_KEY
OMDB_API_KEY=op://homelab/torrent-app/OMDB_API_KEY
MDBLIST_API_KEY=op://homelab/torrent-app/MDBLIST_API_KEY
TRAKT_CLIENT_ID=op://homelab/torrent-app/TRAKT_CLIENT_ID
JELLYFIN_API_KEY=op://homelab/jellyfin/API_KEY
JELLYFIN_URL=http://jellyfin:8096
JELLYFIN_USER_ID=op://homelab/config/JELLYFIN_USER_ID

# --- Notification URLs (contain push tokens in path) ---
VPN_WATCHDOG_PUSH_URL=op://homelab/config/VPN_WATCHDOG_PUSH_URL

# --- Monitoring (scripts: watchdog, sync.py, monitors.yaml) ---
BETTERSTACK_API_KEY=op://homelab/monitoring/BETTERSTACK_API_KEY
BETTERSTACK_TOKEN=op://homelab/monitoring/BETTERSTACK_TOKEN
UPTIME_MONITOR_TOKEN=op://homelab/monitoring/UPTIME_MONITOR_TOKEN
FPP_SERVER_AUTH=op://homelab/monitoring/FPP_SERVER_AUTH
UPTIME_KUMA_PASSWORD=op://homelab/uptime-kuma/PASSWORD
UPTIME_KUMA_PUSH_TOKEN=op://homelab/uptime-kuma/PUSH_TOKEN

# --- Network config ---
HOMELAB_TAILSCALE_IP=op://homelab/config/HOMELAB_TAILSCALE_IP
VPS_TAILSCALE_IP=op://homelab/config/VPS_TAILSCALE_IP

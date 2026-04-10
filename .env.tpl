# Homelab .env.tpl — secrets and config via 1Password
# Usage: op run --env-file=.env.tpl -- docker compose up -d
# Also used by homelab-private (absolute path reference)

# --- Cloudflare ---
CLOUDFLARE_API_TOKEN=op://common/cloudflare/DNS_API_TOKEN
CLOUDFLARE_TOKEN=op://homelab/cloudflare-tunnel/TOKEN
CLOUDFLARE_TUNNEL_ID=op://homelab/config/CLOUDFLARE_TUNNEL_ID

# --- Infrastructure ---
POSTGRES_DB_PASSWORD=op://homelab/postgres/PASSWORD
SAMBA_PASSWORD=op://homelab/samba/PASSWORD
CALIBRE_PASSWORD=op://homelab/calibre/PASSWORD
COUCHDB_PASSWORD=op://homelab/couchdb/PASSWORD
DUFS_PASSWORD=op://homelab/dufs/PASSWORD
IMMICH_API_KEY=op://homelab/immich/API_KEY

# --- API ---
API_SECRET=op://homelab/api/SECRET
TICKTICK_CLIENT_ID=op://homelab/ticktick/CLIENT_ID
TICKTICK_CLIENT_SECRET=op://homelab/ticktick/CLIENT_SECRET
UPTIME_KUMA_API_KEY=op://homelab/uptime-kuma/API_KEY

# --- Duplicati ---
DUPLICATI_ENCRYPTION_KEY=op://homelab/duplicati/ENCRYPTION_KEY
DUPLICATI_WEBSERVICE_PASSWORD=op://homelab/duplicati/WEBSERVICE_PASSWORD

# --- Notifications ---
NTFY_TOKEN=op://common/ntfy/TOKEN
NTFY_WEB_PUSH_PRIVATE_KEY=op://common/ntfy/WEB_PUSH_PRIVATE_KEY
NTFY_WEB_PUSH_EMAIL_ADDRESS=jkrumm@proton.me

# --- Slack ---
SLACK_WEBHOOK_ALERTS=op://homelab/slack/WEBHOOK_ALERTS
SLACK_WEBHOOK_MEDIA=op://homelab/slack/WEBHOOK_MEDIA
SLACK_WATCHTOWER_URL=op://homelab/slack/WATCHTOWER_URL

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
NTFY_URL=op://homelab/config/NTFY_URL
NTFY_JELLYFIN_URL=op://homelab/config/NTFY_JELLYFIN_URL
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
SIDEPROJECT_DOCKER_STACK_IP=op://homelab/config/SIDEPROJECT_DOCKER_STACK_IP

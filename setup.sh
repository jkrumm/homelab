#!/bin/bash

# --------------------------------------------------
# HomeLab Server Initial Setup
# --------------------------------------------------
# Run as root on a fresh Ubuntu 24.04 server.
# Safe to re-run: idempotent checks for all components.
#
# Installs: Docker, Tailscale, Doppler, git, jq, fail2ban
# Configures: UFW (Tailscale-aware), SSH hardening, sysctl,
#             unattended-upgrades, watchdog cron, log rotation
#
# After this script completes, manually:
#   1. tailscale up --ssh --advertise-tags=tag:homelab
#   2. doppler login && doppler setup  (as jkrumm)
#   3. Create /root/.homelab-watchdog-credentials with:
#      PUSHOVER_USER_KEY, PUSHOVER_API_TOKEN,
#      BETTERSTACK_API_KEY, UPTIME_KUMA_PUSH_TOKEN
#   4. cd ~/homelab && doppler run -- docker compose up -d
# --------------------------------------------------

set -euo pipefail

USERNAME="jkrumm"
USER_HOME="/home/$USERNAME"

if [ "$(id -u)" -ne 0 ]; then
  echo "Please run the script with sudo or as root."
  exit 1
fi

# --------------------------------------------------
# System update
# --------------------------------------------------
echo "=== Updating system ==="
apt update && apt upgrade -y

# --------------------------------------------------
# Essential packages
# --------------------------------------------------
echo "=== Installing essential packages ==="
apt install -y curl git jq ufw fail2ban unattended-upgrades

# --------------------------------------------------
# Docker Engine (includes Compose v2 plugin)
# --------------------------------------------------
if ! command -v docker &>/dev/null; then
  echo "=== Installing Docker Engine ==="
  curl -fsSL https://get.docker.com -o get-docker.sh
  sh get-docker.sh
  rm get-docker.sh
  usermod -aG docker "$USERNAME"
  echo "User $USERNAME added to docker group (re-login required)"
else
  echo "Docker is already installed: $(docker --version)"
fi

# Verify Compose v2 plugin
if docker compose version &>/dev/null; then
  echo "Docker Compose plugin: $(docker compose version)"
else
  echo "WARNING: Docker Compose plugin not found. Install manually."
fi

# --------------------------------------------------
# Tailscale
# --------------------------------------------------
if ! command -v tailscale &>/dev/null; then
  echo "=== Installing Tailscale ==="
  curl -fsSL https://tailscale.com/install.sh | sh
  echo ""
  echo ">>> Tailscale installed. After this script completes, run:"
  echo ">>>   sudo tailscale up --ssh --advertise-tags=tag:homelab"
  echo ""
else
  echo "Tailscale is already installed: $(tailscale version)"
fi

# --------------------------------------------------
# Doppler CLI
# --------------------------------------------------
if ! command -v doppler &>/dev/null; then
  echo "=== Installing Doppler CLI ==="
  apt-get install -y apt-transport-https ca-certificates gnupg
  curl -sLf --retry 3 --tlsv1.2 --proto "=https" \
    'https://packages.doppler.com/public/cli/gpg.DE2A7741A397C129.key' \
    | gpg --dearmor --yes -o /usr/share/keyrings/doppler-archive-keyring.gpg
  echo "deb [signed-by=/usr/share/keyrings/doppler-archive-keyring.gpg] https://packages.doppler.com/public/cli/deb/debian any-version main" \
    | tee /etc/apt/sources.list.d/doppler-cli.list
  apt-get update && apt-get install -y doppler
  echo ""
  echo ">>> Doppler installed. After this script completes, run as $USERNAME:"
  echo ">>>   doppler login && doppler setup"
  echo ""
else
  echo "Doppler is already installed: $(doppler --version)"
fi

# --------------------------------------------------
# SSH key for user (bootstrap only — Tailscale SSH is primary auth)
# --------------------------------------------------
echo "=== Configuring SSH key ==="
SSH_DIR="$USER_HOME/.ssh"
AUTHORIZED_KEYS="$SSH_DIR/authorized_keys"

mkdir -p "$SSH_DIR"
chmod 700 "$SSH_DIR"
touch "$AUTHORIZED_KEYS"
chmod 600 "$AUTHORIZED_KEYS"
chown -R "$USERNAME:$USERNAME" "$SSH_DIR"

# Fetch current public keys from GitHub (bootstrap access before Tailscale SSH is active)
if curl -fsSL --max-time 10 "https://github.com/${USERNAME}.keys" >> "$AUTHORIZED_KEYS" 2>/dev/null; then
  sort -u "$AUTHORIZED_KEYS" -o "$AUTHORIZED_KEYS"
  echo "SSH keys fetched from GitHub"
else
  echo "Warning: Could not fetch SSH keys from GitHub. Add manually to $AUTHORIZED_KEYS"
fi
# Note: once Tailscale SSH is active (step 1 post-script), authorized_keys is not used.

# --------------------------------------------------
# SSH hardening (drop-in config)
# --------------------------------------------------
echo "=== Hardening SSH ==="

# Remove cloud-init override that sets PasswordAuthentication yes
rm -f /etc/ssh/sshd_config.d/50-cloud-init.conf

cat > /etc/ssh/sshd_config.d/99-hardening.conf <<'SSH_CONF'
PermitRootLogin no
PasswordAuthentication no
MaxAuthTries 3
X11Forwarding no
AllowAgentForwarding no
AllowTcpForwarding no
ClientAliveInterval 300
ClientAliveCountMax 2
SSH_CONF

# Validate sshd config before restarting
if sshd -t; then
  systemctl reload ssh
  echo "SSH hardened and reloaded"
else
  echo "ERROR: sshd config validation failed! Removing drop-in."
  rm /etc/ssh/sshd_config.d/99-hardening.conf
  exit 1
fi

# --------------------------------------------------
# UFW (Tailscale-aware firewall)
# --------------------------------------------------
echo "=== Configuring UFW ==="

# Reset to clean state for idempotent re-runs
ufw --force reset

ufw default deny incoming
ufw default allow outgoing

# SSH: allow from Tailscale CGNAT range only
ufw allow from 100.64.0.0/10 to any port 22 proto tcp comment 'SSH via Tailscale'

# Samba: allow from Tailscale CGNAT range only
ufw allow from 100.64.0.0/10 to any port 139 proto tcp comment 'Samba NetBIOS via Tailscale'
ufw allow from 100.64.0.0/10 to any port 445 proto tcp comment 'Samba SMB via Tailscale'

# Deny these ports from all other sources
ufw deny 22/tcp
ufw deny 139/tcp
ufw deny 445/tcp

ufw --force enable
echo "UFW configured (SSH + Samba restricted to Tailscale)"

# --------------------------------------------------
# Fail2Ban
# --------------------------------------------------
echo "=== Configuring Fail2Ban ==="
systemctl enable fail2ban
systemctl start fail2ban

# --------------------------------------------------
# Sysctl hardening
# --------------------------------------------------
echo "=== Applying sysctl hardening ==="
cat > /etc/sysctl.d/99-hardening.conf <<'SYSCTL'
# Network hardening
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.default.send_redirects = 0
net.ipv4.conf.all.accept_source_route = 0
net.ipv4.conf.default.accept_source_route = 0
net.ipv4.conf.all.log_martians = 1
net.ipv4.conf.default.log_martians = 1
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1

# Keep ip_forward enabled (Docker needs it)
net.ipv4.ip_forward = 1

# Kernel hardening
kernel.kptr_restrict = 2
kernel.dmesg_restrict = 1
kernel.yama.ptrace_scope = 2
kernel.unprivileged_bpf_disabled = 1
net.core.bpf_jit_harden = 2
SYSCTL

sysctl --system >/dev/null 2>&1
echo "Sysctl hardening applied"

# --------------------------------------------------
# Unattended-upgrades (blacklist Docker packages)
# --------------------------------------------------
echo "=== Configuring unattended-upgrades ==="
cat > /etc/apt/apt.conf.d/50unattended-upgrades-local <<'UNATTENDED'
// Blacklist Docker packages from auto-upgrade (manual upgrade only)
Unattended-Upgrade::Package-Blacklist {
    "docker-ce";
    "docker-ce-cli";
    "containerd.io";
    "docker-buildx-plugin";
    "docker-compose-plugin";
};

// Auto-reboot at 4 AM if kernel update requires it
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:00";
UNATTENDED

echo "Unattended-upgrades configured (Docker blacklisted, auto-reboot at 4 AM)"


# --------------------------------------------------
# Watchdog cron job
# --------------------------------------------------
echo "=== Setting up watchdog ==="
WATCHDOG_SCRIPT="$USER_HOME/homelab/scripts/homelab_watchdog.sh"
CRON_ENTRY="*/10 * * * * $WATCHDOG_SCRIPT >> /var/log/homelab_watchdog.log 2>&1"

# Ensure watchdog script is executable
if [ -f "$WATCHDOG_SCRIPT" ]; then
  chmod +x "$WATCHDOG_SCRIPT"
fi

if crontab -l 2>/dev/null | grep -q "homelab_watchdog"; then
  echo "Watchdog cron job already exists"
else
  (crontab -l 2>/dev/null; echo "$CRON_ENTRY") | crontab -
  echo "Watchdog cron job added (every 10 minutes)"
fi

# Create watchdog state directory (don't overwrite existing state)
mkdir -p /var/lib/homelab_watchdog
if [ ! -f /var/lib/homelab_watchdog/state ]; then
  echo "0" > /var/lib/homelab_watchdog/state
  echo "Watchdog state initialized to 0 (healthy)"
else
  echo "Watchdog state file exists (not overwriting): $(cat /var/lib/homelab_watchdog/state)"
fi

# --------------------------------------------------
# Log rotation for watchdog
# --------------------------------------------------
echo "=== Configuring log rotation ==="
cat > /etc/logrotate.d/homelab-watchdog <<'LOGROTATE'
/var/log/homelab_watchdog.log {
    weekly
    rotate 4
    compress
    delaycompress
    missingok
    notifempty
    copytruncate
}
LOGROTATE
echo "Watchdog log rotation configured (weekly, 4 rotations, compressed)"

# --------------------------------------------------
# Verification
# --------------------------------------------------
echo ""
echo "=== Verification ==="

echo -n "Docker: "
docker --version 2>/dev/null || echo "NOT INSTALLED"

echo -n "Docker Compose: "
docker compose version 2>/dev/null || echo "NOT INSTALLED"

echo -n "Tailscale: "
tailscale version 2>/dev/null || echo "NOT INSTALLED"

echo -n "Doppler: "
doppler --version 2>/dev/null || echo "NOT INSTALLED"

echo -n "UFW: "
ufw status | head -1

echo -n "Fail2Ban: "
systemctl is-active fail2ban

echo -n "SSH hardening: "
[ -f /etc/ssh/sshd_config.d/99-hardening.conf ] && echo "configured" || echo "NOT CONFIGURED"

echo -n "Sysctl hardening: "
[ -f /etc/sysctl.d/99-hardening.conf ] && echo "configured" || echo "NOT CONFIGURED"

echo -n "Unattended-upgrades: "
[ -f /etc/apt/apt.conf.d/50unattended-upgrades-local ] && echo "configured" || echo "NOT CONFIGURED"

echo -n "Watchdog cron: "
crontab -l 2>/dev/null | grep -q "homelab_watchdog" && echo "active" || echo "NOT CONFIGURED"

echo -n "Log rotation: "
[ -f /etc/logrotate.d/homelab-watchdog ] && echo "configured" || echo "NOT CONFIGURED"


echo ""
echo "=== Setup complete ==="
echo ""
echo "Remaining manual steps:"
echo "  1. sudo tailscale up --ssh --advertise-tags=tag:homelab"
echo "  2. doppler login && doppler setup  (as $USERNAME)"
echo "  3. Create /root/.homelab-watchdog-credentials with:"
echo "     PUSHOVER_USER_KEY=xxx"
echo "     PUSHOVER_API_TOKEN=xxx"
echo "     BETTERSTACK_API_KEY=xxx"
echo "     UPTIME_KUMA_PUSH_TOKEN=xxx"
echo "  4. cd ~/homelab && doppler run -- docker compose up -d"
echo ""

#!/bin/bash

# --------------------------------------------------
# HomeLab Server Initial Setup
# --------------------------------------------------
# Run as root on a fresh Ubuntu 24.04 server.
# Safe to re-run: idempotent checks for all components.
#
# Installs: Docker, Tailscale, 1Password CLI, git, jq, fail2ban
# Configures: UFW (Tailscale-aware), SSH hardening, sysctl,
#             unattended-upgrades, watchdog cron, log rotation
#
# After this script completes, manually:
#   1. tailscale up --ssh --advertise-tags=tag:homelab
#   2. Add OP_SERVICE_ACCOUNT_TOKEN to /home/jkrumm/.profile (outside the
#      BASH_VERSION guard) AND to /root/.profile — cron shells read no profile,
#      so that is the only way the watchdog's `op read` gets a credential
#      (docs/decisions.md -> 1Password CLI in cron shells)
#   3. cd ~/homelab && op run --env-file=.env.tpl -- docker compose up -d
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
# 1Password CLI
# --------------------------------------------------
if ! command -v op &>/dev/null; then
  echo "=== Installing 1Password CLI ==="
  curl -sS https://downloads.1password.com/linux/keys/1password.asc | \
    gpg --dearmor -o /usr/share/keyrings/1password-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/1password-archive-keyring.gpg] https://downloads.1password.com/linux/debian/$(dpkg --print-architecture) stable main" | \
    tee /etc/apt/sources.list.d/1password.list
  apt-get update && apt-get install -y 1password-cli
  echo ""
  echo ">>> 1Password CLI installed. Add OP_SERVICE_ACCOUNT_TOKEN to"
  echo ">>> /home/$USERNAME/.profile (outside the BASH_VERSION guard) and to"
  echo ">>> /root/.profile — cron shells read no profile on their own."
  echo ">>> See docs/decisions.md -> 1Password CLI in cron shells"
  echo ""
else
  echo "1Password CLI is already installed: $(op --version)"
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
# `. /root/.profile` first: the watchdog does `op read` at runtime and cron's `sh`
# reads no profile on its own. Guarded with `[ -r ]` because `.` is a POSIX special
# builtin — dash aborts the whole command line when the file is missing or
# unreadable, which would stop every run rather than just starve it of a credential.
# Shape matches README -> "Install the cron job".
CRON_ENTRY="*/10 * * * * [ -r /root/.profile ] && . /root/.profile; $WATCHDOG_SCRIPT >> /var/log/homelab_watchdog.log 2>&1"

# Ensure watchdog script is executable
if [ -f "$WATCHDOG_SCRIPT" ]; then
  chmod +x "$WATCHDOG_SCRIPT"
fi

# Root's cron shell reads no profile, so the watchdog reaches 1Password only if
# root's own profile carries the token — and nothing else in this repo writes it.
# Create the file when absent so the guard above has something to read; the token
# itself is a secret no installer can fill in (see the verification summary below).
if [ ! -f /root/.profile ]; then
  cat > /root/.profile <<'PROFILE'
# Read by the watchdog cron line (docs/decisions.md -> 1Password CLI in cron shells).
# Export the service-account token below — without it the watchdog exits 1 and
# cannot alert, because its Slack webhook is itself read through `op`.
PROFILE
  chmod 600 /root/.profile
  echo "Created /root/.profile — export OP_SERVICE_ACCOUNT_TOKEN in it"
fi

# Read the current crontab once, before writing anything back. `crontab -l` exits
# non-zero on a host that has no crontab yet, and `grep -v` exits non-zero once it
# has removed every line — either one aborts the whole script under `set -e`.
# Rewriting rather than skipping when an entry is present is also what migrates a
# host still carrying the pre-guard shape.
CRON_CURRENT="$(crontab -l 2>/dev/null || true)"
CRON_KEPT="$(printf '%s\n' "$CRON_CURRENT" | grep -v "homelab_watchdog" || true)"
if [ "$CRON_CURRENT" = "$CRON_KEPT" ]; then
  printf '%s\n' "$CRON_ENTRY" | crontab -
  echo "Watchdog cron job added (every 10 minutes)"
else
  { [ -n "$CRON_KEPT" ] && printf '%s\n' "$CRON_KEPT"; printf '%s\n' "$CRON_ENTRY"; } | crontab -
  echo "Watchdog cron job updated (every 10 minutes)"
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

echo -n "1Password CLI: "
op --version 2>/dev/null || echo "NOT INSTALLED"

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

echo -n "Watchdog credentials: "
if [ -r /root/.profile ] && grep -qE '^[[:space:]]*export[[:space:]]+OP_SERVICE_ACCOUNT_TOKEN=' /root/.profile; then
  echo "configured"
else
  echo "NOT CONFIGURED — the watchdog exits 1 and cannot alert;"
  echo "                     export OP_SERVICE_ACCOUNT_TOKEN in /root/.profile"
fi

echo -n "Log rotation: "
[ -f /etc/logrotate.d/homelab-watchdog ] && echo "configured" || echo "NOT CONFIGURED"


echo ""
echo "=== Setup complete ==="
echo ""
echo "Remaining manual steps:"
echo "  1. sudo tailscale up --ssh --advertise-tags=tag:homelab"
echo "  2. Add OP_SERVICE_ACCOUNT_TOKEN to /home/$USERNAME/.profile (outside the"
echo "     BASH_VERSION guard) and to /root/.profile — cron shells read no profile"
echo "     on their own, and .bashrc only serves interactive shells."
echo "     sudo -i && op whoami (verify root's access)"
echo "  3. cd ~/homelab && op run --env-file=.env.tpl -- docker compose up -d"
echo ""

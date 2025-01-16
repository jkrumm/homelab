#!/bin/bash

# Check if the script is run as root
if [ "$(id -u)" -ne 0 ]; then
  echo "Please run the script with sudo or as root."
  exit 1
fi

# Update the system
echo "Updating the system..."
apt update && apt upgrade -y

# Install necessary packages
echo "Installing necessary packages..."
apt install -y curl ufw fail2ban

# Install Docker
if ! command -v docker &> /dev/null; then
  echo "Installing Docker..."
  curl -fsSL https://get.docker.com -o get-docker.sh
  sh get-docker.sh
  rm get-docker.sh
else
  echo "Docker is already installed."
fi

# Install Docker Compose
if ! command -v docker-compose &> /dev/null; then
  echo "Installing Docker Compose..."
  apt install -y docker-compose
else
  echo "Docker Compose is already installed."
fi

# Set up SSH key for the user
USER_HOME="/home/jkrumm"
SSH_DIR="$USER_HOME/.ssh"
AUTHORIZED_KEYS="$SSH_DIR/authorized_keys"

PUB_KEY="ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQDUUtKs1PzQ2YsNHlAVzJw5YxBOXt3lSghBRgfis4HI17FCzob3ul6ljYP7UFufDFEtQk66MEaapOD8CJ8AzR+GFxqunSuUPVp5Ei1HIrHC/tp9vhd5ga9DmSZ9XBsIBPEAXdY0a+pSW4M8EXJPSlfo4x1BIG7tIuCBB4VRlOc8VDbQkTw4oDVdxSGarniIOnakKQlZ4rmgac5R6LtJOeVw4EHv4pBH+315E6a2uDvyFC1bdsYDdiX88mmFuP0RnWFmGTXyqEkQvUYp4DuigfPBLOyuFC8Rr6zHpP6+Xvokkf/C8yBaPmHHW7HU0mqBSeVPs7087kpZ+jZRKMURuDTMz3jBunDfYDtiYMusvXjShuarqyRHdA1ylpECuVfWeWolHknnzy8lZipmlFLCXhU7x5KkHWX//X8OJyYRpdKjwv1Zw/xrBykD0jsCEACZSd8sew1fNMFUQEpawW94fqRTM7vAWrcia7wf6ajHBEbLrA2jgAYJPIqMQbYBFbwShQc= johannes.krumm@CPMM02DFGMMMD6M"

if [ ! -d "$SSH_DIR" ]; then
  echo "Setting up SSH directory for user jkrumm..."
  mkdir -p "$SSH_DIR"
  chown jkrumm:jkrumm "$SSH_DIR"
  chmod 700 "$SSH_DIR"
fi

if [ ! -f "$AUTHORIZED_KEYS" ]; then
  echo "Creating authorized_keys file and adding SSH key..."
  echo "$PUB_KEY" > "$AUTHORIZED_KEYS"
  chown jkrumm:jkrumm "$AUTHORIZED_KEYS"
  chmod 600 "$AUTHORIZED_KEYS"
else
  if ! grep -q "$PUB_KEY" "$AUTHORIZED_KEYS"; then
    echo "Appending SSH key..."
    echo "$PUB_KEY" >> "$AUTHORIZED_KEYS"
    chown jkrumm:jkrumm "$AUTHORIZED_KEYS"
  fi
fi

# Configure UFW (firewall)
echo "Configuring UFW..."

# Set default policies
ufw default deny incoming
ufw default allow outgoing

# Ensure required ports are open for TCP
declare -a PORTS=("22" "80" "443" "8096")
for PORT in "${PORTS[@]}"; do
  if ! ufw status | grep -qw "$PORT/tcp"; then
    ufw allow "$PORT/tcp"
  fi
done

# Enable UFW with forced confirmation
ufw --force enable

# Configure Fail2Ban
echo "Configuring Fail2Ban..."
if ! systemctl is-enabled --quiet fail2ban; then
  systemctl enable fail2ban
fi

if ! systemctl is-active --quiet fail2ban; then
  systemctl start fail2ban
fi

# Verify configurations
echo "Verifying configurations..."

# Check SSH service status
if systemctl is-active --quiet ssh; then
  echo "SSH service is active."
  ip=$(hostname -I | cut -d' ' -f1)
  echo "Connect to the server using the following command: ssh -p 22 jkrumm@$ip"
else
  echo "SSH service is not active. Please check the configuration."
fi

# Check UFW status
if ufw status | grep -q "Status: active"; then
  echo "UFW is active."
  ufw status
else
  echo "UFW is not active. Please check the configuration."
fi

# Check Fail2Ban status
if systemctl is-active --quiet fail2ban; then
  echo "Fail2Ban is running."
else
  echo "Fail2Ban is not running. Please check the configuration."
fi

echo "Setup complete. Please verify the configurations if necessary."

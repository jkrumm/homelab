#!/bin/bash

# Check if the script is run as root
if [ "$(id -u)" -ne 0 ]; then
  echo "Please run the script with sudo or as root."
  exit 1
fi

# Ensure Doppler is installed
if ! command -v doppler &> /dev/null; then
  echo "Doppler is not installed. Please install it first."
  exit 1
fi

# Retrieve DuckDNS credentials from Doppler
DOMAIN="jkrumm.duckdns.org"
TOKEN=$(doppler secrets get DUCKDNS_TOKEN --plain)

# Path for the DuckDNS update script
DUCKDNS_SCRIPT="/usr/local/bin/duckdns_update.sh"

# Create or update the DuckDNS update script
if [ ! -f "$DUCKDNS_SCRIPT" ]; then
  echo "Creating DuckDNS update script..."
  cat <<EOL > "$DUCKDNS_SCRIPT"
#!/bin/bash
URL="https://www.duckdns.org/update?domains=$DOMAIN&token=$TOKEN&ip="
curl -s "\$URL" > /var/log/duckdns.log
EOL
else
  echo "DuckDNS update script already exists, updating if necessary..."
  CURRENT_DOMAIN=$(grep -oP '(?<=domains=)[^&]*' "$DUCKDNS_SCRIPT")
  CURRENT_TOKEN=$(grep -oP '(?<=token=)[^&]*' "$DUCKDNS_SCRIPT")
  if [ "$CURRENT_DOMAIN" != "$DOMAIN" ] || [ "$CURRENT_TOKEN" != "$TOKEN" ]; then
    echo "Updating DuckDNS credentials in script..."
    sed -i "s/domains=$CURRENT_DOMAIN/domains=$DOMAIN/" "$DUCKDNS_SCRIPT"
    sed -i "s/token=$CURRENT_TOKEN/token=$TOKEN/" "$DUCKDNS_SCRIPT"
  fi
fi

# Make the script executable
chmod +x "$DUCKDNS_SCRIPT"

# Check if the cron job already exists
CRON_JOB="*/5 * * * * $DUCKDNS_SCRIPT"
(crontab -l 2>/dev/null | grep -F "$CRON_JOB") || {
  echo "Setting up cron job for DuckDNS updates..."
  (crontab -l 2>/dev/null; echo "$CRON_JOB") | crontab -
}

echo "DuckDNS setup complete. Your IP will be updated every 5 minutes."

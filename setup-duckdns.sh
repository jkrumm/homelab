#!/bin/bash

# DuckDNS update script path
DUCKDNS_SCRIPT="/usr/local/bin/duckdns_update.sh"

# Function to create or update the DuckDNS update script
create_update_duckdns_script() {
  cat <<EOL > "$DUCKDNS_SCRIPT"
#!/bin/bash
LOG_FILE="/var/log/duckdns.log"
URL="https://www.duckdns.org/update?domains=jkrumm.duckdns.org&token=\$DUCKDNS_TOKEN&ip="
echo "Updating DuckDNS at \$(date)" >> \$LOG_FILE
RESPONSE=\$(curl -s "\$URL")
echo "Response: \$RESPONSE" >> \$LOG_FILE
echo "Update completed at \$(date)" >> \$LOG_FILE
EOL
  chmod +x "$DUCKDNS_SCRIPT"
}

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

# Check if the DUCKDNS_TOKEN environment variable is set
if [ -z "$DUCKDNS_TOKEN" ]; then
  echo "DUCKDNS_TOKEN environment variable is not set. Please set it using Doppler."
  exit 1
else
  echo "DUCKDNS_TOKEN is set."
fi

# Check if DuckDNS update script exists, create or update if necessary
if [ ! -f "$DUCKDNS_SCRIPT" ]; then
  echo "Creating DuckDNS update script..."
  create_update_duckdns_script
else
  echo "DuckDNS update script already exists."
fi

# Check if the cron job already exists and set it if not
CRON_JOB="*/5 * * * * $DUCKDNS_SCRIPT"
(crontab -l 2>/dev/null | grep -F "$CRON_JOB") || {
  echo "Setting up cron job for DuckDNS updates..."
  (crontab -l 2>/dev/null; echo "$CRON_JOB") | crontab -
}

echo "DuckDNS setup complete. Your IP will be updated every 5 minutes."

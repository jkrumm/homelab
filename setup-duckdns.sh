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

# Check if the DUCKDNS_TOKEN environment variable is set
if [ -z "$DUCKDNS_TOKEN" ]; then
  echo "DUCKDNS_TOKEN environment variable is not set. Please set it using Doppler."
  exit 1
else
  echo "DUCKDNS_TOKEN is set."
fi

# Define the domain and script path
DOMAIN="jkrumm.duckdns.org"
DUCKDNS_SCRIPT="/usr/local/bin/duckdns_update.sh"
LOG_FILE="/var/log/duckdns.log"

# Create or update the DuckDNS update script
echo "Creating or updating DuckDNS update script..."
cat <<EOL > "$DUCKDNS_SCRIPT"
#!/bin/bash
URL="https://www.duckdns.org/update?domains=$DOMAIN&token=$DUCKDNS_TOKEN&ip="
/usr/bin/echo "Updating DuckDNS at \$(date)" >> $LOG_FILE
RESPONSE=\$(/usr/bin/curl -s "\$URL")
/usr/bin/echo "Response: \$RESPONSE" >> $LOG_FILE
/usr/bin/echo "Update completed at \$(date)" >> $LOG_FILE
EOL

# Make the script executable
chmod +x "$DUCKDNS_SCRIPT"

# Ensure the log file exists and is writable
touch "$LOG_FILE"
chmod 666 "$LOG_FILE"

# Set up the cron job for the 'jkrumm' user
CRON_JOB="*/5 * * * * /usr/local/bin/duckdns_update.sh"
(crontab -u jkrumm -l 2>/dev/null | grep -F "$CRON_JOB") || {
  echo "Setting up cron job for DuckDNS updates for user 'jkrumm'..."
  (crontab -u jkrumm -l 2>/dev/null; echo "$CRON_JOB") | crontab -u jkrumm -
}

echo "DuckDNS setup complete. Your IP will be updated every 5 minutes."
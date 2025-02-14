#!/bin/bash

# Exit on error
set -e

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo "This script must be run with sudo"
    exit 1
fi

# Function to check and install MySQL client if needed
check_mysql_client() {
    if ! command -v mysql &> /dev/null; then
        echo "MySQL client not found. Installing MySQL 8 client tools..."
        
        # Add MySQL repository key
        curl -fsSL https://repo.mysql.com/RPM-GPG-KEY-mysql-2023 | gpg --dearmor | tee /usr/share/keyrings/mysql.gpg > /dev/null
        
        # Download and install MySQL repository configuration
        wget https://repo.mysql.com/mysql-apt-config_0.8.24-1_all.deb
        DEBIAN_FRONTEND=noninteractive dpkg -i mysql-apt-config_0.8.24-1_all.deb
        
        # Add MySQL repository with signed-by option
        echo "deb [signed-by=/usr/share/keyrings/mysql.gpg] http://repo.mysql.com/apt/ubuntu $(lsb_release -cs) mysql-8.0" | tee /etc/apt/sources.list.d/mysql.list
        
        apt update
        DEBIAN_FRONTEND=noninteractive apt install -y mysql-client
        rm mysql-apt-config_0.8.24-1_all.deb
        mysql --version
    else
        echo "MySQL client is already installed"
    fi
}

# Function to create backup directory
create_backup_dir() {
    BACKUP_DIR="/mnt/hdd/backups"
    mkdir -p "$BACKUP_DIR"
    chown jkrumm:jkrumm "$BACKUP_DIR"
    chmod 755 "$BACKUP_DIR"
}

# Function to perform the backup
perform_backup() {
    BACKUP_FILE="$BACKUP_DIR/fpp.sql"
    START_TIME=$(date +%s)
    START_DATETIME=$(date '+%Y-%m-%d %H:%M:%S')
    
    echo "Backup started at $START_DATETIME"
    echo "Connecting to MySQL server at $DB_HOST:3306..."
    
    mysqldump \
        --result-file="$BACKUP_FILE" \
        --protocol=TCP \
        --skip-lock-tables \
        --skip-add-locks \
        --no-tablespaces \
        --create-options \
        --column-statistics=0 \
        --add-drop-table \
        --host="$DB_HOST" \
        --port=3306 \
        --user=root \
        --password="$DB_ROOT_PW" \
        free-planning-poker

    # Validate backup success
    if [ ! -f "$BACKUP_FILE" ]; then
        echo "Error: Backup file was not created!"
        curl -s "https://uptime.jkrumm.dev/api/push/TVmCcH9Iab?status=down&msg=Backup+file+not+created"
        exit 1
    fi

    # Check if file was modified in the last minute
    FILE_MOD_TIME=$(stat -c %Y "$BACKUP_FILE")
    if [ $((START_TIME - FILE_MOD_TIME)) -gt 60 ]; then
        echo "Error: Backup file was not updated recently!"
        curl -s "https://uptime.jkrumm.dev/api/push/TVmCcH9Iab?status=down&msg=Backup+file+not+updated"
        exit 1
    fi

    # Check if file is empty or too small (less than 1KB)
    if [ ! -s "$BACKUP_FILE" ] || [ $(stat -c %s "$BACKUP_FILE") -lt 1024 ]; then
        echo "Error: Backup file is empty or too small!"
        curl -s "https://uptime.jkrumm.dev/api/push/TVmCcH9Iab?status=down&msg=Backup+file+empty+or+too+small"
        exit 1
    fi

    # Check if file is readable and contains SQL
    if ! grep -q "CREATE TABLE" "$BACKUP_FILE"; then
        echo "Error: Backup file does not contain valid SQL!"
        curl -s "https://uptime.jkrumm.dev/api/push/TVmCcH9Iab?status=down&msg=Invalid+SQL+backup"
        exit 1
    fi

    chown jkrumm:jkrumm "$BACKUP_FILE"
    chmod 644 "$BACKUP_FILE"
    
    END_TIME=$(date +%s)
    END_DATETIME=$(date '+%Y-%m-%d %H:%M:%S')
    DURATION=$((END_TIME - START_TIME))
    
    BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    
    echo "Backup completed at $END_DATETIME"
    echo "Backup file: $BACKUP_FILE"
    echo "Backup size: $BACKUP_SIZE"
    echo "Duration: ${DURATION} seconds"

    # Notify success with backup details
    curl -s "https://uptime.jkrumm.dev/api/push/TVmCcH9Iab?status=up&msg=Backup+completed:+${BACKUP_SIZE}+in+${DURATION}s"
}

# Main execution
echo "Starting FPP database backup process..."
check_mysql_client
create_backup_dir
perform_backup
echo "Backup process completed successfully!" 
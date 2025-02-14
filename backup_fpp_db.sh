#!/bin/bash

# Exit on error
set -e

# Function to check if MySQL 8 client is installed
check_mysql_client() {
    if ! command -v mysql &> /dev/null; then
        echo "MySQL client not found. Installing MySQL 8 client tools..."
        
        # Add MySQL repository key
        curl -fsSL https://repo.mysql.com/RPM-GPG-KEY-mysql-2023 | gpg --dearmor | sudo tee /usr/share/keyrings/mysql.gpg > /dev/null
        
        # Download and install MySQL repository configuration
        wget https://repo.mysql.com/mysql-apt-config_0.8.24-1_all.deb
        DEBIAN_FRONTEND=noninteractive dpkg -i mysql-apt-config_0.8.24-1_all.deb
        
        # Add MySQL repository with signed-by option
        echo "deb [signed-by=/usr/share/keyrings/mysql.gpg] http://repo.mysql.com/apt/ubuntu $(lsb_release -cs) mysql-8.0" | sudo tee /etc/apt/sources.list.d/mysql.list
        
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
    chown -R 1000:1000 "$BACKUP_DIR"
    chmod -R 755 "$BACKUP_DIR"
}

# Function to perform the backup
perform_backup() {
    BACKUP_FILE="$BACKUP_DIR/fpp.sql"
    
    echo "Starting database backup..."
    
    echo "Connecting to MySQL server..."
    
    doppler run --project homelab --config prod -- mysqldump \
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

    chown 1000:1000 "$BACKUP_FILE"
    chmod 644 "$BACKUP_FILE"
    
    echo "Backup completed: $BACKUP_FILE"
}

# Main execution
echo "Starting FPP database backup process..."
check_mysql_client
create_backup_dir
perform_backup
echo "Backup process completed successfully!" 
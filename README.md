# Homelab Setup Guide

## Useful commands
```bash 
# SSH Jump over to the HomeLab using IPv4 of VPS
ssh -J jkrumm@5.75.178.196 jkrumm@homelab.jkrumm.dev
# Forward the Samba SMB port to your local machine using IPv4 of VPS
ssh -L 1445:homelab.jkrumm.dev:445 -J jkrumm@5.75.178.196 jkrumm@homelab.jkrumm.dev
# Then connect your SMB client to:
smb://localhost:1445
```

## Table of Contents

1. [TODOs](#todos)
2. [Subdomain](#subdomain)
3. [Doppler Secrets](#doppler-secrets)
4. [Setup Guide](#setup-guide)
    - [Install Ubuntu Server](#install-ubuntu-server)
    - [Initial Setup on Ubuntu Server](#initial-setup-on-ubuntu-server)
    - [Connect to the Server](#connect-to-the-server)
    - [Configure Doppler](#configure-doppler)
5. [Reusing an Existing Encrypted HDD](#reusing-an-existing-encrypted-hdd)
    - [Prerequisites](#prerequisites)
    - [Step-by-Step Configuration](#step-by-step-configuration)
    - [Mount automatically with new systemd service](#mount-automatically-with-new-systemd-service)
6. [Mount the TRANSFER Partition](#mount-the-transfer-partition)
7. [Enable Jellyfin](#enable-jellyfin)
    - [Install Intel GPU Drivers](#install-intel-gpu-drivers)
    - [Prepare Docker Compose](#prepare-docker-compose)
    - [Start Jellyfin](#start-jellyfin)
    - [Enable Jellyfin Hardware Acceleration](#enable-jellyfin-hardware-acceleration)
8. [Setup Samba](#setup-samba)
9. [Setup Beszel](#setup-beszel)
10. [Setup Dozzle](#setup-dozzle)
11. [Setup UptimeKuma](#setup-uptimekuma)
12. [Setup Duplicati](#setup-duplicati)
13. [Setup Database Backup](#setup-database-backup)
14. [Setup HomeLab self healing watchdog](#setup-homelab-self-healing-watchdog)
15. [Setup Calibre and Calibre-Web](#setup-calibre-and-calibre-web)
    - [Directory Structure](#directory-structure)
    - [Calibre Setup](#calibre-setup)
    - [Calibre-Web Setup](#calibre-web-setup)
    - [Kobo Sync Setup](#kobo-sync-setup)
    - [Features](#features)
16. [Setup Immich](#setup-immich)
    - [Directory Structure](#directory-structure-1)
    - [Hardware Acceleration Prerequisites](#hardware-acceleration-prerequisites)
    - [Initial Setup](#initial-setup)
    - [Immich Configuration](#immich-configuration)

## TODOS

- [x] Change hostname to homelab
- [x] Configure Glance Dashboard https://docs.techdox.nz/glance/
- [x] Setup Duplicati https://docs.techdox.nz/duplicati/
- [x] Backup Jellyfin configuration und jellyfin/config folder continuously
- [x] Backup SSD folder continuously
- [x] Backup to OneDrive
- [x] Use Porkbun API DDNS
- [x] Reconfigure Duplicati to use Transfer partition and joined HDD folder backup
- [x] Configure UptimeKuma https://docs.techdox.nz/uptimekuma/
- [x] Configure Watchtower https://docs.techdox.nz/watchtower/
- [x] Configure FPP database backup
- [x] Setup Dozzle for Docker logs
- [x] Setup Calibre and Calibre-Web
- [x] Setup Kobo sync with Calibre https://code.mendhak.com/kobo-customizations/
- [ ] Setup VPS as IPv4 proxy for Kobo sync:
    - Use VPS with IPv4 as reverse proxy
    - Forward traffic to HomeLab IPv6
    - Configure Kobo to use VPS IPv4 address
    - Update Caddy config on both ends
- [x] Get Dozzle Logs from SideprojectDockerStack
- [x] Get Beszel stats from SideprojectDockerStack
- [ ] Fail2Ban for SSH, Jellyfin, Samba, Immich, MariaDB
- [ ] Plausible for analytics of SnowFinder and jkrumm.dev and photos.jkrumm.dev
- [x] Selfhealing
    - [x] Restart Fritzbox in case it has no connection to interent
    - [x] Restart Docker containers in case Containers not available
    - [x] Restart HomeLab incase internet or container etc still not working
    - [x] Report using Pushover
- [ ] Backup files in clear to Backblaze not SharePoint encrypted
- [ ] Backup my Photoflow images to HomeLab and there to Backblaze

## Subdomain

All setup in Porkbun DNS and automatically IPv6 with [porkbun-ddns](https://github.com/mietzen/porkbun-ddns).
Allow internal IP routing to the Jellyfin server in the FritzBox (Heimnetz -> Netzwerk -> Netzwerkeinstellungen ->
DNS-Rebind-Schutz).
With Caddy already configured, we should then be fully set up.

- home.jkrumm.dev (glance)
- jellyfin.jkrumm.dev
- samba.jkrumm.dev
- beszel.jkrumm.dev
- duplicati.jkrumm.dev

## Doppler Secrets

The following secrets are required to run the HomeLab:

| Name                   | Description                   | Example                                |
|------------------------|-------------------------------|----------------------------------------|
| `DUCKDNS_TOKEN`        | DuckDNS token                 | `12345678-1234-1234-1234-1234567890ab` |
| `DB_HOST`              | MySQL server host for backups | `5.75.178.196`                         |
| `DB_ROOT_PW`           | MySQL root password           | `your-secure-password`                 |
| `POSTGRES_DB_PASSWORD` | Immich Postgres password      | `your-secure-postgres-password`        |

## Setup Guide

### Install Ubuntu Server

1. Download the Ubuntu Server ISO from the [official website](https://ubuntu.com/download/server).
2. Create a bootable USB drive using [Rufus](https://rufus.ie/) or [Balena Etcher](https://www.balena.io/etcher/).
3. Boot from the USB drive and install Ubuntu Server.
4. Follow the on-screen instructions to complete the installation:
    - Hostname: homelab
    - Username: jkrumm
    - Password: Use a strong password
    - Partitioning: Use the entire disk and set up LVM
    - Software selection: OpenSSH server, standard system utilities
    - Additional packages: Install security updates automatically
5. Reboot the server and log in using the credentials you created during the installation.
6. Update the system using the following commands:
   ```bash
   sudo apt update
   sudo apt upgrade -y
   ```

### Initial Setup on Ubuntu Server

1. Install Git:

   ```bash
   sudo apt install git -y
   ```

2. Clone the repository:

   ```bash
   git clone https://github.com/jkrumm/homelab.git
   ```

3. Change to the repository directory:

   ```bash
   cd homelab
   ```

4. Adjust your public SSH key in the `setup.sh` script.
5. Run the setup script with sudo:

   ```bash
   chmod +x setup.sh
   sudo ./setup.sh
   ```

6. TODO: Add a good guide to Secure VPS
7. Disable Root Login:
   ```bash
   sudo vim /etc/ssh/sshd_config
   ```
   Set following lines:
   ```text
   Port 22
   AddressFamily any
   PermitRootLogin no
   PubkeyAuthentication yes
   PasswordAuthentication no
   ```
   Restart the SSH service:
   ```bash
   sudo systemctl restart sshd
   ```

### Connect to the Server

The `setup.sh` script configures the firewall to allow SSH connections. You can now connect to the server using the
command printed at the end of the script.

### Configure Doppler

1. [Install Doppler CLI](https://docs.doppler.com/docs/install-cli)
2. Verify the installation:

   ```bash
   doppler --version
   ```

3. Authenticate with Doppler:

   ```bash
   doppler login
   ```

4. Set the Doppler project:

   ```bash
   doppler setup
   ```

5. Print the Doppler configuration and verify all secrets above are set:

   ```bash
   doppler configs
   doppler secrets
   ```

## Reusing an Existing Encrypted HDD

This guide explains how to configure your new server setup to automatically decrypt and mount an existing LUKS-encrypted
HDD using a previously backed-up keyfile.

### Prerequisites

- LUKS-encrypted HDD: You have an existing encrypted HDD.
- Keyfile: The keyfile is backed up in 1Password.
- Root access: Required for configuration changes.

### Step-by-Step Configuration

#### Restore the Keyfile

Retrieve the keyfile content from your 1Password backup and save it to `/root/.hdd-keyfile` on your new server:

```bash
sudo vim /root/.hdd-keyfile
```

Paste the keyfile content into the file. Secure the keyfile by setting the appropriate permissions:

```bash
sudo chmod 600 /root/.hdd-keyfile
```

#### Identify the Encrypted Partition

Use `blkid` to find the UUID of your encrypted partition:

```bash
sudo blkid
```

Note the UUID of the LUKS-encrypted partition (e.g., `/dev/sdb2`).

#### Configure `/etc/crypttab`

Edit `/etc/crypttab` to set up automatic decryption:

```bash
sudo vim /etc/crypttab
```

Add the following line, replacing `<UUID>` with the UUID from the previous step:

```bash
encrypted_partition UUID=<UUID> /root/.hdd-keyfile luks
```

#### Configure `/etc/fstab`

Edit `/etc/fstab` to ensure the partition is mounted at boot:

```bash
sudo vim /etc/fstab
```

Add the following line to mount the decrypted partition, adjusting the mount point as needed:

```bash
/dev/mapper/encrypted_partition /mnt/hdd ext4 defaults,uid=1000,gid=1000 0 2
```

Make sure the mount point directory exists:

```bash
sudo mkdir -p /mnt/hdd
```

#### Reboot and Verify

Reboot your system to check if everything is configured correctly:

```bash
sudo reboot
```

After rebooting, verify that the partition is automatically decrypted and mounted:

```bash
df -h | grep hdd
```

Update the permissions of the mounted partition:

```bash
sudo chown -R 1000:1000 /mnt/hdd
sudo chmod -R 755 /mnt/hdd
```

If it doesn't mount automatically, check the system logs for errors:

```bash
sudo journalctl -xe
```

### Mount automatically with new systemd service

For a more automated and reliable solution, follow the steps to create a `systemd` service:

1. **Create a Mount Script:**

   Save the following script as `/usr/local/bin/mount_hdd.sh`:

   ```bash
   #!/bin/bash
   if ! mount | grep -q '/mnt/hdd'; then
       mount /dev/mapper/encrypted_partition /mnt/hdd
   fi
   ```

   Make the script executable:

   ```bash
   sudo chmod +x /usr/local/bin/mount_hdd.sh
   ```

2. **Create a Systemd Service File:**

   Create a service file at `/etc/systemd/system/mount-hdd.service`:

   ```ini
   [Unit]
   Description=Mount Encrypted HDD
   Before=jellyfin.service docker.service
   After=systemd-cryptsetup@encrypted_partition.service

   [Service]
   Type=oneshot
   ExecStart=/usr/local/bin/mount_hdd.sh
   RemainAfterExit=yes

   [Install]
   WantedBy=multi-user.target
   ```

3. **Enable the Systemd Service:**

   Enable the service to start at boot:

   ```bash
   sudo systemctl enable mount-hdd.service
   ```

4. **Reboot and Verify:**

   Reboot your system to ensure the service works:

   ```bash
   sudo reboot
   ```

   After reboot, check if the partition is mounted:

   ```bash
   mount | grep /mnt/hdd
   ```

## Mount the `TRANSFER` Partition

1. Create the Mount Point

First, create the directory where you want to mount the `TRANSFER` partition:

```bash
sudo mkdir -p /mnt/transfer
```

2. Update `/etc/fstab`

Edit your `/etc/fstab` file to ensure the `TRANSFER` partition is mounted at boot:

```bash
sudo vim /etc/fstab
```

Add the following line at the end of the file to mount the `TRANSFER` partition. Replace `6785-1A1C` with the UUID of
your `TRANSFER` partition if it's different:

```bash
UUID=6785-1A1C /mnt/transfer exfat defaults,uid=1000,gid=1000 0 0
```

This line will mount the `TRANSFER` partition using the `exfat` filesystem with default options and set the owner to the
user with UID 1000 and group GID 1000.

3. Mount the Partition

To mount the partition immediately without rebooting, use the following command:

```bash
sudo mount /mnt/transfer
```

4. Verify the Mount

Check that the partition is correctly mounted using:

```bash
df -h | grep transfer
```

This command should show the `TRANSFER` partition mounted at `/mnt/transfer`.

5. Set Permissions (Optional)

If you need to adjust the permissions for the mounted partition, you can do so with:

```bash
sudo chown -R 1000:1000 /mnt/transfer
sudo chmod -R 755 /mnt/transfer
```

These commands set the owner and group to UID 1000 and GID 1000, and assign read, write, and execute permissions to the
owner, and read and execute permissions to the group and others.

### Summary

By following these steps, your `TRANSFER` partition will be automatically mounted at `/mnt/transfer` upon system boot.
You can adjust the options in `/etc/fstab` as needed to customize the mount behavior.

## Enable Jellyfin

### Install Intel GPU Drivers

#### Prepare the System

Find user IDs:

```bash
id
```

Adjust `docker-compose.yml` accordingly with the user ID.

Create the `jellyfin` folders:

```bash
mkdir -p /mnt/hdd/jellyfin/config
mkdir -p /mnt/hdd/jellyfin/cache
```

Change the ownership and permissions of the folders:

```bash
sudo chown -R 1000:1000 /mnt/hdd/jellyfin/config
sudo chown -R 1000:1000 /mnt/hdd/jellyfin/cache
sudo chmod -R 755 /mnt/hdd/jellyfin/config
sudo chmod -R 755 /mnt/hdd/jellyfin/cache
```

### Prepare Docker Compose

Ensure Docker is installed:

```bash
sudo apt update
sudo apt install -y docker.io
```

Create the Docker group manually:

```bash
sudo groupadd docker
```

Add your user to the Docker group: (adjust username)

```bash
sudo usermod -aG docker jkrumm
```

Log out and log back in to apply the changes.

Verify that you can run Docker commands without sudo:

```bash
docker ps
```

Restart the Docker service if necessary:

```bash
sudo systemctl restart docker
```

Make sure Docker starts on boot:

```bash
sudo systemctl enable docker
```

### Start Jellyfin

Start Jellyfin using Docker Compose:

```bash
docker-compose up -d
```

Access the Jellyfin web interface:

- Open a web browser and navigate to `http://<your-server-ip>:8096`.
- Follow the on-screen instructions to set up Jellyfin.
    - Username: jkrumm
    - Password: You can find the secret in 1Password
    - Library:
        - Set Language to English
        - Refresh metadata every 30 days
        - Save images in media folders
        - No trickplay or chapter images
        - Libraries:
            - Movies -> /media/movies (Should be existent)
            - Shows -> /media/shows (Should be existent)
            - Kids -> /media/kids (Should be existent)
- Change "Anzeige" settings:
    - Language: English
    - Dates: German
- Change Home settings to remove Kids
- Change Playback:
    - Preferred Audio Language: English
- Change Subtitles:
    - Subtitle mode: No
- Under Administration go to Playback:
    - Transcoding:
        - Enable hardware acceleration using Intel Quick Sync Video
    - General:
        - Rename the server to Jellyfin

### Enable Jellyfin Hardware Acceleration

Install the Intel GPU drivers:

```bash
sudo apt install intel-media-va-driver i965-va-driver vainfo
```

Validate with a connected HDMI monitor:

```bash
vainfo
```

Export the following environment variables:

```bash
export DISPLAY=:0
export LIBVA_DRIVER_NAME=iHD  # or `i965` depending on your driver
```

Verify Device Node Permissions:

```bash
ls -l /dev/dri
```

Ensure `renderD128` is accessible by the `render` group and `card1` by the `video` group. The permissions should look
something like:

```text
crw-rw---- 1 root render 226, 128 Jan 16 15:59 renderD128
crw-rw---- 1 root video  226, 1 Jan 16 19:24 card1
```

Join the video and render group:

```bash
sudo usermod -aG video,render jkrumm
```

Reestablish the session and verify the groups:

```bash
groups
```

Set the render group in the Docker Compose file:

```bash
getent group render
```

```text
render:x:993:jkrumm
```

```yaml
group_add:
  - "993" # Use the render group ID
```

This version should be easier to read and follow, with a clear hierarchy and a comprehensive table of contents for easy
navigation.

## Setup Samba

1. Create a specific SSD folder for Samba:
   ```bash
   sudo mkdir -p /home/jkrumm/ssd
   sudo chown -R 1000:1000 /mnt/ssd/samba
   sudo chmod -R 755 /mnt/ssd/samba
   ```
2. Allow the Samba service through the router port forwarding.
    - IPv6 only (IPv4 is not supported DSLite)
    - Port: 445
    - Protocol: TCP
3. Access the Samba share using the following credentials:
    - Host: `smb://[samba.jkrumm.dev]`
    - Username: jkrumm
    - Password: You can find the secret in 1Password and Doppler

## Setup Beszel

1. Create a specific folder for Beszel data on the HDD:
   ```bash
   sudo mkdir -p /mnt/hdd/beszel
   sudo chown -R 1000:1000 /mnt/hdd/beszel
   chmod 755 /mnt/hdd/beszel
   ```
2. Setup correct drives for SSD and HDD

3. Access the Beszel server using the following credentials:
    - Host: `https://beszel.jkrumm.dev`
    - Username: jkrumm
    - Password: You can find the secret in 1Password and Doppler

## Setup UptimeKuma

1. Create a specific folder for UptimeKuma data on the HDD:
   ```bash
   sudo mkdir -p /mnt/hdd/uptimekuma
   sudo chown -R 1000:1000 /mnt/hdd/uptimekuma
   chmod 755 /mnt/hdd/uptimekuma
   ```

## Setup Dozzle

### Setup certificates

1. Download cert.pem and key.pem from 1Password HomeLab
2. RSync them too the HomeLab and all VPS

    ```bash
    rsync -avz cert.pem key.pem jkrumm@{IP_OF_VPS}:/home/jkrumm/homelab 
    ```
3. Validate looking into the container logs if all good

### Dozzle Authentication Setup

To enable authentication for Dozzle:

1. Create a directory for Dozzle data:

   ```bash
   mkdir dozzle
   ```

2. Generate the password hash and create users.yml:

   ```bash
   # Generate password hash and copy the output
   docker run amir20/dozzle generate --name "Johannes Krumm" --email your@email.com --password your_password jkrumm

   # Create and edit users.yml file
   vim dozzle/users.yml
   ```

   Paste the output from the generate command into users.yml and save the file.

3. The docker-compose.yml is already configured with:

    - Simple authentication enabled
    - 48-hour login session
    - Volume mount for users.yml

4. After making these changes, restart Dozzle:
   ```bash
   docker compose up -d dozzle
   ```

You can now access Dozzle at https://dozzle.jkrumm.dev and log in with username `jkrumm` and your chosen password.

## Setup Duplicati

1. Create a specific folder for Duplicati data on the HDD:
   ```bash
   sudo mkdir -p /mnt/hdd/duplicati
   sudo chown -R 1000:1000 /mnt/hdd/duplicati
   chmod 755 /mnt/hdd/duplicati
   ```
2. create a config and a backups folder in the duplicati folder
   ```bash
   sudo mkdir -p /mnt/hdd/duplicati/config
   sudo mkdir -p /mnt/transfer/duplicati_backups
   sudo chown -R 1000:1000 /mnt/hdd/duplicati/config
   sudo chown -R 1000:1000 /mnt/transfer/duplicati_backups
   sudo chmod -R 755 /mnt/hdd/duplicati/config
   sudo chmod -R 755 /mnt/transfer/duplicati_backups
   ```
3. Access the Duplicati server using the following credentials:

    - Host: `https://duplicati.jkrumm.dev`
    - Username: jkrumm
    - Password: You can find the secret in 1Password and Doppler

4. Backups I run with Duplicati:
    - SSD
        - SSD LOCAL at 03:00
            - Destination: /source/mnt/transfer/duplicati_backups/SSD/
            - Source: /source/ssd/SSD/
            - Config: 100 MByte and intelligent persistence
            - IGNORE:
                - /source/ssd/SSD/Bilder/immich/upload/library
                - /source/ssd/SSD/Bilder/immich/postgres
                - /source/ssd/SSD/Bilder/immich/upload/encoded-video
                - /source/ssd/SSD/Bilder/immich/upload/profile
                - /source/ssd/SSD/Bilder/immich/upload/thumbs
        - SSD OneDrive at 03:30
            - Destination: jkrumm_duplicati_ssd
            - Source: /source/ssd/SSD/
            - Config: 50 MByte and intelligent persistence
            - IGNORE:
                - /source/ssd/SSD/Bilder/immich/upload/library
                - /source/ssd/SSD/Bilder/immich/postgres
                - /source/ssd/SSD/Bilder/immich/upload/encoded-video
                - /source/ssd/SSD/Bilder/immich/upload/profile
                - /source/ssd/SSD/Bilder/immich/upload/thumbs
    - HDD
        - HDD LOCAL at 02:30
            - Destination: /source/mnt/transfer/duplicati_backups/HDD/
            - Source: /source/mnt/hdd/
            - IGNORE: /source/mnt/hdd/Filme/
            - Config: 100 MByte and intelligent persistence
        - HDD OneDrive at 02:40
            - Destination: jkrumm_duplicati_hdd
            - Source: /source/mnt/hdd/
            - IGNORE: /source/mnt/hdd/Filme/
            - Config: 50 MByte and intelligent persistence

## Setup Database Backup

This guide explains how to set up automated MySQL database backups for the Free Planning Poker database.

#### Installation

1. The backup script is located in the repository at `backup_fpp_db.sh`. Make it executable:

   ```bash
   chmod +x backup_fpp_db.sh
   ```

2. Create the backup directory and log file with proper permissions:

   ```bash
   sudo mkdir -p /mnt/hdd/backups
   sudo touch /mnt/hdd/backups/backup.log
   sudo chown -R jkrumm:jkrumm /mnt/hdd/backups
   sudo chmod 644 /mnt/hdd/backups/backup.log
   ```

3. Create and secure the credentials file:
   ```bash
   sudo bash -c 'cat > /root/.fpp-db-credentials << EOL
   DB_HOST=""
   DB_ROOT_PW=""
   EOL'
   ```
4. Secure the credentials file

   ```bash
   sudo chmod 600 /root/.fpp-db-credentials
   sudo chown root:root /root/.fpp-db-credentials
   ```

5. Verify the security of the credentials file:

   ```bash
   # This should show only root can read/write the file
   sudo ls -l /root/.fpp-db-credentials
   # Expected output: -rw------- 1 root root ...

   # This should fail (permission denied) - confirming non-root users can't read it
   cat /root/.fpp-db-credentials
   # Expected output: cat: /root/.fpp-db-credentials: Permission denied
   ```

6. Test the backup script:
   ```bash
   sudo ./backup_fpp_db.sh
   ```

#### Setting up Automated Backups

1. Edit the root's crontab to set up nightly backups:

   ```bash
   sudo crontab -e
   ```

2. Add the following line to run the backup daily at 2 AM UTC:

   ```bash
   0 2 * * * cd /home/jkrumm/homelab && /home/jkrumm/homelab/backup_fpp_db.sh >> /mnt/hdd/backups/backup.log 2>&1
   ```

3. Add the following line to run the backup hourly:

   ```bash
   0 * * * * cd /home/jkrumm/homelab && /home/jkrumm/homelab/backup_fpp_db.sh >> /mnt/hdd/backups/backup.log 2>&1
   ```

#### Backup Details

- Location: Backups are stored in `/mnt/hdd/backups/fpp.sql`
- Frequency: Hourly (every hour at minute 0)
- Logging: All backup operations are logged to `/mnt/hdd/backups/backup.log`
- Retention: Each backup overwrites the previous one (Duplicati handles versioning)
- Security: Credentials are stored in a root-only accessible file
- Monitoring: Backup status is reported to UptimeKuma

#### Monitoring

You can monitor the backup process by:

1. Checking the log file:

   ```bash
   sudo tail -f /mnt/hdd/backups/backup.log
   ```

2. Verifying the backup file exists and is recent:

   ```bash
   ls -l /mnt/hdd/backups/fpp.sql
   ```

3. Checking UptimeKuma dashboard for backup status notifications

The backup file is automatically included in your configured Duplicati backups of the HDD partition.

## Setup HomeLab self healing watchdog

1. The backup script is located in the repository at `homelab_watchdog.sh`. Make it executable:

   ```bash
   chmod +x homelab_watchdog.sh
   ```

2. Create the log and state directories with proper permissions:

```text
/var/lib/ → stateful
/var/log/ → logs
/var/run/ → lock & pid
```

```bash
# State + Queue
sudo mkdir -p /var/lib/homelab_watchdog
sudo touch /var/lib/homelab_watchdog/state
sudo touch /var/lib/homelab_watchdog/pushover_queue
sudo chown -R root:root /var/lib/homelab_watchdog
sudo chmod 700 /var/lib/homelab_watchdog

# Log
sudo touch /var/log/homelab_watchdog.log
sudo chown root:root /var/log/homelab_watchdog.log
sudo chmod 644 /var/log/homelab_watchdog.log

# Lockfile wird im Skript selbst erzeugt
# -> kein manuelles Touch nötig, nur Verzeichnis sicherstellen
sudo mkdir -p /var/run
```

3. Create and secure the credentials file:
   ```bash
   sudo bash -c 'cat > /root/.homelab-watchdog-credentials << EOL
   BETTERSTACK_TOKEN=""
   PUSHOVER_USER_KEY=""
   PUSHOVER_API_TOKEN=""
   FRITZ_USER=""
   FRITZ_PASSWORD=""
   EOL'
   ```
4. Secure the credentials file

   ```bash
   sudo chmod 600 /root/.homelab-watchdog-credentials
   sudo chown root:root /root/.homelab-watchdog-credentials
   ```

5. Verify the security of the credentials file:

   ```bash
   # This should show only root can read/write the file
   sudo ls -l /root/.homelab-watchdog-credentials
   # Expected output: -rw------- 1 root root ...

   # This should fail (permission denied) - confirming non-root users can't read it
   cat /root/.homelab-watchdog-credentials
   # Expected output: cat: /root/.homelab-watchdog-credentials: Permission denied
   ```

6. Test the self-healing script:
   ```bash
   sudo ./homelab_watchdog.sh
   ```

#### Check current reboot status

```bash
cat /var/lib/homelab_watchdog/reboot_tracker
```

#### Resume automatic recovery (remove manual intervention flag)

```bash
rm /var/lib/homelab_watchdog/manual_intervention_required
```

#### Reset reboot counter (if needed for testing)

```bash
echo "$(date +%Y-%m-%d):0" > /var/lib/homelab_watchdog/reboot_tracker
```

#### Check current escalation state

```bash
cat /var/lib/homelab_watchdog/state
```

#### Setting up Automated Backups

1. Edit the root's crontab to set up nightly backups:

   ```bash
   sudo crontab -e
   ```

2. Add the following line to run the self healing every 10 minutes:

   ```bash
    */10 * * * * /home/jkrumm/homelab/homelab_watchdog.sh
   ```

#### WatchDog Automation Details

- **Location**: Script runs from `/home/jkrumm/homelab/homelab_watchdog.sh`
- **Frequency**: Every 5 minutes (adjustable based on your needs)
- **Logging**: All operations are logged to `/var/log/homelab_watchdog.log`
- **Locking**: Built-in file locking prevents overlapping executions
- **State Management**: Persistent state tracking prevents unnecessary Fritz!Box restarts
- **Security**: Credentials stored in root-only accessible file
- **Notifications**: Real-time push notifications via Pushover

#### Monitoring

You can monitor the backup process by:

1. Checking the log file:

   ```bash
   sudo tail -f /var/log/homelab_watchdog.log
   ```

2. Check current escalation state:

   ```bash
    sudo cat /var/lib/homelab_watchdog/state
   ```

## Setup Calibre and Calibre-Web

### Directory Structure

1. Create the base directory structure:

   ```bash
   # Create main directories
   mkdir -p /home/jkrumm/ssd/SSD/Bücher/{calibre,calibre-web}/{config,library}

   # Create incoming folder for automatic book imports
   mkdir -p /home/jkrumm/ssd/SSD/Bücher/calibre/library/incoming
   ```

2. Final directory layout:

   ```bash
   /home/jkrumm/ssd/SSD/Bücher/
   ├── calibre/
   │   ├── config/     # Calibre configuration
   │   └── library/    # Calibre book library
   │       └── incoming/   # Drop your books here for automatic import
   └── calibre-web/
       └── config/     # Calibre-Web configuration
   ```

3. Directory mappings in containers:
    - Calibre sees:
        - `/config` → `/home/jkrumm/ssd/SSD/Bücher/calibre/config`
        - `/library` → `/home/jkrumm/ssd/SSD/Bücher/calibre/library`
    - Calibre-Web sees:
        - `/config` → `/home/jkrumm/ssd/SSD/Bücher/calibre-web/config`
        - `/books` → `/home/jkrumm/ssd/SSD/Bücher/calibre/library`

### Calibre Setup

1. Access Calibre at `https://calibre.jkrumm.dev`
2. Login with:
    - Username: jkrumm
    - Password: Set in `CALIBRE_PASSWORD` environment variable
3. During initial setup:
    - When prompted for library location, set it to: `/library`
    - This maps to `/home/jkrumm/ssd/SSD/Bücher/calibre/library` on your host system
    - Do not use the default `/config/Calibre Library` path
4. Managing Books:
    - Using Auto-Add folder:
        - In Calibre, go to Preferences > Adding books
        - Enable "Automatically add books" and set the folder to `/library/incoming`
        - Now any books you place in `/home/jkrumm/ssd/SSD/Bücher/calibre/library/incoming` will be automatically
          imported
        - Calibre will move the books to the appropriate location in the library after import
    - After adding books:
        - Calibre will automatically fetch metadata
        - You can edit metadata by selecting a book and clicking "Edit metadata"
        - Configure metadata download sources in Preferences > Metadata download
        - Books will be available in both Calibre and Calibre-Web

### Calibre-Web Setup

1. Access Calibre-Web at `https://books.jkrumm.dev`
2. Initial setup:
    - Default login: admin/admin123
    - Change the admin password immediately
    - Set library path to: `/books`
    - This will use the same library that you manage with Calibre
3. Configure Calibre Binaries:
    - Go to Admin > Basic Configuration > External Binaries
    - Set "Path to Calibre Binaries" to: `/usr/bin`
    - Save the settings
    - Features enabled by binaries:
        - Ebook format conversion
        - Metadata embedding
        - Email sending with conversion
        - Enhanced cover generation
4. Additional Configuration:
    - Set up user accounts and permissions under Admin > Users
    - Calibre-Web uses the metadata that was fetched by Calibre
    - No additional metadata configuration needed as this is handled by Calibre
5. Test Format Conversion:
    - Select any book
    - Click on "Convert" button
    - Choose a different format
    - If conversion works, the binaries are correctly configured

### Kobo Sync Setup

Due to IPv6-only connectivity (DS-Lite) from the ISP and Kobo's limited IPv6 support, we need a specific setup for Kobo
sync to work properly.

#### Calibre-Web Configuration

1. Enable Kobo Sync in Admin Settings:

    - Go to Admin > Configuration > Edit Basic Configuration
    - Expand "Feature Configuration"
    - Enable "Kobo sync"
    - Enable "Proxy unknown requests to Kobo Store"
    - Set "Server External Port" to match Calibre-Web's port (8083)

2. Configure User Settings:
    - Go to your user profile
    - Enable "Sync only books in selected shelves with Kobo" (recommended)
    - Create and configure shelves for syncing:
        - Click "Create a Shelf"
        - Name your shelf (e.g., "Fantasy", "Science", etc.)
        - Check "Sync this shelf with Kobo device"
    - Click "Create/View" under "Kobo Sync Token"
    - Copy the generated API endpoint URL

#### Kobo Device Configuration

1. Connect Kobo to Computer:

    - Connect via USB
    - Enable connection on Kobo screen
    - Access Kobo's root directory

2. Edit Configuration File:

   ```bash
   # Navigate to the hidden .kobo folder
   cd .kobo/Kobo/
   # Backup original config
   cp "Kobo eReader.conf" "Kobo eReader.conf.backup"
   # Edit the config file
   vim "Kobo eReader.conf"
   ```

3. Update API Endpoint:

    - Find the [OneStoreServices] section
    - Replace or add the api_endpoint line:

   ```ini
   api_endpoint=http://192.168.1.100:8083/kobo/YOURTOKEN
   ```

    - Use your local IPv4 address instead of the domain due to IPv6 limitations
    - Replace YOURTOKEN with your actual token from Calibre-Web

4. Sync Your Device:
    - Safely eject the Kobo
    - On the Kobo home screen, tap the Sync icon
    - First sync may take longer as it builds the database

#### Known Limitations

1. IPv6 Connectivity:

    - Our setup uses local IPv4 addressing due to Kobo's limited IPv6 support
    - External access through books.jkrumm.dev won't work for Kobo sync
    - This is a limitation of DS-Lite internet connection and Kobo's networking capabilities

2. Store Integration:
    - Book covers in Kobo Store may show as generic white pages
    - Overdrive section might have missing covers
    - These are known limitations of the sync implementation

For more detailed information about Kobo sync setup and troubleshooting, refer
to [JC Palmer's comprehensive guide](https://jccpalmer.com/posts/setting-up-kobo-sync-with-calibre-web/).

### Features

- Calibre provides full library management capabilities
- Calibre-Web offers a user-friendly interface for browsing and reading
- Both services share the same library folder
- Automatic updates via Watchtower
- Monitoring via Glance dashboard
- Reverse proxy through Caddy with automatic HTTPS
- All configurations and library are backed up via Duplicati

## Setup Immich

[Immich](https://immich.app/) is a self-hosted photo and video backup solution designed to be a Google Photos
alternative.

### Directory Structure

1. Create necessary directories for Immich:

   ```bash
   # Create immich directories
   mkdir -p /home/jkrumm/ssd/SSD/Bilder/immich/{upload,postgres}
   sudo chown -R 1000:1000 /home/jkrumm/ssd/SSD/Bilder/immich
   sudo chmod -R 755 /home/jkrumm/ssd/SSD/Bilder/immich
   ```

### Hardware Acceleration Prerequisites

1. Install required packages for Intel GPU support:

   ```bash
   sudo apt-get update
   sudo apt-get install -y intel-media-va-driver i965-va-driver vainfo
   ```

2. Verify GPU detection:

   ```bash
   vainfo
   ```

   This should show information about your Intel GPU capabilities.

3. Add your user to the required groups:

   ```bash
   sudo usermod -aG video,render jkrumm
   ```

4. Verify device permissions:

   ```bash
   ls -la /dev/dri
   ```

   Make sure the devices are accessible to the video and render groups.

### Initial Setup

1. Make sure the POSTGRES_DB_PASSWORD is set in Doppler

2. Start the Immich services using Docker Compose:

   ```bash
   doppler run -- docker compose up -d
   ```

3. Access Immich at `https://immich.jkrumm.dev`

4. On first access, you will need to create an admin account:
    - Enter a valid email address
    - Create a secure password
    - Enter your name

### Immich Configuration

1. **Machine Learning:** Go to Administration > Machine Learning:
    - Verify that the machine learning service is connected
    - Enable Smart Search and People Recognition as needed

2. **Hardware Acceleration:** The system is configured with hardware acceleration for better performance:
    - **Video Transcoding:** Uses Intel Quick Sync Video via the integrated GPU
    - **Machine Learning:** Uses OpenVINO for accelerated AI processing
    - To verify hardware acceleration is working:
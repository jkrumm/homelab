# Homelab Setup Guide

## Table of Contents

1. [TODOs](#todos)
2. [Doppler Secrets](#doppler-secrets)
3. [Setup Guide](#setup-guide)
    - [Install Ubuntu Server](#install-ubuntu-server)
    - [Initial Setup on Ubuntu Server](#initial-setup-on-ubuntu-server)
    - [Connect to the Server](#connect-to-the-server)
    - [Configure Doppler](#configure-doppler)
    - [Configure DuckDNS](#configure-duckdns)
4. [Reusing an Existing Encrypted HDD](#reusing-an-existing-encrypted-hdd)
    - [Prerequisites](#prerequisites)
    - [Step-by-Step Configuration](#step-by-step-configuration)
5. [Enable Jellyfin](#enable-jellyfin)
    - [Prepare Docker Compose](#prepare-docker-compose)
    - [Start Jellyfin](#start-jellyfin)
    - [Enable Jellyfin SSH](#enable-jellyfin-ssh)
    - [Enable Jellyfin Hardware Acceleration](#enable-jellyfin-hardware-acceleration)

## TODOS

- [x] Change hostname to homelab
- [x] Configure Glance Dashboard https://docs.techdox.nz/glance/
- [x] Setup Duplicati https://docs.techdox.nz/duplicati/
- [x] Backup Jellyfin configuration und jellyfin/config folder continuously
- [x] Backup SSD folder continuously
- [ ] Backup to OneDrive
- [ ] Use Porkbun API DDNS https://docs.linuxserver.io/images/docker-duckdns/
- [ ] Configure UptimeKuma https://docs.techdox.nz/uptimekuma/
- [ ] Configure Watchtower https://docs.techdox.nz/watchtower/
- [ ] Move SnowFinder App to the server
- [ ] Plausible for analytics of SnowFinder and jkrumm.dev

## Subdomain

- home.jkrumm.dev (glance)
- jellyfin.jkrumm.dev
- samba.jkrumm.dev
- beszel.jkrumm.dev
- duplicati.jkrumm.dev

## Doppler Secrets

The following secrets are required to run the HomeLab:

| Name            | Description   | Example                                |
|-----------------|---------------|----------------------------------------|
| `DUCKDNS_TOKEN` | DuckDNS token | `12345678-1234-1234-1234-1234567890ab` |

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

### Configure DuckDNS

1. [Sign up for DuckDNS](https://www.duckdns.org/)
2. Create a domain and token.
3. Set the DuckDNS token in Doppler.
4. Add the DuckDNS domain in the `setup-duckdns.sh` script.
5. Run the `setup-duckdns.sh` script with sudo:

   ```bash
   chmod +x setup-duckdns.sh
   doppler run --command="sudo -E ./setup-duckdns.sh"
   ```

6. Check your IP address with:

   ```bash
    curl -6 -s https://ifconfig.co
    ```

7. Check the logs in /var/log/duckdns.log and verify that the IP address is the same:

   ```bash
   tail -f /var/log/duckdns.log
   ```

8. Check in duckdns.org if the IP address is updated.

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
- Activate automatic port mapping UPnP
- Change "Anzeige" settings:
    - Language: English
    - Dates: German
- Change Home settings to remove Kids
- Change Playback:
    - Maximum Audio Channels: Stereo
    - Preferred Audio Language: English
    - Uncheck Play default audio track
    - Home Streaming Quality: 60 Mbps
    - Google Cast: 10 Mbps
    - Maximum allowed streaming resolution: 1080p
    - Check Limit maximum supported video resolution
- Change Subtitles:
    - Subtitle mode: No
- Under Administration go to Playback:
    - Transcoding:
        - Enable hardware acceleration using VA-API
    - General:
        - Rename the server to Jellyfin

### Enable Jellyfin SSH

Configure a CNAME record in your DNS provider to point to your DuckDNS domain.

`CNAME jellyfin.jkrumm.dev -> jkrumm.duckdns.org`

Allow internal IP routing to the Jellyfin server in the FritzBox (Heimnetz -> Netzwerk -> Netzwerkeinstellungen ->
DNS-Rebind-Schutz)

With Caddy already configured, you should then be fully set up.

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
  - "993"  # Use the render group ID
```

This version should be easier to read and follow, with a clear hierarchy and a comprehensive table of contents for easy
navigation.

### Setup Samba

1. Create a specific SSD folder for Samba:
    ```bash
    sudo mkdir -p /home/jkrumm/ssd
    sudo chown -R 1000:1000 /mnt/ssd/samba
    sudo chmod -R 755 /mnt/ssd/samba
    ```
2. Configure a new CNAME record in your DNS provider to point to your DuckDNS domain.
   `CNAME samba.jkrumm.dev -> jkrumm.duckdns.org`
3. Allow the Samba service through the router port forwarding.
    - IPv6 only (IPv4 is not supported DSLite)
    - Port: 445
    - Protocol: TCP
4. Access the Samba share using the following credentials:
    - Host: `smb://[samba.jkrumm.dev]`
    - Username: jkrumm
    - Password: You can find the secret in 1Password and Doppler

### Setup Beszel

1. Create a specific folder for Beszel data on the HDD:
    ```bash
    sudo mkdir -p /mnt/hdd/beszel
    sudo chown -R 1000:1000 /mnt/hdd/beszel
    chmod 755 /mnt/hdd/beszel
    ```
2. Setup correct drives for SSD and HDD
3. Allow internal IP routing to the Beszel server in the FritzBox (Heimnetz -> Netzwerk -> Netzwerkeinstellungen ->
   DNS-Rebind-Schutz)
4. Configure a new CNAME record in your DNS provider to point to your DuckDNS domain.
   `CNAME beszel.jkrumm.dev -> jkrumm.duckdns.org`
5. Access the Beszel server using the following credentials:
    - Host: `https://beszel.jkrumm.dev`
    - Username: jkrumm
    - Password: You can find the secret in 1Password and Doppler

### Setup Duplicati

1. Create a specific folder for Duplicati data on the HDD:
    ```bash
    sudo mkdir -p /mnt/hdd/duplicati
    sudo chown -R 1000:1000 /mnt/hdd/duplicati
    chmod 755 /mnt/hdd/duplicati
    ```
2. create a config and a backups folder in the duplicati folder
    ```bash
    sudo mkdir -p /mnt/hdd/duplicati/config
    sudo mkdir -p /mnt/hdd/duplicati/backups
    sudo chown -R 1000:1000 /mnt/hdd/duplicati/config
    sudo chown -R 1000:1000 /mnt/hdd/duplicati/backups
    sudo chmod -R 755 /mnt/hdd/duplicati/config
    sudo chmod -R 755 /mnt/hdd/duplicati/backups
    ```
3. Configure a new CNAME record in your DNS provider to point to your DuckDNS domain.
   `CNAME duplicati.jkrumm.dev -> jkrumm.duckdns.org`
4. Access the Duplicati server using the following credentials:
    - Host: `https://duplicati.jkrumm.dev`
    - Username: jkrumm
    - Password: You can find the secret in 1Password and Doppler
5. Backups I run with Duplicati:
    - SSD
      -  To HDD at 04:00
        - Source: /source/mnt/ssd/SSD
        - Destination: /source/mnt/hdd/duplicati/backups/SSD
      - TO OneDrive at 04:30
        - Source: /source/mnt/ssd/SSD
        - Destination: OneDrive /backups/SSD
    - Jellyfin Config
      - To HDD at 05:00
        - Source: /source/mnt/hdd/jellyfin/config
        - Destination: /source/mnt/hdd/duplicati/backups/jellyfin
      - To OneDrive at 05:10
        - Source: /source/mnt/hdd/jellyfin/config
        - Destination: OneDrive /backups/jellyfin
    - Duplicati config
      - To HDD at 05:20
        - Source: /source/mnt/hdd/duplicati/config
        - Destination: /source/mnt/hdd/duplicati/backups/duplicati
      - To OneDrive at 05:30
        - Source: /source/mnt/hdd/duplicati/config
        - Destination: OneDrive /backups/duplicati


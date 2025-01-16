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

Backup Jellyfin configuration und jellyfin/config folder.

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

6. Make sure you see both the IPv4 and IPv6 address in the DuckDNS dashboard.

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
/dev/mapper/encrypted_partition /mnt/hdd ext4 defaults 0 2
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

If it doesn't mount automatically, check the system logs for errors:

```bash
sudo journalctl -xe
```

## Enable Jellyfin

### Install Intel GPU Drivers

#### Prepare the System

Find user IDs:

```bash
id
```

Adjust `docker-compose.yml` accordingly with the user ID.

Create the `jellyfin_data` folder:

```bash
mkdir -p ~/jellyfin/config
mkdir -p ~/jellyfin/cache
sudo usermod -aG docker jkrumm
sudo chown -R jkrumm:jkrumm ~/jellyfin
sudo chmod -R 755 ~/jellyfin
sudo chown -R 1000:1000 ~/jellyfin/config
sudo chown -R 1000:1000 ~/jellyfin/cache
sudo chmod -R 755 ~/jellyfin/config
sudo chmod -R 755 ~/jellyfin/cache
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
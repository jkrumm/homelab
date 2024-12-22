# Homelab

## Doppler Secrets
The following secrets are required to run the HomeLab

| Name             | Description | Example                                |
|------------------|-------------|----------------------------------------|
| `DUCKDNS_TOKEN`  | DuckDNS token | `12345678-1234-1234-1234-1234567890ab` |

## Setup Guide
### Install Ubuntu Server
1. Download the Ubuntu Server ISO from the [official website](https://ubuntu.com/download/server).
2. Create a bootable USB drive using [Rufus](https://rufus.ie/) or [Balena Etcher](https://www.balena.io/etcher/).
3. Boot from the USB drive and install Ubuntu Server.
4. Follow the on-screen instructions to complete the installation. I used the following settings:
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
4. Adjust your public SSH key in the setup.sh script:
5. Run the setup script with sudo:
```bash
chmod +x setup.sh
sudo ./setup.sh
```
### Connect to the Server
The setup.sh script configures the firewall to allow SSH connections. You can now connect to the server using the command printed in the end of the script.

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
2. Create a domain and token
3. Set the DuckDNS token in Doppler
4. Add the DuckDNS domain in the setup-duckdns.sh script
5. Run the setup-duckdns.sh script with sudo:
```bash
chmod +x setup-duckdns.sh
sudo ./setup-duckdns.sh
```
# Homelab

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
sudo ./setup.sh
```
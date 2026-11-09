#!/usr/bin/env bash
# One-time setup for an Ubuntu 22.04/24.04 VM (Oracle Always Free, etc.).
# Run as root from a checkout:   sudo bash scripts/vm-setup.sh
# Optional: BRANCH=arena/eecba1c8-bedwarsweb REPO_URL=https://github.com/Qynl/BedwarsWeb.git sudo -E bash scripts/vm-setup.sh
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this with sudo (it installs Docker and opens ports)." >&2
  exit 1
fi

REPO_URL="${REPO_URL:-https://github.com/Qynl/BedwarsWeb.git}"
BRANCH="${BRANCH:-main}"
APP_DIR="${APP_DIR:-/opt/skyshard}"

echo "Installing Docker and git…"
apt-get update
apt-get install -y git curl ca-certificates
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

# Small AMD free instances have 1 GB RAM; a swap file keeps the image build from being OOM-killed.
if [ ! -f /swapfile ] && [ "$(awk '/MemTotal/ {print $2}' /proc/meminfo)" -lt 2000000 ]; then
  echo "Adding a 2 GB swap file for the build…"
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

if [ -d "$APP_DIR/.git" ]; then
  echo "Updating $APP_DIR…"
  git -C "$APP_DIR" fetch --all
  git -C "$APP_DIR" checkout "$BRANCH"
  git -C "$APP_DIR" pull --ff-only
else
  echo "Cloning $BRANCH into $APP_DIR…"
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi

cd "$APP_DIR"
echo "Building and starting the website + Minecraft listener…"
docker compose up -d --build

# Ubuntu's firewall, if present. Oracle images also have iptables rules; add the
# two app ports there as well. Do not flush existing rules (SSH lives there).
if command -v ufw >/dev/null 2>&1; then
  ufw allow 22/tcp >/dev/null || true
  ufw allow 3000/tcp >/dev/null || true
  ufw allow 25565/tcp >/dev/null || true
  ufw --force enable >/dev/null || true
fi
if command -v iptables >/dev/null 2>&1; then
  for port in 3000 25565; do
    iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null || iptables -I INPUT -p tcp --dport "$port" -j ACCEPT
  done
  if command -v netfilter-persistent >/dev/null 2>&1; then netfilter-persistent save >/dev/null 2>&1 || true; fi
fi

IP="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
echo
echo "Done."
echo "  Website:   http://${IP}:3000"
echo "  Minecraft: ${IP}:25565  (Java 1.21.8, direct connection)"
echo
echo "Make sure the cloud firewall/security list also allows TCP 3000 and 25565."
echo "Keep this VM running and the address stays fixed (use a Reserved Public IP)."

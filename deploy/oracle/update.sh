#!/usr/bin/env bash
# Pulls the latest coldopen and restarts it. Films, accounts and settings are kept.
set -euo pipefail
cd "$HOME/coldopen"
git pull --ff-only
cd deploy/oracle
sudo docker compose up -d --build
sudo docker image prune -f >/dev/null
echo "Updated."

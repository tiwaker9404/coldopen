#!/usr/bin/env bash
# Sets up the hosted coldopen on a fresh Oracle Cloud (or any Ubuntu) server. Run it twice:
#   1st run: installs Docker, opens the firewall, downloads coldopen, writes .env with the
#            secrets it can make itself, and tells you which blanks to fill in
#   2nd run: checks the blanks are filled, then builds and starts everything
#
#   curl -fsSL https://raw.githubusercontent.com/tiwaker9404/coldopen/main/deploy/oracle/setup.sh | bash
set -euo pipefail

REPO="${REPO:-https://github.com/tiwaker9404/coldopen}"
DIR="$HOME/coldopen"
say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

say "1/4  Docker"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER" || true
fi

say "2/4  Firewall: allow web traffic (Oracle's Ubuntu image blocks it by default)"
for port in 80 443; do
  sudo iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null ||
    sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport "$port" -j ACCEPT
done
if command -v netfilter-persistent >/dev/null; then sudo netfilter-persistent save >/dev/null; fi

say "3/4  coldopen"
if [ -d "$DIR/.git" ]; then git -C "$DIR" pull --ff-only; else git clone "$REPO" "$DIR"; fi
cd "$DIR/deploy/oracle"

if [ ! -f .env ]; then
  ip=$(curl -fsS https://api.ipify.org)
  # a free hostname that points at this server, good enough for a real HTTPS certificate
  domain="${DOMAIN:-$(echo "$ip" | tr . -).sslip.io}"
  umask 077
  cat > .env <<EOF
# --- made for you ---
DOMAIN=$domain
PUBLIC_URL=https://$domain
DB_PASSWORD=$(openssl rand -hex 16)
SESSION_SECRET=$(openssl rand -hex 32)
VIEW_SALT=$(openssl rand -hex 16)
LLM_PROVIDER=openai
LLM_BASE_URL=https://api.groq.com/openai/v1
LLM_MODEL=openai/gpt-oss-120b
LLM_FALLBACK_MODEL=openai/gpt-oss-20b

# --- fill these in (nano: arrow keys to move, Ctrl+O Enter to save, Ctrl+X to quit) ---
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
LLM_API_KEY=
SHARE_URL=
SHARE_TOKEN=
EOF
  say "Almost there. Your app will live at: https://$domain"
  echo "Set your GitHub App's callback URL to:  https://$domain/auth/github/callback"
  echo "Then fill in the five blanks:            nano $DIR/deploy/oracle/.env"
  echo "And run this script again."
  exit 0
fi

say "4/4  Starting coldopen"
missing=$(grep -E '^(GITHUB_CLIENT_ID|GITHUB_CLIENT_SECRET|LLM_API_KEY|SHARE_URL|SHARE_TOKEN)=\s*$' .env | cut -d= -f1 || true)
if [ -n "$missing" ]; then
  echo "Still empty in .env:"
  echo "$missing"
  echo "Fill them in with: nano $DIR/deploy/oracle/.env"
  exit 1
fi
sudo docker compose up -d --build
domain=$(grep '^DOMAIN=' .env | cut -d= -f2)
say "coldopen is starting at https://$domain"
echo "The first start takes a minute while the HTTPS certificate is issued."
echo "Logs: cd $DIR/deploy/oracle && sudo docker compose logs -f app"

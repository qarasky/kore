#!/usr/bin/env bash
# Kore installer: sets up Kore with Docker Compose in one go.
#
#   curl -fsSL https://raw.githubusercontent.com/qarasky/kore/main/install.sh | bash
#
# It asks a few questions (or takes the defaults), writes .env, creates and
# initializes the data directory, pulls the images and starts Kore. Safe to
# re-run: an existing install is left alone. Read it before you run it; it
# is short.
#
# Non-interactive use: set any of these (and it will not ask):
#   KORE_DIR=~/kore            where the compose files and .env go
#   KORE_DATA_DIR=<dir>/data   where files and the database live
#   KORE_ADMIN_EMAIL=...       KORE_ADMIN_PASSWORD=... (random if unset)
#   KORE_BIND=127.0.0.1|0.0.0.0   KORE_PORT=8080
#   KORE_VERSION=latest        image tag
#   KORE_REF=main              git ref the compose files are fetched from
#   KORE_SOURCE_DIR=<checkout> copy the compose files from here instead
#   KORE_YES=1                 never prompt
set -euo pipefail

REPO="qarasky/kore"
REF="${KORE_REF:-main}"
RAW="https://raw.githubusercontent.com/${REPO}/${REF}"

if [ -t 1 ]; then B=$'\033[1m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; N=$'\033[0m'; else B=; G=; Y=; R=; N=; fi
say()  { printf '%s\n' "$*"; }
step() { printf '%s==>%s %s\n' "$B" "$N" "$*"; }
warn() { printf '%swarning:%s %s\n' "$Y" "$N" "$*" >&2; }
die()  { printf '%serror:%s %s\n' "$R" "$N" "$*" >&2; exit 1; }

# Prompts read from the terminal even when the script itself comes from a pipe.
INTERACTIVE=0
if [ -z "${KORE_YES:-}" ] && [ -r /dev/tty ] && [ -w /dev/tty ]; then INTERACTIVE=1; fi

# ask VAR "Question" "default": keeps a value already set in the environment.
ask() {
  local var="$1" q="$2" def="$3" ans=""
  if [ -n "${!var:-}" ]; then return; fi
  if [ "$INTERACTIVE" = 1 ]; then
    printf '%s [%s]: ' "$q" "$def" >/dev/tty
    IFS= read -r ans </dev/tty || true
  fi
  printf -v "$var" '%s' "${ans:-$def}"
}

confirm() { # confirm "Question" -> 0 for yes (default yes); no when not interactive
  local ans=""
  [ "$INTERACTIVE" = 1 ] || return 1
  printf '%s [Y/n]: ' "$1" >/dev/tty
  IFS= read -r ans </dev/tty || true
  case "$ans" in [nN]*) return 1 ;; *) return 0 ;; esac
}

random_password() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 36 | tr -dc 'A-Za-z0-9' | head -c 20 || true
  else
    LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 20 || true
  fi
}

fetch() { # fetch FILE DEST
  if [ -n "${KORE_SOURCE_DIR:-}" ]; then
    cp "${KORE_SOURCE_DIR}/$1" "$2"
  elif command -v curl >/dev/null 2>&1; then
    curl -fsSL "${RAW}/$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then
    wget -q "${RAW}/$1" -O "$2"
  else
    die "need curl or wget to download the compose files"
  fi
}

# --- Docker ---------------------------------------------------------------
step "Checking Docker"
command -v docker >/dev/null 2>&1 || die "Docker is not installed. See https://docs.docker.com/engine/install/ and run this again."
docker compose version >/dev/null 2>&1 || die "The Docker Compose plugin is missing (\`docker compose\`). See https://docs.docker.com/compose/install/linux/"
docker info >/dev/null 2>&1 || die "Cannot talk to the Docker daemon. Is it running, and is your user in the 'docker' group? (sudo usermod -aG docker \$USER, then log in again)"

# --- Already installed? ---------------------------------------------------
KORE_DIR="${KORE_DIR:-$HOME/kore}"
if [ -f "$KORE_DIR/.env" ]; then
  say "Kore is already installed in $KORE_DIR (found .env); leaving it alone."
  say "To update:  cd $KORE_DIR && docker compose pull && docker compose up -d"
  exit 0
fi

# --- Questions ------------------------------------------------------------
step "Configuring Kore"
ask KORE_DIR "Install directory (compose files and .env)" "$KORE_DIR"
ask KORE_DATA_DIR "Data directory (files and database)" "$KORE_DIR/data"
ask KORE_ADMIN_EMAIL "Admin email" "admin@example.com"
GENERATED=0
if [ -z "${KORE_ADMIN_PASSWORD:-}" ]; then
  if [ "$INTERACTIVE" = 1 ]; then
    printf 'Admin password (at least 8 characters, empty = generate one): ' >/dev/tty
    IFS= read -r -s KORE_ADMIN_PASSWORD </dev/tty || true
    printf '\n' >/dev/tty
  fi
  if [ -z "${KORE_ADMIN_PASSWORD:-}" ]; then KORE_ADMIN_PASSWORD="$(random_password)"; GENERATED=1; fi
fi
ask KORE_BIND "Listen on (127.0.0.1 = this machine only, 0.0.0.0 = LAN/Tailscale too)" "127.0.0.1"
ask KORE_PORT "Port" "8080"

[ "${#KORE_ADMIN_PASSWORD}" -ge 8 ] || die "the admin password must be at least 8 characters"
case "$KORE_ADMIN_PASSWORD" in *\'*|*$'\n'*) die "the admin password must not contain a single quote or a newline" ;; esac
[ "$KORE_ADMIN_PASSWORD" != "change-me" ] || die "pick a real admin password"
case "$KORE_PORT" in ''|*[!0-9]*) die "the port must be a number" ;; esac

KORE_DIR="${KORE_DIR/#\~/$HOME}"
KORE_DATA_DIR="${KORE_DATA_DIR/#\~/$HOME}"
case "$KORE_DIR" in /*) ;; *) KORE_DIR="$PWD/$KORE_DIR" ;; esac
case "$KORE_DATA_DIR" in /*) ;; *) KORE_DATA_DIR="$PWD/$KORE_DATA_DIR" ;; esac
KORE_UID="$(id -u)"
KORE_GID="$(id -g)"

# --- Data directory -------------------------------------------------------
step "Preparing the data directory $KORE_DATA_DIR"
if [ -e "$KORE_DATA_DIR" ] && [ ! -d "$KORE_DATA_DIR" ]; then die "$KORE_DATA_DIR exists and is not a directory"; fi
if [ ! -d "$KORE_DATA_DIR" ]; then
  mkdir -p "$KORE_DATA_DIR" 2>/dev/null || {
    command -v sudo >/dev/null 2>&1 || die "cannot create $KORE_DATA_DIR (try a path you can write to)"
    sudo mkdir -p "$KORE_DATA_DIR" && sudo chown "$KORE_UID:$KORE_GID" "$KORE_DATA_DIR"
  }
fi
HAVE_VOLUME=0
if [ -f "$KORE_DATA_DIR/.kore-volume" ]; then
  HAVE_VOLUME=1
  say "Found an existing Kore data volume there; reusing it."
elif [ -n "$(ls -A "$KORE_DATA_DIR" 2>/dev/null)" ]; then
  die "$KORE_DATA_DIR is not empty and is not a Kore data volume; refusing to use it. Pick an empty directory."
fi
[ -w "$KORE_DATA_DIR" ] || die "$KORE_DATA_DIR is not writable by you ($(id -un)). Fix its owner (chown $KORE_UID:$KORE_GID) and run again."

# --- Files ----------------------------------------------------------------
step "Writing the compose files to $KORE_DIR"
mkdir -p "$KORE_DIR"
fetch docker-compose.yml "$KORE_DIR/docker-compose.yml"
fetch Caddyfile "$KORE_DIR/Caddyfile"
umask 077
cat >"$KORE_DIR/.env" <<EOF
# Written by install.sh. See .env.example in the repository for every option.
KORE_ADMIN_EMAIL='${KORE_ADMIN_EMAIL}'
KORE_ADMIN_PASSWORD='${KORE_ADMIN_PASSWORD}'
KORE_DATA_DIR='${KORE_DATA_DIR}'
KORE_BIND=${KORE_BIND}
KORE_PORT=${KORE_PORT}
KORE_UID=${KORE_UID}
KORE_GID=${KORE_GID}
KORE_VERSION=${KORE_VERSION:-latest}
EOF
chmod 600 "$KORE_DIR/.env"
umask 022

# --- Start ----------------------------------------------------------------
cd "$KORE_DIR"
step "Pulling the images"
# A failed pull is not fatal here (e.g. images already present locally);
# \`up\` below fails loudly if an image is really missing.
docker compose pull --quiet --ignore-pull-failures </dev/null || true
if [ "$HAVE_VOLUME" = 0 ]; then
  step "Initializing the data volume"
  # -T and </dev/null: when the script comes from a pipe, docker must not read it from stdin.
  docker compose run --rm -T api kore init </dev/null
fi
step "Starting Kore"
docker compose up -d </dev/null

printf 'Waiting for Kore to come up'
UP=0
for _ in $(seq 1 60); do
  if (command -v curl >/dev/null 2>&1 && curl -fsS -o /dev/null "http://127.0.0.1:${KORE_PORT}/api/healthz" 2>/dev/null) ||
     (command -v wget >/dev/null 2>&1 && wget -q -O /dev/null "http://127.0.0.1:${KORE_PORT}/api/healthz" 2>/dev/null); then UP=1; break; fi
  printf '.'; sleep 2
done
printf '\n'
[ "$UP" = 1 ] || die "Kore did not become healthy. See: cd $KORE_DIR && docker compose ps && docker compose logs"

# --- Reboot safety: make Docker wait for the data disk ---------------------
if command -v findmnt >/dev/null 2>&1 && command -v systemctl >/dev/null 2>&1 && [ -d /etc/systemd/system ]; then
  MNT="$(findmnt -n -o TARGET -T "$KORE_DATA_DIR" 2>/dev/null || true)"
  if [ -n "$MNT" ] && [ "$MNT" != "/" ] && [ ! -f /etc/systemd/system/docker.service.d/wait-for-kore-data.conf ]; then
    say
    say "The data directory is on its own mount ($MNT). If Docker starts before that disk"
    say "is mounted after a reboot, Kore stays down until you restart it."
    if command -v sudo >/dev/null 2>&1 && confirm "Make Docker wait for $MNT at boot?"; then
      sudo mkdir -p /etc/systemd/system/docker.service.d
      printf '[Unit]\nRequiresMountsFor=%s\n' "$MNT" | sudo tee /etc/systemd/system/docker.service.d/wait-for-kore-data.conf >/dev/null
      sudo systemctl daemon-reload
      say "Done."
    else
      say "To do it yourself: put 'RequiresMountsFor=$MNT' under [Unit] in"
      say "/etc/systemd/system/docker.service.d/wait-for-kore-data.conf, then 'sudo systemctl daemon-reload'."
    fi
  fi
fi

# --- Done -----------------------------------------------------------------
HOST="127.0.0.1"
if [ "$KORE_BIND" = "0.0.0.0" ]; then
  HOST="$(hostname -I 2>/dev/null | awk '{print $1}')"; HOST="${HOST:-this-server}"
elif [ "$KORE_BIND" != "127.0.0.1" ]; then
  HOST="$KORE_BIND"
fi
say
printf '%sKore is running.%s\n' "$G" "$N"
say "  Open:      http://${HOST}:${KORE_PORT}"
say "  Sign in:   ${KORE_ADMIN_EMAIL}"
if [ "$GENERATED" = 1 ]; then say "  Password:  ${KORE_ADMIN_PASSWORD}   (generated; change it under Account after signing in)"; else say "  Password:  the one you chose"; fi
say "  Files:     $KORE_DIR   (docker-compose.yml, .env)"
say "  Data:      $KORE_DATA_DIR"
say
say "Update later:        cd $KORE_DIR && docker compose pull && docker compose up -d"
say "Public HTTPS (Cloudflare Tunnel, etc.): https://github.com/${REPO}#cloudflare-tunnel"

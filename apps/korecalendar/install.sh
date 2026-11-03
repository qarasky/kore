#!/usr/bin/env bash
# KoreCalendar installer: sets up KoreCalendar with Docker Compose in one go.
#
#   curl -fsSL https://raw.githubusercontent.com/qarasky/korecalendar/main/install.sh | bash
#
# It asks a few questions (or takes the defaults), writes .env, creates and
# initializes the data directory, pulls the images and starts the calendar. The
# first account is created in the browser afterwards. Safe to re-run: an
# existing install is left alone. Read it before you run it; it is short.
#
# Piped like this, it installs the newest release: it looks it up, downloads the
# compose files of that release and pulls the matching images from ghcr.io, pinned
# to that exact version (KORECAL_VERSION in .env). Nothing is built, and git is not needed.
#
# Run from inside a clone (git clone ... && cd korecalendar && ./install.sh) it
# builds the images from that checkout and installs in place (the .env is written
# there): for trying a branch or your own changes.
#
# If the images cannot be pulled, the installer clones the repository into
# <install dir>/src and builds them there instead; that needs git, and takes a
# few minutes the first time.
#
# Non-interactive use: set any of these (and it will not ask):
#   KORECAL_DIR=~/korecalendar     where the compose files and .env go (default: the
#                                  checkout when run from one, else ~/korecalendar)
#   KORECAL_DATA_DIR=<dir>-data    where the database lives (default: next to it)
#   KORECAL_BIND=127.0.0.1|0.0.0.0 KORECAL_PORT=8080
#   KORECAL_VERSION=0.1.0          image tag to install: a release number, latest or edge
#                                  (default: the newest release)
#   KORECAL_REF=v0.1.0             git ref (branch or tag) the compose files come from
#                                  (default: the tag of KORECAL_VERSION, or main)
#   KORECAL_REPO_URL=<git url>     where to clone the source from when the images
#                                  cannot be pulled (default: the GitHub repository)
#   KORECAL_SOURCE_DIR=<checkout>  install from a local checkout: copies the
#                                  compose files and builds the images from it
#                                  instead of pulling them
#   KORECAL_YES=1                  never prompt
set -euo pipefail

REPO="qarasky/korecalendar"
REF="${KORECAL_REF:-main}"
RAW="https://raw.githubusercontent.com/${REPO}/${REF}"
REPO_URL="${KORECAL_REPO_URL:-https://github.com/${REPO}.git}"
SOURCE_INSTALL=0
IN_PLACE=0

if [ -t 1 ]; then B=$'\033[1m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; N=$'\033[0m'; else B=; G=; Y=; R=; N=; fi
say()  { printf '%s\n' "$*"; }
step() { printf '%s==>%s %s\n' "$B" "$N" "$*"; }
warn() { printf '%swarning:%s %s\n' "$Y" "$N" "$*" >&2; }
die()  { printf '%serror:%s %s\n' "$R" "$N" "$*" >&2; exit 1; }

# Run from inside a checkout of the repository: build from it (see above).
if [ -z "${KORECAL_SOURCE_DIR:-}" ] && [ -f "${BASH_SOURCE[0]:-}" ]; then
  HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  if [ -f "$HERE/docker-compose.yml" ] && [ -f "$HERE/api/Dockerfile" ] && [ -f "$HERE/web/Dockerfile" ]; then
    KORECAL_SOURCE_DIR="$HERE"
  fi
fi

# Prompts read from the terminal even when the script itself comes from a pipe.
INTERACTIVE=0
if [ -z "${KORECAL_YES:-}" ] && [ -r /dev/tty ] && [ -w /dev/tty ]; then INTERACTIVE=1; fi

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

fetch() { # fetch FILE DEST
  if [ -n "${KORECAL_SOURCE_DIR:-}" ]; then
    cp "${KORECAL_SOURCE_DIR}/$1" "$2"
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
# Run from a checkout, the installation lives in that checkout by default (so a later
# `git pull` brings the new compose files); otherwise in ~/korecalendar.
KORECAL_DIR="${KORECAL_DIR:-${KORECAL_SOURCE_DIR:-$HOME/korecalendar}}"
KORECAL_DIR="${KORECAL_DIR/#\~/$HOME}"
if [ -f "$KORECAL_DIR/.env" ]; then
  say "KoreCalendar is already installed in $KORECAL_DIR (found .env); leaving it alone."
  say "To update, see docs/deploy.md (Updating)."
  exit 0
fi

# --- Questions ------------------------------------------------------------
step "Configuring KoreCalendar"
ask KORECAL_DIR "Install directory (compose files and .env)" "$KORECAL_DIR"
ask KORECAL_DATA_DIR "Data directory (the database)" "${KORECAL_DIR%/}-data"
ask KORECAL_BIND "Listen on (127.0.0.1 = this machine only, 0.0.0.0 = LAN/Tailscale too)" "127.0.0.1"
ask KORECAL_PORT "Port" "8080"

case "$KORECAL_PORT" in ''|*[!0-9]*) die "the port must be a number" ;; esac
case "$KORECAL_BIND" in ''|*[!0-9.:a-fA-F]*) die "the listen address must be an IP address such as 127.0.0.1 or 0.0.0.0" ;; esac

KORECAL_DIR="${KORECAL_DIR/#\~/$HOME}"
KORECAL_DATA_DIR="${KORECAL_DATA_DIR/#\~/$HOME}"
case "$KORECAL_DIR" in /*) ;; *) KORECAL_DIR="$PWD/$KORECAL_DIR" ;; esac
case "$KORECAL_DATA_DIR" in /*) ;; *) KORECAL_DATA_DIR="$PWD/$KORECAL_DATA_DIR" ;; esac
case "$KORECAL_DIR$KORECAL_DATA_DIR" in *\'*|*$'\n'*) die "paths must not contain a single quote or a newline" ;; esac
KORECAL_UID="$(id -u)"
KORECAL_GID="$(id -g)"

# The directory may have been changed at the prompt: the same "already installed" rule applies.
if [ -f "$KORECAL_DIR/.env" ]; then
  say "KoreCalendar is already installed in $KORECAL_DIR (found .env); leaving it alone."
  exit 0
fi

# --- Data directory -------------------------------------------------------
step "Preparing the data directory $KORECAL_DATA_DIR"
if [ -e "$KORECAL_DATA_DIR" ] && [ ! -d "$KORECAL_DATA_DIR" ]; then die "$KORECAL_DATA_DIR exists and is not a directory"; fi
if [ ! -d "$KORECAL_DATA_DIR" ]; then
  mkdir -p "$KORECAL_DATA_DIR" 2>/dev/null || {
    command -v sudo >/dev/null 2>&1 || die "cannot create $KORECAL_DATA_DIR (try a path you can write to)"
    sudo mkdir -p "$KORECAL_DATA_DIR" && sudo chown "$KORECAL_UID:$KORECAL_GID" "$KORECAL_DATA_DIR"
  }
fi
HAVE_VOLUME=0
if [ -f "$KORECAL_DATA_DIR/.korecal-volume" ]; then
  HAVE_VOLUME=1
  say "Found an existing KoreCalendar data volume there; reusing it."
elif [ -n "$(ls -A "$KORECAL_DATA_DIR" 2>/dev/null)" ]; then
  die "$KORECAL_DATA_DIR is not empty and is not a KoreCalendar data volume; refusing to use it. Pick an empty directory."
fi
[ -w "$KORECAL_DATA_DIR" ] || die "$KORECAL_DATA_DIR is not writable by you ($(id -un)). Fix its owner (chown $KORECAL_UID:$KORECAL_GID) and run again."

# --- Which release --------------------------------------------------------
# The compose files and the images must belong together: unless told otherwise, install
# the newest release, with the files of its tag.
latest_release() { # prints the newest release tag (v1.2.3), or nothing
  local body=""
  if command -v curl >/dev/null 2>&1; then
    body="$(curl -fsSL --max-time 15 "https://api.github.com/repos/${REPO}/releases/latest" 2>/dev/null || true)"
  elif command -v wget >/dev/null 2>&1; then
    body="$(wget -q -T 15 -O - "https://api.github.com/repos/${REPO}/releases/latest" 2>/dev/null || true)"
  fi
  printf '%s' "$body" | sed -n 's/.*"tag_name": *"\(v[^"]*\)".*/\1/p' | head -n1
}
if [ -z "${KORECAL_SOURCE_DIR:-}" ]; then
  if [ -z "${KORECAL_VERSION:-}" ] && [ -z "${KORECAL_REF:-}" ]; then
    TAG="$(latest_release)"
    if [ -n "$TAG" ]; then
      KORECAL_VERSION="${TAG#v}"; REF="$TAG"
    else
      warn "could not look up the newest release; using the tags latest and main instead"
    fi
  elif [ -z "${KORECAL_REF:-}" ]; then
    case "${KORECAL_VERSION}" in [0-9]*) REF="v${KORECAL_VERSION}" ;; esac
  fi
  RAW="https://raw.githubusercontent.com/${REPO}/${REF}"
  step "Installing KoreCalendar ${KORECAL_VERSION:-latest} (files from ${REF})"
fi

# --- Files ----------------------------------------------------------------
step "Writing the compose files to $KORECAL_DIR"
if ! mkdir -p "$KORECAL_DIR" 2>/dev/null; then
  command -v sudo >/dev/null 2>&1 || die "cannot create $KORECAL_DIR (try a path you can write to)"
  sudo mkdir -p "$KORECAL_DIR" && sudo chown "$KORECAL_UID:$KORECAL_GID" "$KORECAL_DIR"
fi
# Installing in place (the install directory is the checkout itself): nothing to copy or link.
IN_PLACE=0
if [ -n "${KORECAL_SOURCE_DIR:-}" ] && [ "$(cd "$KORECAL_DIR" && pwd -P)" = "$(cd "$KORECAL_SOURCE_DIR" && pwd -P)" ]; then IN_PLACE=1; fi
if [ "$IN_PLACE" = 0 ]; then
  fetch docker-compose.yml "$KORECAL_DIR/docker-compose.yml"
  fetch Caddyfile "$KORECAL_DIR/Caddyfile"
  if [ -n "${KORECAL_SOURCE_DIR:-}" ]; then
    # A local install builds its images from the checkout.
    SRC="$(cd "$KORECAL_SOURCE_DIR" && pwd)"
    ln -sfn "$SRC/api" "$KORECAL_DIR/api"
    ln -sfn "$SRC/web" "$KORECAL_DIR/web"
  fi
fi
umask 077
cat >"$KORECAL_DIR/.env" <<EOF2
# Written by install.sh. See .env.example in the repository for every option.
KORECAL_DATA_DIR='${KORECAL_DATA_DIR}'
KORECAL_BIND=${KORECAL_BIND}
KORECAL_PORT=${KORECAL_PORT}
KORECAL_UID=${KORECAL_UID}
KORECAL_GID=${KORECAL_GID}
KORECAL_VERSION=${KORECAL_VERSION:-latest}
EOF2
chmod 600 "$KORECAL_DIR/.env"
umask 022

# --- Start ----------------------------------------------------------------
cd "$KORECAL_DIR"
if [ -n "${KORECAL_SOURCE_DIR:-}" ]; then
  SOURCE_INSTALL=1
  step "Building the images from $KORECAL_SOURCE_DIR"
  docker compose build </dev/null
else
  step "Pulling the images"
  if ! docker compose pull --quiet </dev/null 2>/dev/null; then
    warn "the images could not be pulled (is ${KORECAL_VERSION:-latest} published? is the network up?); building them from source instead"
    command -v git >/dev/null 2>&1 || die "git is needed to build from source. Install it (for example: sudo apt install git) and run this again."
    SRC="$KORECAL_DIR/src"
    step "Fetching the source into $SRC"
    git clone --quiet --depth 1 --branch "$REF" "$REPO_URL" "$SRC" </dev/null || die "could not clone $REPO_URL ($REF)"
    # Use the compose files that belong to this source, and build from it.
    cp "$SRC/docker-compose.yml" "$KORECAL_DIR/docker-compose.yml"
    cp "$SRC/Caddyfile" "$KORECAL_DIR/Caddyfile"
    ln -sfn "$SRC/api" "$KORECAL_DIR/api"
    ln -sfn "$SRC/web" "$KORECAL_DIR/web"
    SOURCE_INSTALL=1
    step "Building the images (a few minutes the first time)"
    docker compose build </dev/null
  fi
fi
if [ "$HAVE_VOLUME" = 0 ]; then
  step "Initializing the data volume"
  # -T and </dev/null: when the script comes from a pipe, docker must not read it from stdin.
  docker compose run --rm -T --no-deps api korecalendar init </dev/null
fi
step "Starting KoreCalendar"
docker compose up -d --wait </dev/null || die "KoreCalendar did not become healthy. See: cd $KORECAL_DIR && docker compose ps && docker compose logs"

printf 'Waiting for KoreCalendar to answer'
UP=0
for _ in $(seq 1 60); do
  if (command -v curl >/dev/null 2>&1 && curl -fsS -o /dev/null "http://127.0.0.1:${KORECAL_PORT}/login" 2>/dev/null) ||
     (command -v wget >/dev/null 2>&1 && wget -q -O /dev/null "http://127.0.0.1:${KORECAL_PORT}/login" 2>/dev/null); then UP=1; break; fi
  printf '.'; sleep 2
done
printf '\n'
[ "$UP" = 1 ] || die "KoreCalendar did not answer on port ${KORECAL_PORT}. See: cd $KORECAL_DIR && docker compose ps && docker compose logs"

# --- Reboot safety: make Docker wait for the data disk ---------------------
if command -v findmnt >/dev/null 2>&1 && command -v systemctl >/dev/null 2>&1 && [ -d /etc/systemd/system ]; then
  MNT="$(findmnt -n -o TARGET -T "$KORECAL_DATA_DIR" 2>/dev/null || true)"
  if [ -n "$MNT" ] && [ "$MNT" != "/" ] && [ ! -f /etc/systemd/system/docker.service.d/wait-for-korecalendar-data.conf ]; then
    say
    say "The data directory is on its own mount ($MNT). If Docker starts before that disk"
    say "is mounted after a reboot, KoreCalendar stays down until you restart it."
    if command -v sudo >/dev/null 2>&1 && confirm "Make Docker wait for $MNT at boot?"; then
      sudo mkdir -p /etc/systemd/system/docker.service.d
      printf '[Unit]\nRequiresMountsFor=%s\n' "$MNT" | sudo tee /etc/systemd/system/docker.service.d/wait-for-korecalendar-data.conf >/dev/null
      sudo systemctl daemon-reload
      say "Done."
    else
      say "To do it yourself: put 'RequiresMountsFor=$MNT' under [Unit] in"
      say "/etc/systemd/system/docker.service.d/wait-for-korecalendar-data.conf, then 'sudo systemctl daemon-reload'."
    fi
  fi
fi

# --- Done -----------------------------------------------------------------
HOST="127.0.0.1"
if [ "$KORECAL_BIND" = "0.0.0.0" ]; then
  HOST="$(hostname -I 2>/dev/null | awk '{print $1}')"; HOST="${HOST:-this-server}"
elif [ "$KORECAL_BIND" != "127.0.0.1" ]; then
  HOST="$KORECAL_BIND"
fi
say
printf '%sKoreCalendar is running.%s\n' "$G" "$N"
say "  Open it:   http://${HOST}:${KORECAL_PORT}   (the first account you create becomes the administrator)"
say "  Files:     $KORECAL_DIR   (docker-compose.yml, Caddyfile, .env)"
say "  Data:      $KORECAL_DATA_DIR"
say
if [ "$IN_PLACE" = 1 ]; then
  say "Update later:        back up the database first (docs/deploy.md), then: cd $KORECAL_DIR && git pull && docker compose build --pull && docker compose up -d --wait"
elif [ "$SOURCE_INSTALL" = 1 ]; then
  UPSRC="${KORECAL_SOURCE_DIR:-$KORECAL_DIR/src}"
  say "Update later:        back up the database first (docs/deploy.md), then: cd $UPSRC && git pull && cp docker-compose.yml Caddyfile $KORECAL_DIR/ && cd $KORECAL_DIR && docker compose build --pull && docker compose up -d --wait"
else
  say "Update later:        see docs/deploy.md (Updating): back up the database, then set KORECAL_VERSION in .env to the new release, replace the compose files with that tag's, and: docker compose pull && docker compose up -d --wait"
fi
say "AI agents and scripts: create an access token under Settings, then see the API guide:"
say "  https://github.com/${REPO}/blob/main/docs/api.md"
say "Browser notifications need HTTPS (Cloudflare Tunnel or Tailscale HTTPS in front of the published port)."

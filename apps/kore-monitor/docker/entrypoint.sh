#!/bin/sh
# Container entrypoint: run the backend as the unprivileged `koremonitor` user.
#
# Started as root (the default), it makes sure the data directory belongs to
# `koremonitor` and then drops privileges with setpriv. Volumes written by the
# older root-running image are root-owned; they are handed over here, once,
# so an upgrade needs no manual chown. Started with `--user`, it just runs
# the command as that user (the operator then owns the volume themselves).
#
# `exec` all the way down: the backend is PID 1 and receives SIGTERM itself
# for its graceful shutdown.
set -eu

DATA_DIR="${DATA_DIR:-/app/data}"
RUN_USER=koremonitor
# The backup store, set by compose.backups.yaml. The pre-rename spelling is
# still read so an old .env keeps working.
BACKUP_DIR="${KOREMONITOR_BACKUP_DIR:-${FLATLINE_BACKUP_DIR:-}}"

if [ "$(id -u)" = "0" ]; then
    # The backup store is handed over the same way and kept private to the
    # backend.
    for dir in "$DATA_DIR" ${BACKUP_DIR:+"$BACKUP_DIR"}; do
        mkdir -p "$dir"
        # Anything not owned by koremonitor (a root-owned volume from an older
        # image, a file restored by root) is re-owned; a no-op once migrated.
        if [ -n "$(find "$dir" ! -user "$RUN_USER" -print -quit)" ]; then
            echo "entrypoint: handing $dir to $RUN_USER (files owned by another user found)" >&2
            chown -R "$RUN_USER:$RUN_USER" "$dir"
        fi
    done
    if [ -n "$BACKUP_DIR" ]; then
        chmod 0700 "$BACKUP_DIR"
    fi
    exec setpriv --reuid="$RUN_USER" --regid="$RUN_USER" --init-groups -- "$@"
fi

exec "$@"

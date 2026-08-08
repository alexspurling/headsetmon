#!/usr/bin/env bash
#
# Reload this desklet's code in the running Cinnamon session, then follow its log.
#
# Cinnamon caches xlet modules for the lifetime of the session. Removing and
# re-adding a desklet in the Desklets app recreates the instance but keeps the
# already-loaded code, so source edits are invisible until something explicitly
# unloads the module. That is what ReloadXlet does.
#
# Usage:
#   ./reload.sh            reload, then follow the filtered log
#   ./reload.sh -n         reload and exit
#   ./reload.sh -a         follow the whole log, unfiltered

set -euo pipefail

UUID="deskclock@bytepath"
LOG="${HOME}/.xsession-errors"

# Lines mentioning the desklet by name, plus console.log output (which arrives as
# "Gjs-Console-Message:" with no UUID attached, so it cannot be matched precisely).
FILTER="${UUID}|Gjs-Console-Message|desklet\.js"

follow=1

for arg in "$@"; do
    case "$arg" in
        -n|--no-follow) follow=0 ;;
        -a|--all)       FILTER='' ;;
        -h|--help)      sed -n '3,13p' "$0" | cut -c3-; exit 0 ;;
        *)              echo "unknown option: $arg" >&2; exit 2 ;;
    esac
done

if ! gdbus call --session \
        --dest org.Cinnamon \
        --object-path /org/Cinnamon \
        --method org.Cinnamon.ReloadXlet "$UUID" "DESKLET" >/dev/null; then
    echo "Could not reach Cinnamon over D-Bus. Is the session running?" >&2
    exit 1
fi

echo "Reloaded ${UUID}."

# A reload only re-reads the file; it does not put the desklet on the desktop.
# Without an instance nothing is constructed, so no log output will appear.
if ! gsettings get org.cinnamon enabled-desklets | grep -q "$UUID"; then
    echo "Note: no instance is on the desktop yet — add it from the Desklets app," \
         "otherwise the desklet never runs and this log stays empty."
fi

[ "$follow" -eq 0 ] && exit 0

echo "Following ${LOG} (Ctrl+C to stop)..."
if [ -n "$FILTER" ]; then
    # -A 8 keeps the stack trace that follows an error line.
    tail -n 0 -F "$LOG" | grep --line-buffered -E -A 8 "$FILTER"
else
    tail -n 0 -F "$LOG"
fi

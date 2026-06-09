#!/bin/bash
# Simulate the brand-new-user empty state by moving meeting data
# (recordings/, transcripts/, output/) into a timestamped backup
# inside the same app-support directory. OAuth tokens, config,
# chat history, and Electron caches are left alone so login state
# survives.
#
# Development utility only — lives in dev/ so PyInstaller (which bundles
# scripts/ into the DMG) never ships it. Both the dev Electron build and
# the packaged StenoAI write to the same ~/Library/Application Support/
# path, so quit any running app before invoking — or pass --quit-app to
# have this script do it for you (used by `npm run start:empty`).
#
# Usage:
#   dev/scripts/empty-state.sh                       # back up current data
#   dev/scripts/empty-state.sh --restore             # restore latest backup
#   dev/scripts/empty-state.sh --list                # show all backups
#   dev/scripts/empty-state.sh --quit-app            # quit app, then back up
#   dev/scripts/empty-state.sh --restore --quit-app  # quit app, then restore

set -euo pipefail

DATA_DIR="$HOME/Library/Application Support/stenoai"
BACKUP_PREFIX="_backup_"
MOVED_DIRS=(recordings transcripts output)

if [ ! -d "$DATA_DIR" ]; then
  echo "stenoai data directory not found: $DATA_DIR"
  echo "Run the app at least once before using this script."
  exit 1
fi

quit_running_apps() {
  # Packaged builds. Names vary across forks/rebrands; ignore failures
  # so the script keeps going whichever (if any) is installed.
  for name in "Steno" "Steno Dev" "StenoAI"; do
    osascript -e "tell application \"$name\" to quit" 2>/dev/null || true
  done
  # Dev Electron started from this repo. The cmdline includes the repo
  # path so we can target only OUR Electron, not unrelated apps.
  local repo_root
  repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  pkill -f "Electron\\.app/Contents/MacOS/Electron .*${repo_root}" 2>/dev/null || true
  # Give the OS a moment to flush file handles / finish quitting before
  # we start moving directories out from under it.
  sleep 0.5
}

refuse_if_recording() {
  if pgrep -f "stenoai record" >/dev/null 2>&1; then
    echo "A 'stenoai record' subprocess is running. Quit the app first,"
    echo "or re-run with --quit-app."
    exit 1
  fi
}

list_backups() {
  shopt -s nullglob
  local backups=("$DATA_DIR/$BACKUP_PREFIX"*)
  if [ ${#backups[@]} -eq 0 ]; then
    echo "No backups found in: $DATA_DIR"
    return
  fi
  echo "Backups in: $DATA_DIR"
  for b in "${backups[@]}"; do
    printf "  %s\n" "$(basename "$b")"
  done
}

backup_to_empty() {
  refuse_if_recording

  local has_data=false
  for d in "${MOVED_DIRS[@]}"; do
    if [ -d "$DATA_DIR/$d" ]; then
      has_data=true
      break
    fi
  done
  if [ "$has_data" = false ]; then
    echo "No data to back up — already in empty state."
    return
  fi

  local stamp
  stamp=$(date +%Y%m%d_%H%M%S)
  local backup="$DATA_DIR/${BACKUP_PREFIX}${stamp}"
  mkdir -p "$backup"

  for d in "${MOVED_DIRS[@]}"; do
    if [ -d "$DATA_DIR/$d" ]; then
      mv "$DATA_DIR/$d" "$backup/"
    fi
  done

  echo "Moved meeting data to: $backup"
}

restore_latest() {
  refuse_if_recording

  shopt -s nullglob
  local backups=("$DATA_DIR/$BACKUP_PREFIX"*)
  if [ ${#backups[@]} -eq 0 ]; then
    echo "No backups found in: $DATA_DIR"
    exit 1
  fi

  # Sort lexicographically — timestamp prefix makes that == chronological.
  IFS=$'\n' backups=($(printf '%s\n' "${backups[@]}" | sort))
  unset IFS
  local latest="${backups[${#backups[@]}-1]}"

  # The app auto-creates these dirs on launch — clear empty ones so the
  # restore can land. Refuse if any has real content, so we never
  # silently bury the user's data.
  for d in "${MOVED_DIRS[@]}"; do
    if [ -d "$DATA_DIR/$d" ] && [ -d "$latest/$d" ]; then
      if [ -z "$(ls -A "$DATA_DIR/$d")" ]; then
        rmdir "$DATA_DIR/$d"
      else
        echo "Refusing to restore: '$d' already exists and has content."
        echo "Move or remove it first, or pick a different backup manually."
        exit 1
      fi
    fi
  done

  for d in "${MOVED_DIRS[@]}"; do
    if [ -d "$latest/$d" ]; then
      mv "$latest/$d" "$DATA_DIR/"
    fi
  done

  rmdir "$latest" 2>/dev/null || true
  echo "Restored from: $(basename "$latest")"
}

ACTION="empty"
QUIT_APP=false

while [ $# -gt 0 ]; do
  case "$1" in
    --restore)  ACTION="restore" ;;
    --list)     ACTION="list" ;;
    --quit-app) QUIT_APP=true ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: $0 [--restore|--list] [--quit-app]"
      exit 1
      ;;
  esac
  shift
done

if [ "$QUIT_APP" = true ]; then
  quit_running_apps
fi

case "$ACTION" in
  empty)   backup_to_empty ;;
  restore) restore_latest ;;
  list)    list_backups ;;
esac

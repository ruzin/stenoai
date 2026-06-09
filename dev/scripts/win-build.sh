#!/bin/bash
# Build a Windows installer on CI and download it locally so you can drop it
# into a Windows VM for a quick manual check.
#
# The Windows build can't run on macOS — the bundled Python backend is built
# by PyInstaller *on Windows* — so this triggers the `build-windows.yml`
# workflow (it has workflow_dispatch) on a branch, waits for it, and pulls the
# resulting .exe / .zip down to a local folder.
#
# Usage:
#   dev/scripts/win-build.sh                 # build the current branch
#   dev/scripts/win-build.sh -b my-branch    # build a specific branch
#   dev/scripts/win-build.sh -o ~/Desktop    # download into a chosen folder
#   dev/scripts/win-build.sh --no-wait       # just kick off the build, don't wait
#
# Requires the GitHub CLI (`gh`) authenticated against the repo.

set -euo pipefail

WORKFLOW="build-windows.yml"
BRANCH=""
OUT_DIR=""
WAIT=1

need_val() { [[ $# -ge 2 && -n "$2" ]] || { echo "error: $1 requires a value" >&2; exit 2; }; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    -b|--branch) need_val "$@"; BRANCH="$2"; shift 2 ;;
    -o|--out)    need_val "$@"; OUT_DIR="$2"; shift 2 ;;
    --no-wait)   WAIT=0; shift ;;
    -h|--help)   sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

command -v gh >/dev/null 2>&1 || { echo "error: GitHub CLI (gh) not found. Install it and run 'gh auth login'." >&2; exit 1; }

# Run from repo root regardless of where the script is invoked.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

[[ -z "$BRANCH" ]] && BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[[ -z "$OUT_DIR" ]] && OUT_DIR="$REPO_ROOT/dist-win"

echo "==> Triggering $WORKFLOW on branch '$BRANCH'"

# Capture the newest run id before dispatch so we can detect the new one.
prev_id="$(gh run list --workflow "$WORKFLOW" --branch "$BRANCH" --limit 1 --json databaseId --jq '.[0].databaseId // 0')"

gh workflow run "$WORKFLOW" --ref "$BRANCH"

# Poll until a run newer than prev_id appears (dispatch -> queued can lag).
echo "==> Waiting for the run to register..."
run_id=""
for _ in $(seq 1 30); do
  sleep 4
  run_id="$(gh run list --workflow "$WORKFLOW" --branch "$BRANCH" --limit 1 --json databaseId --jq '.[0].databaseId // 0')"
  [[ "$run_id" != "0" && "$run_id" != "$prev_id" ]] && break
  run_id=""
done

if [[ -z "$run_id" ]]; then
  echo "error: could not find the dispatched run. Check: gh run list --workflow $WORKFLOW --branch $BRANCH" >&2
  exit 1
fi

run_url="$(gh run view "$run_id" --json url --jq .url)"
echo "==> Run started: $run_url"

if [[ "$WAIT" -eq 0 ]]; then
  echo "==> --no-wait set. Download later with:"
  echo "    gh run download $run_id -D \"$OUT_DIR\""
  exit 0
fi

echo "==> Watching the build (this takes ~15-25 min: PyInstaller + Ollama download + electron-builder)..."
# `gh run watch` streams progress; --exit-status makes it return non-zero on failure.
if ! gh run watch "$run_id" --exit-status; then
  echo "" >&2
  echo "error: the Windows build failed. Logs: $run_url" >&2
  exit 1
fi

# Download into a per-run subfolder so re-runs don't mix, and so we never
# touch (let alone recursively delete) the user-supplied --out directory.
DEST="$OUT_DIR/run-$run_id"
echo "==> Build succeeded. Downloading artifacts to: $DEST"
mkdir -p "$DEST"
gh run download "$run_id" -D "$DEST"
OUT_DIR="$DEST"

echo ""
echo "==> Done. Windows artifacts:"
# Artifacts download into a per-artifact subfolder; surface the installer + zip.
find "$OUT_DIR" -maxdepth 2 -type f \( -name '*.exe' -o -name '*.zip' \) -print | sed 's/^/    /'
echo ""
echo "Drag the .exe (or unzip the .zip) into your Windows VM to test."

# Open the folder that actually holds the .exe (gh nests it one level down)
# so it's ready to drag into the VM. Falls back to the output dir.
exe_dir="$(find "$OUT_DIR" -maxdepth 2 -type f -name '*.exe' -print -quit | xargs -I{} dirname {} 2>/dev/null)"
[[ -z "$exe_dir" ]] && exe_dir="$OUT_DIR"
case "$(uname -s)" in
  Darwin) open "$exe_dir" ;;
  Linux)  command -v xdg-open >/dev/null && xdg-open "$exe_dir" >/dev/null 2>&1 || true ;;
  MINGW*|MSYS*|CYGWIN*) explorer "$(cygpath -w "$exe_dir" 2>/dev/null || echo "$exe_dir")" || true ;;
esac

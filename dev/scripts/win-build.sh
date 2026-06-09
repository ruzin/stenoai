#!/bin/bash
# Build a Windows installer on CI and download it locally so you can drop it
# into a Windows VM for a quick manual check.
#
# The Windows build can't run on macOS — the bundled Python backend is built
# by PyInstaller *on Windows* — so this triggers the `build-windows.yml`
# workflow (it has workflow_dispatch) on a branch, waits for it, and pulls the
# resulting .exe / .zip down to a local folder.
#
# After the local download it ALSO, best-effort, pushes the .exe onto an
# available Windows test VM's Desktop so it's ready to install without a manual
# drag-through-RDP. It uploads to blob storage with a short-lived (2h) SAS URL
# and has the VM pull it. This is skipped silently — leaving the local copy —
# if the Azure CLI isn't installed / logged in, or there's no VM in the target
# resource group (STENO_WIN_RG, default 'steno-win-test').
#
# Usage:
#   dev/scripts/win-build.sh                 # build the current branch
#   dev/scripts/win-build.sh -b my-branch    # build a specific branch
#   dev/scripts/win-build.sh -o ~/Desktop    # download into a chosen folder
#   dev/scripts/win-build.sh --no-wait       # just kick off the build, don't wait
#   dev/scripts/win-build.sh --no-push       # don't push to a VM, local only
#   STENO_WIN_RG=my-rg dev/scripts/win-build.sh   # target a different VM rg
#
# Requires the GitHub CLI (`gh`) authenticated against the repo. The VM push
# additionally needs the Azure CLI (`az`) logged in.

set -euo pipefail

WORKFLOW="build-windows.yml"
BRANCH=""
OUT_DIR=""
WAIT=1
PUSH=1
# Resource group holding the Windows test VM(s) + a transfer storage account.
VM_RG="${STENO_WIN_RG:-steno-win-test}"

need_val() { [[ $# -ge 2 && -n "$2" ]] || { echo "error: $1 requires a value" >&2; exit 2; }; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    -b|--branch) need_val "$@"; BRANCH="$2"; shift 2 ;;
    -o|--out)    need_val "$@"; OUT_DIR="$2"; shift 2 ;;
    --no-wait)   WAIT=0; shift ;;
    --no-push)   PUSH=0; shift ;;
    -h|--help)   sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

command -v gh >/dev/null 2>&1 || { echo "error: GitHub CLI (gh) not found. Install it and run 'gh auth login'." >&2; exit 1; }

# Run from repo root regardless of where the script is invoked.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

[[ -z "$BRANCH" ]] && BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[[ -z "$OUT_DIR" ]] && OUT_DIR="$REPO_ROOT/dist-win"

# Best-effort: drop the freshly-built .exe onto an available Windows VM's
# Desktop, ready to install. Uploads to blob storage with a short-lived (2h)
# read-only SAS URL and has the VM pull it (WebClient streams — fast; PowerShell
# Invoke-WebRequest buffers and crawls on 200 MB+ files). Returns 0 on every
# skip path so a missing VM / az never fails the build — the local copy is the
# source of truth, the VM push is a convenience.
push_to_vm() {
  local exe="$1"
  command -v az >/dev/null 2>&1 || { echo "==> az CLI not found — skipping VM push (local copy: $exe)"; return 0; }
  az account show >/dev/null 2>&1 || { echo "==> az not logged in — skipping VM push (local copy: $exe)"; return 0; }

  local vm
  vm="$(az vm list -g "$VM_RG" --query "[0].name" -o tsv 2>/dev/null || true)"
  if [[ -z "$vm" ]]; then
    echo "==> No VM in resource group '$VM_RG' — skipping VM push (local copy: $exe)"
    return 0
  fi
  echo "==> Pushing the installer to VM '$vm' (rg: $VM_RG)"

  # Make sure it's running (start a deallocated/stopped box).
  local power
  power="$(az vm get-instance-view -g "$VM_RG" -n "$vm" \
    --query "instanceView.statuses[?starts_with(code,'PowerState')].displayStatus | [0]" -o tsv 2>/dev/null || true)"
  if [[ "$power" != "VM running" ]]; then
    echo "==> Starting '$vm' (was: ${power:-unknown})..."
    az vm start -g "$VM_RG" -n "$vm" >/dev/null 2>&1 || { echo "==> couldn't start VM — skipping push"; return 0; }
  fi

  # run-command runs as SYSTEM, so target the admin user's Desktop explicitly.
  local admin_user
  admin_user="$(az vm show -g "$VM_RG" -n "$vm" --query "osProfile.adminUsername" -o tsv 2>/dev/null || true)"
  [[ -z "$admin_user" ]] && admin_user="Public"

  # Reuse an existing transfer storage account or mint one (names are global).
  local sa
  sa="$(az storage account list -g "$VM_RG" --query "[?starts_with(name,'stenoxfer')].name | [0]" -o tsv 2>/dev/null || true)"
  if [[ -z "$sa" ]]; then
    sa="stenoxfer$(openssl rand -hex 4)"
    echo "==> Creating transfer storage account '$sa'..."
    az storage account create -g "$VM_RG" -n "$sa" --sku Standard_LRS --allow-blob-public-access false >/dev/null 2>&1 \
      || { echo "==> couldn't create storage account — skipping push"; return 0; }
  fi
  local key
  key="$(az storage account keys list -g "$VM_RG" -n "$sa" --query "[0].value" -o tsv 2>/dev/null || true)"
  [[ -z "$key" ]] && { echo "==> couldn't read storage key — skipping push"; return 0; }
  az storage container create -n transfer --account-name "$sa" --account-key "$key" >/dev/null 2>&1 || true

  local blob; blob="$(basename "$exe")"
  echo "==> Uploading $blob ($(du -h "$exe" 2>/dev/null | cut -f1)) to blob storage..."
  az storage blob upload -f "$exe" -c transfer -n "$blob" \
    --account-name "$sa" --account-key "$key" --overwrite >/dev/null 2>&1 \
    || { echo "==> upload failed — skipping push"; return 0; }

  # Short-lived (2h) read-only SAS — the URL expires even though the blob lingers.
  local expiry
  expiry="$(date -u -v+2H '+%Y-%m-%dT%H:%MZ' 2>/dev/null || date -u -d '+2 hours' '+%Y-%m-%dT%H:%MZ')"
  local sas
  sas="$(az storage blob generate-sas --account-name "$sa" --account-key "$key" \
    -c transfer -n "$blob" --permissions r --expiry "$expiry" --https-only --full-uri -o tsv 2>/dev/null || true)"
  [[ -z "$sas" ]] && { echo "==> couldn't mint SAS URL — skipping push"; return 0; }

  # Forward slashes in the dest path dodge backslash-escaping in the heredoc;
  # .NET / Get-Item accept them fine on Windows.
  local ps; ps="$(mktemp)"
  cat > "$ps" <<PSEOF
\$ErrorActionPreference = 'Stop'
\$userDesktop = 'C:/Users/$admin_user/Desktop'
if (Test-Path \$userDesktop) { \$dest = "\$userDesktop/$blob" } else { \$dest = 'C:/Users/Public/Desktop/$blob' }
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
(New-Object System.Net.WebClient).DownloadFile('$sas', \$dest)
\$f = Get-Item \$dest
Write-Output "DOWNLOADED \$(\$f.FullName) \$(\$f.Length) bytes"
PSEOF
  # `az vm run-command invoke` exits 0 even when the PowerShell script throws —
  # the failure shows up in the returned message, not the exit code. So capture
  # the output and confirm the success marker (with the expected byte count)
  # before claiming the installer is on the VM, rather than logging success
  # unconditionally and misleading a manual test.
  echo "==> Downloading onto the VM Desktop (runs on the VM)..."
  local size result
  size="$(stat -f%z "$exe" 2>/dev/null || stat -c%s "$exe" 2>/dev/null || echo "")"
  result="$(az vm run-command invoke -g "$VM_RG" -n "$vm" --command-id RunPowerShellScript \
    --scripts @"$ps" --query "value[0].message" -o tsv 2>/dev/null || true)"
  rm -f "$ps"
  echo "$result" | sed 's/^/    /'
  if echo "$result" | grep -q "DOWNLOADED .*${size:-} bytes"; then
    echo "==> Pushed to '$vm'. Install it from the Desktop."
  else
    echo "==> WARNING: VM push did not confirm — the .exe may NOT be on the VM (see output above). Local copy: $exe" >&2
  fi
}

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

# Best-effort push of the .exe onto an available Windows VM's Desktop.
if [[ "$PUSH" -eq 1 ]]; then
  exe_file="$(find "$OUT_DIR" -maxdepth 2 -type f -name '*.exe' -print -quit || true)"
  if [[ -n "$exe_file" ]]; then
    push_to_vm "$exe_file"
    echo ""
  fi
else
  echo "Drag the .exe (or unzip the .zip) into your Windows VM to test."
fi

# Open the folder that actually holds the .exe (gh nests it one level down)
# so it's ready to drag into the VM. Falls back to the output dir.
exe_dir="$(find "$OUT_DIR" -maxdepth 2 -type f -name '*.exe' -print -quit | xargs -I{} dirname {} 2>/dev/null)"
[[ -z "$exe_dir" ]] && exe_dir="$OUT_DIR"
case "$(uname -s)" in
  Darwin) open "$exe_dir" ;;
  Linux)  command -v xdg-open >/dev/null && xdg-open "$exe_dir" >/dev/null 2>&1 || true ;;
  MINGW*|MSYS*|CYGWIN*) explorer "$(cygpath -w "$exe_dir" 2>/dev/null || echo "$exe_dir")" || true ;;
esac

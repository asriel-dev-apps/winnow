#!/usr/bin/env bash
set -uo pipefail

export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/bin:/bin"

root="$(cd "$(dirname "$0")/.." && pwd)"
today="$(date +%F)"
log_dir="$root/data/logs"
log_file="$log_dir/daily-${today}.log"
report_url="http://127.0.0.1:8765/${today}/report.html"

notify() {
  local message="$1"
  if command -v osascript >/dev/null 2>&1; then
    osascript -e "display notification \"${message}\" with title \"Winnow\"" >/dev/null 2>&1 || true
  fi
}

mkdir -p "$log_dir"
cd "$root" || {
  echo "[$(date -Is)] FAIL cd $root" >>"$log_file"
  notify "Failed to enter repository"
  exit 1
}

if [[ -f "$log_file" ]] && grep -q "SUCCESS" "$log_file"; then
  echo "[$(date -Is)] SKIP already successful today" >>"$log_file"
  exit 0
fi

echo "[$(date -Is)] START" >>"$log_file"
claude -p "/winnow" --permission-mode acceptEdits >>"$log_file" 2>&1
status=$?

if [[ "$status" -eq 0 ]]; then
  echo "[$(date -Is)] SUCCESS $report_url" >>"$log_file"
  notify "Survey complete: $report_url"
  exit 0
fi

echo "[$(date -Is)] FAIL exit=$status" >>"$log_file"
notify "Survey failed; see $log_file"
exit "$status"

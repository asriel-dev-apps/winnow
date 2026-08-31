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
  echo "[$(date +%Y-%m-%dT%H:%M:%S%z)] FAIL cd $root" >>"$log_file"
  notify "Failed to enter repository"
  exit 1
}

if [[ -f "$log_file" ]] && grep -q "SUCCESS" "$log_file"; then
  echo "[$(date +%Y-%m-%dT%H:%M:%S%z)] SKIP already successful today" >>"$log_file"
  exit 0
fi

echo "[$(date +%Y-%m-%dT%H:%M:%S%z)] START" >>"$log_file"
# モデルは明示する。既定モデルは変わることがあり、ヘッドレスで使えない
# モデル（クレジット不足・組織で無効）に切り替わると毎朝失敗し続ける。
# 2026-08-26〜08-31 に実際に起きた（既定が Fable 5 になりクレジット不足で 6 日連続 FAIL）。
#
# `opus` エイリアスは Opus 5 を指すので使わない（2026-08-31 実測）。
# Opus 4.8 を使うには完全な ID が要る。`opus-4.8` は未認識で弾かれる。
claude -p "/winnow" --model "${WINNOW_MODEL:-claude-opus-4-8}" --permission-mode acceptEdits >>"$log_file" 2>&1
status=$?

if [[ "$status" -eq 0 ]]; then
  echo "[$(date +%Y-%m-%dT%H:%M:%S%z)] SUCCESS $report_url" >>"$log_file"
  notify "Survey complete: $report_url"
  exit 0
fi

echo "[$(date +%Y-%m-%dT%H:%M:%S%z)] FAIL exit=$status" >>"$log_file"
notify "Survey failed; see $log_file"
exit "$status"

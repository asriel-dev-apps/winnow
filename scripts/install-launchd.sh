#!/usr/bin/env bash
set -uo pipefail

# リポジトリの場所とnodeのパスは環境依存のため、テンプレートplistの
# __WINNOW_ROOT__ / __NODE__ をインストール時に実パスへ置換する
root="$(cd "$(dirname "$0")/.." && pwd)"
node_bin="$(command -v node || true)"
agent_dir="$HOME/Library/LaunchAgents"
labels=("com.winnow.daily" "com.winnow.serve")

if [[ -z "$node_bin" ]]; then
  echo "node not found in PATH" >&2
  exit 1
fi

mkdir -p "$agent_dir" "$root/data/logs"

if [[ "${1:-}" == "--uninstall" ]]; then
  for label in "${labels[@]}"; do
    launchctl bootout "gui/$UID/$label" >/dev/null 2>&1 || true
    rm -f "$agent_dir/$label.plist"
    echo "uninstalled $label"
  done
  exit 0
fi

for label in "${labels[@]}"; do
  src="$root/launchd/$label.plist"
  dst="$agent_dir/$label.plist"
  sed -e "s|__WINNOW_ROOT__|$root|g" -e "s|__NODE__|$node_bin|g" "$src" > "$dst"
  launchctl bootout "gui/$UID/$label" >/dev/null 2>&1 || true
  # bootoutは非同期のため、直後のbootstrapがEIOで失敗することがある。少し待って再試行
  ok=0
  for _ in 1 2 3 4 5; do
    if launchctl bootstrap "gui/$UID" "$dst" 2>/dev/null; then ok=1; break; fi
    sleep 1
  done
  if [[ "$ok" -eq 1 ]]; then echo "installed $label"; else echo "FAILED to bootstrap $label" >&2; exit 1; fi
done

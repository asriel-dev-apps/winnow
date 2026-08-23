#!/usr/bin/env bash
set -uo pipefail

# launchd への登録は launchtop に任せる（テンプレートの __WINNOW_ROOT__ / __NODE__ を
# 置換し、bootout してから bootstrap を EIO リトライ付きで実行するところまで面倒を見る）。
# launchtop: https://github.com/asriel-dev-apps/launchtop
launchtop="${LAUNCHTOP:-$HOME/.cargo/bin/launchtop}"
root="$(cd "$(dirname "$0")/.." && pwd)"
node_bin="$(command -v node || true)"
labels=("com.winnow.daily" "com.winnow.serve")

if [[ ! -x "$launchtop" ]]; then
  echo "launchtop not found at $launchtop (set LAUNCHTOP to override)" >&2
  exit 1
fi

if [[ "${1:-}" == "--uninstall" ]]; then
  for label in "${labels[@]}"; do
    "$launchtop" uninstall "$label" --yes || exit 1
  done
  exit 0
fi

if [[ -z "$node_bin" ]]; then
  echo "node not found in PATH" >&2
  exit 1
fi

# plist が指すログの置き場は launchd が作ってくれないので、ここで用意する
mkdir -p "$root/data/logs"

# --var は plist ごとに必要なものだけ渡す（余った変数は launchtop が警告するため）
"$launchtop" install "$root/launchd/com.winnow.daily.plist" \
  --var "WINNOW_ROOT=$root" --yes || exit 1
"$launchtop" install "$root/launchd/com.winnow.serve.plist" \
  --var "WINNOW_ROOT=$root" --var "NODE=$node_bin" --yes || exit 1

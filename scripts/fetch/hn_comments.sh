#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <objectID>" >&2
  exit 2
fi

curl -sf --max-time 30 "https://hn.algolia.com/api/v1/items/$1" |
jq -c '
  def clean: gsub("<[^>]*>"; "") | gsub("&quot;"; "\"") | gsub("&amp;"; "&") | gsub("&#x27;"; "'\''");
  [.children[]? | select(.text != null) | {author: (.author // null), text: (.text | clean), points: (.points // 0)}][:20]
'

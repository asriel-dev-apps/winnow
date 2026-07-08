#!/usr/bin/env bash
set -euo pipefail

config="$(dirname "$0")/../../config/sources.json"
limit="$(jq -r '.max_items_per_source // 50' "$config")"
query="$(jq -r '.qiita_query // "stocks:>5"' "$config")"
window_hours="$(jq -r '.fetch_window_hours // 48' "$config")"
since="$(( $(date +%s) - window_hours * 3600 ))"
enc="$(jq -rn --arg v "$query" '$v|@uri')"
headers=(-H "User-Agent: winnow/0.1")
if [[ -n "${QIITA_TOKEN:-}" ]]; then
  headers+=(-H "Authorization: Bearer ${QIITA_TOKEN}")
fi

curl -sf --max-time 30 "${headers[@]}" "https://qiita.com/api/v2/items?query=${enc}&per_page=${limit}" |
jq -c --argjson since "$since" '
  def to_epoch:
    if test("[+-][0-9]{2}:[0-9]{2}$") then
      (capture("^(?<base>.*)(?<sign>[+-])(?<oh>[0-9]{2}):(?<om>[0-9]{2})$")) as $c
      | (($c.base + "Z") | fromdateiso8601)
        - (if $c.sign == "+" then 1 else -1 end) * (($c.oh | tonumber) * 3600 + ($c.om | tonumber) * 60)
    else (fromdateiso8601? // 0) end;
  map(select((.created_at | to_epoch) >= $since)) | map({
    source: "qiita",
    url,
    title,
    author: (.user.id // null),
    published_at: .created_at,
    engagement: {stocks: (.stocks_count // 0), likes: (.likes_count // 0)},
    raw_tags: ([.tags[]?.name] // [])
  })
'

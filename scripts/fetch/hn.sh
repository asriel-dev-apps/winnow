#!/usr/bin/env bash
set -euo pipefail

config="$(dirname "$0")/../../config/sources.json"
limit="$(jq -r '.max_items_per_source // 50' "$config")"
window_hours="$(jq -r '.fetch_window_hours // 48' "$config")"
since="$(( $(date +%s) - window_hours * 3600 ))"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

printf '[]' > "$tmp"

fetch_url() {
  curl -sf --max-time 30 "$1"
}

merge_hits() {
  jq -s '.[0] + (.[1].hits // [])' "$tmp" - > "$tmp.next"
  mv "$tmp.next" "$tmp"
}

fetch_url "https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=${limit}" | merge_hits

jq -r '.focus_keywords[]?' "$config" | while IFS= read -r kw; do
  enc="$(jq -rn --arg v "$kw" '$v|@uri')"
  url="https://hn.algolia.com/api/v1/search_by_date?query=${enc}&tags=story&hitsPerPage=${limit}&numericFilters=points%3E10,created_at_i%3E${since}"
  fetch_url "$url" | merge_hits
done

jq -c --argjson limit "$limit" '
  unique_by(.objectID)[:$limit]
  | map({
      source: "hn",
      url: (.url // ("https://news.ycombinator.com/item?id=" + (.objectID|tostring))),
      title: (.title // .story_title // ""),
      author: (.author // null),
      published_at: (.created_at // null),
      engagement: {points: (.points // 0), comments: (.num_comments // 0), hn_object_id: (.objectID|tostring)},
      raw_tags: (._tags // [])
    })
' "$tmp"

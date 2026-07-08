#!/usr/bin/env bash
set -euo pipefail

config="$(dirname "$0")/../../config/sources.json"
limit="$(jq -r '.max_items_per_source // 50' "$config")"

curl -sf --max-time 30 "https://lobste.rs/hottest.json" |
jq -c --argjson limit "$limit" '
  .[:$limit] | map({
    source: "lobsters",
    url: (.url // .short_id_url),
    title,
    author: (if (.submitter_user | type) == "object" then .submitter_user.username else .submitter_user end // null),
    published_at: (.created_at // null),
    engagement: {points: (.score // 0), comments: (.comment_count // 0)},
    raw_tags: ([.tags[]?] // [])
  })
'

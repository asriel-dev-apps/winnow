#!/usr/bin/env bash
set -euo pipefail

config="$(dirname "$0")/../../config/sources.json"
limit="$(jq -r '.max_items_per_source // 50' "$config")"

curl -sf --max-time 30 "https://mshibanami.github.io/GitHubTrendingRSS/daily/all.xml" |
tr -d '\r' |
sed -e 's/></>\
</g' |
awk '
  BEGIN { item=0; title=""; link=""; date=""; desc="" }
  /<item>/ { item=1; title=""; link=""; date=""; desc=""; next }
  /<\/item>/ {
    if (item && link != "") printf "%s\t%s\t%s\t%s\n", title, link, date, desc
    item=0
  }
  item {
    line=$0
    if (line ~ /<title>/) { sub(/^.*<title>/, "", line); sub(/<\/title>.*$/, "", line); title=line }
    if (line ~ /<link>/) { sub(/^.*<link>/, "", line); sub(/<\/link>.*$/, "", line); link=line }
    if (line ~ /<pubDate>/) { sub(/^.*<pubDate>/, "", line); sub(/<\/pubDate>.*$/, "", line); date=line }
    if (line ~ /<description>/) { sub(/^.*<description><!\[CDATA\[/, "", line); sub(/\]\]><\/description>.*$/, "", line); desc=line }
  }
' | head -n "$limit" | jq -Rsc '
  split("\n") | map(select(length > 0) | split("\t")) | map({
    source: "ghtrend",
    title: (.[0] // ""),
    url: (.[1] // ""),
    author: null,
    published_at: ((.[2] // "") | if . == "" then null else . end),
    engagement: {},
    description: ((.[3] // "") | gsub("<[^>]*>"; "") | gsub("&[^;]+;"; "") | .[0:300]),
    raw_tags: []
  })
'

#!/usr/bin/env bash
set -euo pipefail

config="$(dirname "$0")/../../config/sources.json"
limit="$(jq -r '.max_items_per_source // 50' "$config")"

curl -sf --max-time 30 "https://b.hatena.ne.jp/hotentry/it.rss" |
tr -d '\r' |
sed -e 's/></>\
</g' |
awk '
  BEGIN { item=0; title=""; link=""; date=""; users=0 }
  /<item / { item=1; title=""; link=""; date=""; users=0; next }
  /<\/item>/ {
    if (item && link != "") printf "%s\t%s\t%s\t%s\n", title, link, date, users
    item=0
  }
  item {
    line=$0
    if (line ~ /<title>/) { sub(/^.*<title>/, "", line); sub(/<\/title>.*$/, "", line); title=line }
    if (line ~ /<link>/) { sub(/^.*<link>/, "", line); sub(/<\/link>.*$/, "", line); link=line }
    if (line ~ /<dc:date>/) { sub(/^.*<dc:date>/, "", line); sub(/<\/dc:date>.*$/, "", line); date=line }
    if (line ~ /<hatena:bookmarkcount>/) { sub(/^.*<hatena:bookmarkcount>/, "", line); sub(/<\/hatena:bookmarkcount>.*$/, "", line); users=line }
  }
' | head -n "$limit" | jq -Rsc '
  split("\n") | map(select(length > 0) | split("\t")) | map({
    source: "hatebu",
    title: (.[0] // ""),
    url: (.[1] // ""),
    author: null,
    published_at: (.[2] // null),
    engagement: {users: ((.[3] // "0") | tonumber? // 0)},
    raw_tags: []
  })
'

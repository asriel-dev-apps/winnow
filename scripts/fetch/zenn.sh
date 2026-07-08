#!/usr/bin/env bash
set -euo pipefail

config="$(dirname "$0")/../../config/sources.json"
limit="$(jq -r '.max_items_per_source // 50' "$config")"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

fetch_feed() {
  # CDATAマーカーはタグ分割の前に除去する(<title><![CDATA[…]]></title>が
  # 分割で3行に割れてawkの1行1要素前提を破るため)
  curl -sf --max-time 30 "$1" | tr -d '\r' | sed -e 's/<!\[CDATA\[//g' -e 's/\]\]>//g' -e 's/></>\
</g'
}

parse_feed() {
  awk '
    BEGIN { item=0; title=""; link=""; date=""; author="" }
    /<item>/ { item=1; title=""; link=""; date=""; author=""; next }
    /<\/item>/ {
      if (item && link != "") {
        gsub(/^[ \t\r\n]+|[ \t\r\n]+$/, "", title)
        gsub(/^[ \t\r\n]+|[ \t\r\n]+$/, "", link)
        gsub(/^[ \t\r\n]+|[ \t\r\n]+$/, "", date)
        gsub(/^[ \t\r\n]+|[ \t\r\n]+$/, "", author)
        printf "%s\t%s\t%s\t%s\n", title, link, date, author
      }
      item=0
    }
    item {
      line=$0
      if (line ~ /<title>/) { sub(/^.*<title><!\[CDATA\[/, "", line); sub(/\]\]><\/title>.*$/, "", line); sub(/^.*<title>/, "", line); sub(/<\/title>.*$/, "", line); title=line }
      if (line ~ /<link>/) { sub(/^.*<link>/, "", line); sub(/<\/link>.*$/, "", line); link=line }
      if (line ~ /<pubDate>/) { sub(/^.*<pubDate>/, "", line); sub(/<\/pubDate>.*$/, "", line); date=line }
      if (line ~ /<dc:creator>/) { sub(/^.*<dc:creator><!\[CDATA\[/, "", line); sub(/\]\]><\/dc:creator>.*$/, "", line); sub(/^.*<dc:creator>/, "", line); sub(/<\/dc:creator>.*$/, "", line); author=line }
    }
  '
}

{
  fetch_feed "https://zenn.dev/feed" | parse_feed
  jq -r '.zenn_topics[]?' "$config" | while IFS= read -r topic; do
    fetch_feed "https://zenn.dev/topics/${topic}/feed" | parse_feed || true
  done
} > "$tmp/items.tsv"

awk -F '\t' '!seen[$2]++' "$tmp/items.tsv" | head -n "$limit" | jq -Rsc '
  split("\n") | map(select(length > 0) | split("\t")) | map({
    source: "zenn",
    title: (.[0] // ""),
    url: (.[1] // ""),
    author: (.[3] // null),
    published_at: (.[2] // null),
    engagement: {},
    raw_tags: []
  })
'

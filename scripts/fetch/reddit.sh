#!/usr/bin/env bash
set -euo pipefail

config="$(dirname "$0")/../../config/sources.json"
limit="$(jq -r '.max_items_per_source // 50' "$config")"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
: > "$tmp"

jq -r '.subreddits[]?' "$config" | while IFS= read -r sub; do
  status_file="$(mktemp)"
  body_file="$(mktemp)"
  code="$(curl -sS -L --max-time 30 -A "winnow/0.1" -w '%{http_code}' -o "$body_file" "https://old.reddit.com/r/${sub}/.rss" || true)"
  if [[ "$code" == "403" || "$code" == "429" ]]; then
    echo "reddit ${sub}: ${code}, returning best-effort partial data" >&2
  elif [[ "$code" != "200" ]]; then
    echo "reddit ${sub}: HTTP ${code}, skipped" >&2
  else
    tr -d '\r' < "$body_file" | sed -e 's/></>\
</g' >> "$tmp"
  fi
  rm -f "$status_file" "$body_file"
  sleep 2
done

awk '
  BEGIN { entry=0; title=""; link=""; date=""; author="" }
  /<entry>/ { entry=1; title=""; link=""; date=""; author=""; next }
  /<\/entry>/ {
    if (entry && link != "") printf "%s\t%s\t%s\t%s\n", title, link, date, author
    entry=0
  }
  entry {
    line=$0
    if (line ~ /<title>/) { sub(/^.*<title>/, "", line); sub(/<\/title>.*$/, "", line); title=line }
    if (line ~ /<link / && line ~ /href=/) { sub(/^.*href="/, "", line); sub(/".*$/, "", line); link=line }
    if (line ~ /<updated>/) { sub(/^.*<updated>/, "", line); sub(/<\/updated>.*$/, "", line); date=line }
    if (line ~ /<name>/) { sub(/^.*<name>/, "", line); sub(/<\/name>.*$/, "", line); author=line }
  }
' "$tmp" | awk -F '\t' '!seen[$2]++' | head -n "$limit" | jq -Rsc '
  split("\n") | map(select(length > 0) | split("\t")) | map({
    source: "reddit",
    title: (.[0] // ""),
    url: (.[1] // ""),
    author: (.[3] // null),
    published_at: (.[2] // null),
    engagement: {},
    raw_tags: []
  })
'

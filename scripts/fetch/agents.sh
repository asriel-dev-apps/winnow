#!/usr/bin/env bash
set -euo pipefail

config="$(dirname "$0")/../../config/sources.json"
limit="$(jq -r '.max_items_per_source // 50' "$config")"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
printf '[]' > "$tmp"

append_json() {
  jq -s '.[0] + .[1]' "$tmp" - > "$tmp.next"
  mv "$tmp.next" "$tmp"
}

jq -r '.github_release_repos[]?' "$config" | while IFS= read -r repo; do
  curl -sf --max-time 30 -H "User-Agent: winnow/0.1" "https://api.github.com/repos/${repo}/releases?per_page=5" |
    jq -c --arg repo "$repo" 'map({
      source: "agents",
      url: (.html_url // ""),
      title: ($repo + " release " + (.tag_name // .name // "")),
      author: (.author.login // null),
      published_at: (.published_at // .created_at // null),
      engagement: {},
      raw_tags: ["github-release", $repo]
    })' | append_json
done

jq -r '.github_commit_feeds[]?' "$config" | while IFS= read -r repo; do
  curl -sf --max-time 30 -H "User-Agent: winnow/0.1" "https://github.com/${repo}/commits.atom" |
    tr -d '\r' |
    sed -e 's/></>\
</g' |
    awk -v repo="$repo" '
      function trimmed(s) { gsub(/^[ \t]+|[ \t]+$/, "", s); return s }
      function append_title(s) { s = trimmed(s); if (s != "") title = (title == "" ? s : title " " s) }
      BEGIN { entry=0; intitle=0; title=""; link=""; date=""; author="" }
      /<entry>/ { entry=1; intitle=0; title=""; link=""; date=""; author=""; next }
      /<\/entry>/ {
        if (entry && link != "") printf "%s\t%s\t%s\t%s\t%s\n", title, link, date, author, repo
        entry=0
      }
      entry {
        line=$0
        # GitHubのatomはpretty-printedで<title>の中身が別の行に来るため、
        # 閉じタグまで複数行を連結して拾う
        if (line ~ /<title>/ && line ~ /<\/title>/) { sub(/^.*<title>/, "", line); sub(/<\/title>.*$/, "", line); title=trimmed(line) }
        else if (line ~ /<title>/) { intitle=1; title="" }
        else if (intitle) {
          if (line ~ /<\/title>/) { sub(/<\/title>.*$/, "", line); append_title(line); intitle=0 }
          else { append_title(line) }
        }
        if (line ~ /<link / && line ~ /href=/) { sub(/^.*href="/, "", line); sub(/".*$/, "", line); link=line }
        if (line ~ /<updated>/) { sub(/^.*<updated>/, "", line); sub(/<\/updated>.*$/, "", line); date=line }
        if (line ~ /<name>/) { sub(/^.*<name>/, "", line); sub(/<\/name>.*$/, "", line); author=line }
      }
    ' |
    jq -Rsc 'split("\n") | map(select(length > 0) | split("\t")) | map({
      source: "agents",
      title: (.[0] // ""),
      url: (.[1] // ""),
      author: (.[3] // null),
      published_at: (.[2] // null),
      engagement: {},
      raw_tags: ["github-commit", (.[4] // "")]
    })' | append_json
done

jq -c --argjson limit "$limit" 'unique_by(.url)[:$limit]' "$tmp"

#!/usr/bin/env bash
set -euo pipefail

# Cloudflare公式(ブログ + 開発者向けchangelog)。定点ウォッチ専用でストーリー候補からは除外される
config="$(dirname "$0")/../../config/sources.json"
window="$(jq -r '.fetch_window_hours // 48' "$config")"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

curl -sf --max-time 30 -H "User-Agent: winnow/0.1" https://blog.cloudflare.com/rss/ > "$tmp/blog.xml"
curl -sf --max-time 60 -H "User-Agent: winnow/0.1" https://developers.cloudflare.com/changelog/rss/index.xml > "$tmp/changelog.xml"

node --input-type=module - "$tmp" "$window" <<'NODE'
import { readFileSync } from 'node:fs';
const [dir, windowHours] = process.argv.slice(2);
const entity = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => e[0] === '#'
    ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)))
    : (entity[e] ?? m));
const text = (html) => decode(html).replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
const tag = (block, name) => (block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`)) || [])[1] || '';
const since = Date.now() - Number(windowHours) * 3600e3;

function items(kind, cap) {
  const xml = readFileSync(`${dir}/${kind}.xml`, 'utf8');
  const all = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, b]) => ({
    source: 'cloudflare',
    title: text(tag(b, 'title')),
    url: text(tag(b, 'link')),
    author: text(tag(b, 'dc:creator')) || null,
    published_at: new Date(text(tag(b, 'pubDate'))).toISOString(),
    engagement: {},
    // ブログのdescriptionは1行しかなく「なぜ作ったか」が書かれないため、本文冒頭も渡す
    notes: `${text(tag(b, 'description'))} ${text(tag(b, 'content:encoded'))}`.trim().slice(0, 1500),
    raw_tags: ['cloudflare-official', `cloudflare-${kind}`,
      ...[...b.matchAll(/<category>([\s\S]*?)<\/category>/g)].map(([, c]) => text(c))],
  })).filter((i) => i.title && i.url);
  // 窓内が空の日(週末等)でもタブを空にしないため、最新5件まで遡る
  const recent = all.filter((i) => Date.parse(i.published_at) >= since);
  return (recent.length ? recent : all.slice(0, 5)).slice(0, cap);
}

console.log(JSON.stringify([...items('blog', 20), ...items('changelog', 30)]));
NODE

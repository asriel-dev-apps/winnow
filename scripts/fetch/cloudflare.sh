#!/usr/bin/env bash
set -euo pipefail

# Cloudflare公式(ブログ + 開発者向けchangelog)。定点ウォッチ専用でストーリー候補からは除外される
# 各記事の本文全文は <raw_dir>/cloudflare/<id>.txt に書く(ハイライトの図を描くサブエージェントが読む)
config="$(dirname "$0")/../../config/sources.json"
raw_dir="${1:-$(dirname "$0")/../../.raw}"
window="$(jq -r '.fetch_window_hours // 48' "$config")"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

curl -sf --max-time 30 -H "User-Agent: winnow/0.1" https://blog.cloudflare.com/rss/ > "$tmp/blog.xml"
curl -sf --max-time 60 -H "User-Agent: winnow/0.1" https://developers.cloudflare.com/changelog/rss/index.xml > "$tmp/changelog.xml"

node --input-type=module - "$tmp" "$window" "$raw_dir" <<'NODE'
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const [dir, windowHours, rawDir] = process.argv.slice(2);
const entity = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => e[0] === '#'
    ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)))
    : (entity[e] ?? m));
const text = (html) => decode(html).replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
const tag = (block, name) => (block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`)) || [])[1] || '';
// 本文は段落の切れ目を残す。CDATA の中は生の HTML、外はエスケープされた HTML なので、
// タグを外す前に外側だけ1度デコードし、実体参照(コード中の &lt; など)は最後に戻す
const body = (field) => decode((/<!\[CDATA\[/.test(field) ? field.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1') : decode(field))
  .replace(/<br\s*\/?>|<\/(p|li|h[1-6]|pre|tr|blockquote|div)>/gi, '\n')
  .replace(/<[^>]+>/g, ' '))
  .replace(/[ \t\u00a0]+/g, ' ').replace(/ *\n\s*/g, '\n').trim();
const bodyDir = resolve(rawDir, 'cloudflare');
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
    body: `${body(tag(b, 'description'))}\n\n${body(tag(b, 'content:encoded'))}`.trim(),
  })).filter((i) => i.title && i.url);
  // 窓内が空の日(週末等)でもタブを空にしないため、最新5件まで遡る
  const recent = all.filter((i) => Date.parse(i.published_at) >= since);
  return (recent.length ? recent : all.slice(0, 5)).slice(0, cap);
}

mkdirSync(bodyDir, { recursive: true });
const out = [...items('blog', 20), ...items('changelog', 30)].map(({ body: full, ...item }) => {
  const bodyPath = `${bodyDir}/${createHash('sha256').update(item.url).digest('hex').slice(0, 12)}.txt`;
  writeFileSync(bodyPath, `${item.title}\n${item.url}\n\n${full}\n`);
  return { ...item, body_path: bodyPath };
});
console.log(JSON.stringify(out));
NODE

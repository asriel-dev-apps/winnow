#!/usr/bin/env node
// stories.json の日本語の文を yomiyasu のリンターにかけ、指摘をフィールドのパスつきで出す。
// 指摘は見直しの候補。終了コードは常に 0（リンターが無くても日次を止めない）。
// 使い方: node scripts/jp-lint.mjs output/YYYY-MM-DD/stories.json
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

const SKIP_KEYS = new Set(['url', 'title', 'id', 'objectID', 'published_at', 'product', 'kind', 'type', 'source']);
const JA = /[぀-ヿ一-鿿]/;

function findLinter() {
  const base = join(homedir(), '.claude/plugins/cache/yomiyasu/yomiyasu');
  if (!existsSync(base)) return null;
  const versions = readdirSync(base).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  for (const v of versions.reverse()) {
    const p = join(base, v, 'skills/yomiyasu/scripts/yomiyasu_lint.py');
    if (existsSync(p)) return p;
  }
  return null;
}

function collect(node, path, out) {
  if (typeof node === 'string') {
    if (JA.test(node)) out.push({ path, text: node.replace(/\s*\n\s*/g, ' ') });
  } else if (Array.isArray(node)) {
    node.forEach((v, i) => collect(v, `${path}[${i}]`, out));
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) if (!SKIP_KEYS.has(k)) collect(v, path ? `${path}.${k}` : k, out);
  }
}

const file = process.argv[2];
if (!file) { console.error('usage: node scripts/jp-lint.mjs <stories.json>'); process.exit(0); }
const linter = findLinter();
if (!linter) { console.log(JSON.stringify({ skipped: 'yomiyasu linter not found' })); process.exit(0); }

const fields = [];
collect(JSON.parse(readFileSync(file, 'utf8')), '', fields);
// 1フィールド1段落。行番号 → フィールドの対応は 2i+1 行目
const doc = fields.map((f) => f.text).join('\n\n') + '\n';
let report;
try {
  report = JSON.parse(execFileSync('python3', [linter, '--json'], { input: doc, encoding: 'utf8' }));
} catch (e) {
  console.log(JSON.stringify({ skipped: `linter failed: ${e.message.split('\n')[0]}` }));
  process.exit(0);
}
const findings = report.findings
  .filter((f) => f.line % 2 === 1 && fields[(f.line - 1) / 2])
  .map((f) => ({ path: fields[(f.line - 1) / 2].path, rule: f.rule, severity: f.severity, message: f.message, text: fields[(f.line - 1) / 2].text }));
console.log(JSON.stringify({ fields: fields.length, findings }, null, 1));

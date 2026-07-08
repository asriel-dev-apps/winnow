#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const outputRoot = resolve('output');

function esc(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function firstMacroLine(data) {
  if (Array.isArray(data.macro_summary)) return String(data.macro_summary[0] || '');
  return String(data.macro_summary || '').split(/\r?\n/)[0] || '';
}

function readEntries() {
  if (!existsSync(outputRoot)) return [];
  return readdirSync(outputRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))
    .map((entry) => {
      const storiesPath = join(outputRoot, entry.name, 'stories.json');
      if (!existsSync(storiesPath)) return null;
      const data = JSON.parse(readFileSync(storiesPath, 'utf8'));
      const stories = Array.isArray(data.stories) ? data.stories : [];
      return {
        date: data.date || entry.name,
        count: stories.length,
        serendipity: stories.filter((story) => story.is_serendipity).length,
        macro: firstMacroLine(data),
        href: `${entry.name}/report.html`
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

const rows = readEntries().map((entry) => `<tr>
  <td><span class="date">${esc(entry.date)}</span></td>
  <td>${esc(entry.count)} stories${entry.serendipity ? ` <span class="gold">🎲${esc(entry.serendipity)}</span>` : ''}</td>
  <td>${esc(entry.macro)}</td>
  <td><a href="${esc(entry.href)}">report.html</a></td>
</tr>`).join('\n');

const html = `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Winnow Archive</title>
  <style>
    :root { color-scheme: light dark; --page:#f9f9f7; --card:#fcfcfb; --ink:#17181a; --ink-2:#52514e; --muted:#898781; --line:#e1e0d9; --gold:#c9920e; --mono:ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,monospace; --sans:"Hiragino Sans","Hiragino Kaku Gothic ProN","Yu Gothic UI",system-ui,-apple-system,"Segoe UI",sans-serif; }
    @media (prefers-color-scheme: dark) { :root { --page:#0d0d0d; --card:#1a1a19; --ink:#f2f2ef; --ink-2:#c3c2b7; --muted:#898781; --line:#2c2c2a; --gold:#e3b341; } }
    * { box-sizing:border-box; }
    body { margin:0; background:var(--page); color:var(--ink); font-family:var(--sans); font-size:15px; line-height:1.8; }
    main { max-width:920px; margin:0 auto; padding:42px 20px 64px; }
    .eyebrow { font-family:var(--mono); font-size:11px; font-weight:700; letter-spacing:.14em; color:var(--gold); text-transform:uppercase; }
    h1 { margin:6px 0 22px; font-size:28px; line-height:1.35; }
    table { width:100%; border-collapse:collapse; background:var(--card); border:1px solid var(--line); }
    th, td { padding:12px 14px; border-bottom:1px solid var(--line); text-align:left; vertical-align:top; }
    th { font-family:var(--mono); font-size:11px; letter-spacing:.12em; color:var(--muted); text-transform:uppercase; }
    tr:last-child td { border-bottom:0; }
    a { color:var(--ink); text-decoration:underline; text-decoration-color:var(--line); text-underline-offset:3px; }
    a:hover { text-decoration-color:var(--gold); }
    .date { font-family:var(--mono); font-weight:700; }
    .gold { color:var(--gold); font-family:var(--mono); }
    .empty { color:var(--muted); padding:18px 0; }
    @media (max-width:680px) { table, tbody, tr, td { display:block; } thead { display:none; } tr { border-bottom:1px solid var(--line); } td { border:0; padding:8px 12px; } }
  </style>
</head>
<body>
  <main>
    <p class="eyebrow">Winnow Archive</p>
    <h1>Survey Reports</h1>
    ${rows ? `<table><thead><tr><th>Date</th><th>Stories</th><th>Summary</th><th>Link</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="empty">No reports yet.</p>'}
  </main>
</body>
</html>
`;

mkdirSync(outputRoot, { recursive: true });
writeFileSync(join(outputRoot, 'index.html'), html);
console.log(JSON.stringify({ ok: true, html: join(outputRoot, 'index.html') }));

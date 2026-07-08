#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const outputRoot = resolve('output');

function esc(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function scriptJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function firstMacroLine(macroSummary) {
  if (Array.isArray(macroSummary)) return String(macroSummary[0] || '');
  return String(macroSummary || '').split(/\r?\n/)[0] || '';
}

function monthLabel(date) {
  return String(date).slice(0, 7);
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
      const releaseWatch = Array.isArray(data.release_watch) ? data.release_watch : [];
      const ossRanking = Array.isArray(data.oss_ranking) ? data.oss_ranking : [];
      return {
        date: String(data.date || entry.name),
        story_count: stories.length,
        serendipity_count: stories.filter((story) => story.is_serendipity).length,
        macro_summary: firstMacroLine(data.macro_summary),
        watch_terms: [
          ...releaseWatch.flatMap((watch) => [watch.repo, ...(Array.isArray(watch.releases) ? watch.releases.map((release) => release.tag) : [])]),
          ...ossRanking.map((ranking) => ranking.repo)
        ].map((value) => String(value || '')).filter(Boolean),
        stories: stories.map((story) => ({
          translated_title: String(story.translated_title || ''),
          topics: Array.isArray(story.topics) ? story.topics.map(String) : []
        }))
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

function groupedRows(entries) {
  if (!entries.length) return '<p class="empty">No reports yet.</p>';
  let currentMonth = '';
  let html = '';
  for (const entry of entries) {
    const month = monthLabel(entry.date);
    if (month !== currentMonth) {
      if (currentMonth) html += '</ol></section>';
      currentMonth = month;
      html += `<section class="month"><h2>${esc(month)}</h2><ol class="reportList">`;
    }
    const serendipity = entry.serendipity_count ? ` <span class="gold">+${esc(entry.serendipity_count)} serendipity</span>` : '';
    html += `<li class="reportRow">
      <a class="date" href="${esc(entry.date)}/report.html">${esc(entry.date)}</a>
      <span class="count">${esc(entry.story_count)} stories${serendipity}</span>
      <span class="summary">${esc(entry.macro_summary)}</span>
    </li>`;
  }
  return `${html}</ol></section>`;
}

const entries = readEntries();
const html = `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Winnow Archive</title>
  <style>
    :root {
      color-scheme: light dark;
      --page:#f9f9f7; --card:#fcfcfb; --ink:#17181a; --ink-2:#52514e; --muted:#898781;
      --line:#e1e0d9; --ring:rgba(11,11,11,.10);
      --gold:#c9920e; --gold-text:#7a5800; --gold-wash:rgba(201,146,14,.08);
      --mono:ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,monospace;
      --sans:"Hiragino Sans","Hiragino Kaku Gothic ProN","Yu Gothic UI",system-ui,-apple-system,"Segoe UI",sans-serif;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --page:#0d0d0d; --card:#1a1a19; --ink:#f2f2ef; --ink-2:#c3c2b7; --muted:#898781;
        --line:#2c2c2a; --ring:rgba(255,255,255,.10);
        --gold:#e3b341; --gold-text:#e3b341; --gold-wash:rgba(227,179,65,.09);
      }
    }
    * { box-sizing:border-box; }
    body { margin:0; background:var(--page); color:var(--ink); font-family:var(--sans); font-size:15.5px; line-height:1.9; -webkit-font-smoothing:antialiased; }
    :focus-visible { outline:2px solid var(--gold); outline-offset:2px; border-radius:4px; }
    main, .siteFooter { max-width:760px; margin:0 auto; padding-left:20px; padding-right:20px; }
    main { padding-top:42px; padding-bottom:40px; }
    .eyebrow { margin:0; font-family:var(--mono); font-size:11px; font-weight:700; letter-spacing:.14em; color:var(--gold-text); text-transform:uppercase; }
    h1 { margin:6px 0 22px; font-size:clamp(24px,4vw,30px); line-height:1.35; letter-spacing:.01em; }
    .searchWrap { margin:0 0 30px; }
    label { display:block; margin-bottom:8px; font-family:var(--mono); font-size:11px; font-weight:700; letter-spacing:.12em; color:var(--muted); text-transform:uppercase; }
    input { width:100%; min-height:46px; border:1px solid var(--line); border-radius:8px; padding:0 12px; background:var(--card); color:var(--ink); font:16px var(--sans); box-shadow:0 1px 2px var(--ring); }
    .resultMeta { min-height:24px; margin:8px 0 0; color:var(--muted); font-family:var(--mono); font-size:11px; letter-spacing:.06em; }
    .month { margin-top:28px; }
    h2 { margin:0 0 8px; padding-bottom:7px; border-bottom:1px solid var(--line); font-family:var(--mono); font-size:12px; letter-spacing:.14em; color:var(--muted); }
    .reportList { list-style:none; margin:0; padding:0; }
    .reportRow { display:grid; grid-template-columns:112px 130px minmax(0,1fr); gap:12px 18px; padding:13px 0; border-bottom:1px solid var(--line); align-items:start; }
    .reportRow:last-child { border-bottom:0; }
    a { color:var(--ink); text-decoration:underline; text-decoration-color:var(--line); text-underline-offset:3px; }
    a:hover { text-decoration-color:var(--gold); }
    .date, .count, .matchedTitle, .authLink { font-family:var(--mono); }
    .date { font-weight:800; }
    .count { font-size:11px; letter-spacing:.08em; color:var(--ink-2); text-transform:uppercase; }
    .summary { color:var(--ink); }
    .gold { color:var(--gold-text); }
    .matches { grid-column:3; margin:2px 0 0; padding:0; list-style:none; }
    .matches li { margin:2px 0; color:var(--ink-2); font-size:13px; line-height:1.6; }
    .matchedTitle { font-size:11px; letter-spacing:.06em; }
    .empty { color:var(--muted); padding:18px 0; }
    .siteFooter { padding-bottom:34px; }
    .authLink { font-size:11px; font-weight:700; letter-spacing:.14em; color:var(--muted); }
    @media (max-width:680px) {
      body { font-size:15px; }
      main { padding-top:34px; }
      .reportRow { grid-template-columns:1fr; gap:2px; padding:15px 0; }
      .matches { grid-column:auto; margin-top:6px; }
    }
  </style>
</head>
<body>
  <main>
    <p class="eyebrow">Winnow Archive</p>
    <h1>Survey Reports</h1>
    <div class="searchWrap">
      <label for="archiveSearch">Search</label>
      <input id="archiveSearch" type="search" autocomplete="off" placeholder="date, summary, story, topic">
      <p class="resultMeta" id="resultMeta">${entries.length ? `${entries.length} reports` : 'No reports'}</p>
    </div>
    <div id="archiveList">
      ${groupedRows(entries)}
    </div>
  </main>
  <footer class="siteFooter">
    <a class="authLink" href="/login">LOGIN</a>
  </footer>
  <script type="application/json" id="archive-data">${scriptJson(entries)}</script>
  <script>
    const reports = JSON.parse(document.getElementById('archive-data').textContent || '[]');
    const input = document.getElementById('archiveSearch');
    const list = document.getElementById('archiveList');
    const meta = document.getElementById('resultMeta');

    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
    }
    function terms(query) {
      return query.trim().toLowerCase().split(/\\s+/).filter(Boolean);
    }
    function storyText(story) {
      return [story.translated_title, ...(story.topics || [])].join(' ').toLowerCase();
    }
    function reportText(report) {
      return [report.date, report.macro_summary, ...(report.watch_terms || []), ...(report.stories || []).map(storyText)].join(' ').toLowerCase();
    }
    function storyMatches(story, queryTerms) {
      const text = storyText(story);
      return queryTerms.every((term) => text.includes(term));
    }
    function reportMatches(report, queryTerms) {
      const text = reportText(report);
      return queryTerms.every((term) => text.includes(term));
    }
    function renderRows(rows, queryTerms) {
      if (!rows.length) return '<p class="empty">該当なし</p>';
      let currentMonth = '';
      let html = '';
      for (const report of rows) {
        const month = report.date.slice(0, 7);
        if (month !== currentMonth) {
          if (currentMonth) html += '</ol></section>';
          currentMonth = month;
          html += '<section class="month"><h2>' + escapeHtml(month) + '</h2><ol class="reportList">';
        }
        const serendipity = report.serendipity_count ? ' <span class="gold">+' + escapeHtml(report.serendipity_count) + ' serendipity</span>' : '';
        const matches = queryTerms.length
          ? (report.stories || []).filter((story) => storyMatches(story, queryTerms)).slice(0, 3)
          : [];
        const matchList = matches.length
          ? '<ul class="matches">' + matches.map((story) => '<li><a class="matchedTitle" href="' + escapeHtml(report.date) + '/report.html">' + escapeHtml(story.translated_title) + '</a></li>').join('') + '</ul>'
          : '';
        html += '<li class="reportRow">' +
          '<a class="date" href="' + escapeHtml(report.date) + '/report.html">' + escapeHtml(report.date) + '</a>' +
          '<span class="count">' + escapeHtml(report.story_count) + ' stories' + serendipity + '</span>' +
          '<span class="summary">' + escapeHtml(report.macro_summary) + '</span>' +
          matchList +
          '</li>';
      }
      return html + '</ol></section>';
    }
    function applySearch() {
      const queryTerms = terms(input.value);
      const rows = queryTerms.length ? reports.filter((report) => reportMatches(report, queryTerms)) : reports;
      list.innerHTML = renderRows(rows, queryTerms);
      meta.textContent = queryTerms.length ? rows.length + ' matching reports' : reports.length + ' reports';
    }
    function debounce(fn, delay) {
      let timer = 0;
      return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
      };
    }
    input.addEventListener('input', debounce(applySearch, 150));
  </script>
</body>
</html>
`;

mkdirSync(outputRoot, { recursive: true });
writeFileSync(join(outputRoot, 'index.html'), html);
console.log(JSON.stringify({ ok: true, html: join(outputRoot, 'index.html') }));

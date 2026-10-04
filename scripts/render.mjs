#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const args = process.argv.slice(2);
const file = args[0];
if (!file) {
  console.error('usage: render.mjs <stories.json> [--out <dir>]');
  process.exit(1);
}

const outIdx = args.indexOf('--out');
if (outIdx !== -1 && !args[outIdx + 1]) {
  console.error('usage: render.mjs <stories.json> [--out <dir>]');
  process.exit(1);
}

const storiesPath = resolve(file);
const data = JSON.parse(readFileSync(storiesPath, 'utf8'));
const outDir = outIdx === -1 ? dirname(storiesPath) : resolve(args[outIdx + 1]);
mkdirSync(outDir, { recursive: true });

function line(value = '') {
  return String(value).replace(/\n+/g, ' ');
}

function esc(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const KNOWN_SOURCES = ['hn', 'zenn', 'qiita', 'hatebu', 'ghtrend', 'reddit', 'lobsters', 'agents'];

function srcVar(source) {
  return KNOWN_SOURCES.includes(source) ? `var(--s-${source})` : 'var(--muted)';
}

function storySources(story) {
  return [...new Set((story.items || []).map((i) => i.source))];
}

function engagement(item) {
  return Object.entries(item.engagement || {})
    .filter(([k]) => k !== 'hn_object_id')
    .map(([k, v]) => `${k} ${v}`)
    .join(' · ');
}

function sourceCounts() {
  const counts = {};
  for (const story of data.stories || []) {
    for (const item of story.items || []) counts[item.source] = (counts[item.source] || 0) + 1;
  }
  // 帯グラフの隣接順=検証済みパレットのスロット順に固定する(CVD安全性は順序で担保)
  return KNOWN_SOURCES.filter((s) => counts[s]).map((s) => [s, counts[s]])
    .concat(Object.entries(counts).filter(([s]) => !KNOWN_SOURCES.includes(s)));
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toLocaleDateString('ja-JP');
}

function renderStaticHeader() {
  const counts = sourceCounts();
  let grainIndex = 0;
  const groups = counts
    .map(([source, count]) => {
      const grains = Array.from({ length: Number(count) }, () => {
        const delay = Math.min(grainIndex * 22, 900);
        grainIndex += 1;
        return `<i class="grain" style="background:${srcVar(source)};animation-delay:${delay}ms"></i>`;
      }).join('');
      return `<span class="ggroup" title="${esc(source)} ${esc(count)}">${grains}</span>`;
    })
    .join('');
  const legend = counts
    .map(([source, count]) => `<span><span class="dot" style="background:${srcVar(source)}"></span>${esc(source.toUpperCase())} ${esc(count)}</span>`)
    .join('');
  const grainsLabel = counts.map(([s, n]) => `${s} ${n}件`).join('、');
  return `<p class="eyebrow">DAILY TECH SURVEY — ${esc(data.date || '')} · RUN ${esc(data.run_id || '')}</p>
    <h1>今日の収穫、3行で。</h1>
    <ol class="macro" id="macro">${(data.macro_summary || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ol>
    <div class="grains" role="img" aria-label="掲載ストーリーのソース内訳(1粒=記事1件): ${esc(grainsLabel)}">${groups}</div>
    <div class="legend" id="legend">${legend}</div>`;
}

function storyHtml(story) {
  const sections = story.sections || {};
  const qas = Array.isArray(sections.quick_questions) ? sections.quick_questions : [];
  const srcTags = storySources(story)
    .map((s) => `<span class="src"><i class="dot" style="background:${srcVar(s)}"></i>${esc(String(s).toUpperCase())}</span>`)
    .join('');
  const eng = (story.items || []).slice(0, 1).map((i) => engagement(i)).filter(Boolean).join('');
  const date = (story.items || [])
    .slice(0, 1)
    .map((i) => (i.published_at ? new Date(i.published_at).toLocaleDateString('ja-JP') : ''))
    .filter(Boolean)
    .join('');
  return `<article class="story" data-cluster="${esc(story.cluster_id)}">
        <div class="eyebrow">${srcTags}<span class="chip">SCORE ${esc(story.composite_score)}</span>${story.is_serendipity ? '<span class="chip gold">🎲 SERENDIPITY</span>' : ''}${eng ? `<span class="metaeng">${esc(eng)}</span>` : ''}${date ? `<span class="metaeng">${esc(date)}</span>` : ''}</div>
        <h3>${esc(story.translated_title)}<span class="feedbackBadge docFeedbackBadge" hidden></span></h3>
        <p>${esc(story.summary)}</p>
        <div class="why"><b>WHY THIS</b>${esc(story.selection_reason)}</div>
        ${sections.discussion ? `<details><summary>💬 議論の論点</summary><p>${esc(sections.discussion)}</p></details>` : ''}
        ${sections.perspectives ? `<details><summary>⚖️ Perspectives</summary><p>${esc(sections.perspectives)}</p></details>` : ''}
        ${qas.length ? `<details><summary>❓ Quick questions</summary>${qas.map((qa) => `<p><strong>Q.</strong> ${esc(qa.q)}<br><strong>A.</strong> ${esc(qa.a)}</p>`).join('')}</details>` : ''}
        ${sections.did_you_know ? `<details><summary>💡 Did you know?</summary><p>${esc(sections.did_you_know)}</p></details>` : ''}
        <ul class="links">${(story.items || []).map((i) => `<li><a href="${esc(i.url)}" target="_blank" rel="noopener noreferrer">${esc(i.title)}</a> <span class="from">${esc(String(i.source).toUpperCase())}</span></li>`).join('')}</ul>
      </article>`;
}

function releaseWatchHtml() {
  const entries = Array.isArray(data.release_watch) ? data.release_watch : [];
  if (!entries.length) return '';
  return `<section class="watchSection" id="releaseView">
    <p class="eyebrow">RELEASE WATCH</p>
    <div class="watchCards">${entries.map((entry) => {
      const releases = Array.isArray(entry.releases) ? entry.releases : [];
      return `<article class="watchCard">
        <h3 class="watchRepo">${esc(entry.repo)}</h3>
        <ul class="watchList">${releases.map((release) => `<li><a href="${esc(release.url)}" target="_blank" rel="noopener noreferrer">${esc(release.tag)}</a>${release.published_at ? ` <span class="watchDate">${esc(formatDate(release.published_at))}</span>` : ''}${release.notes_summary ? `<p>${esc(release.notes_summary)}</p>` : ''}</li>`).join('')}</ul>
      </article>`;
    }).join('')}</div>
  </section>`;
}

const CLOUDFLARE_GROUPS = [['blog', 'BLOG'], ['changelog', 'CHANGELOG']];

function cloudflareEntries(kind) {
  const watch = data.cloudflare_watch || {};
  return Array.isArray(watch[kind]) ? watch[kind] : [];
}

const CLOUDFLARE_KINDS = { agent: 'AI エージェント', platform: 'Workers 基盤', pricing: '料金に影響', security: 'セキュリティ' };

function cloudflareHighlights() {
  const highlights = (data.cloudflare_watch || {}).highlights;
  return Array.isArray(highlights) ? highlights : [];
}

function cfFlowHtml(steps, tone) {
  return `<div class="cfFlow">${steps.map((step) => `<div class="cfStep ${tone}"><b>${esc(step.label)}</b>${step.note ? `<small>${esc(step.note)}</small>` : ''}</div>`).join('<i class="cfArrow" aria-hidden="true"></i>')}</div>`;
}

function cfHighlightHtml(h, index) {
  const before = Array.isArray(h.before) ? h.before : [];
  const after = Array.isArray(h.after) ? h.after : [];
  const stats = Array.isArray(h.stats) ? h.stats : [];
  const use = Array.isArray(h.use) ? h.use : [];
  const kind = CLOUDFLARE_KINDS[h.kind] ? h.kind : 'platform';
  return `<article class="cfCard" id="cf${index + 1}">
      <p class="cfEyebrow"><span class="cfKind cf-${kind}">${esc(CLOUDFLARE_KINDS[kind])}</span>${esc(h.product || '')}</p>
      <h3 class="cfHeadline">${esc(h.headline)}</h3>
      ${stats.length ? `<div class="cfStats">${stats.map((s) => `<div><span class="v">${esc(s.value)}</span><span class="l">${esc(s.label)}</span></div>`).join('')}</div>` : ''}
      ${before.length ? `<p class="cfRow ng">これまで</p>${cfFlowHtml(before, 'ng')}` : ''}
      ${after.length ? `${before.length ? '<p class="cfRow ok">これから</p>' : ''}${cfFlowHtml(after, 'ok')}` : ''}
      ${h.warn ? `<p class="cfWarn">${esc(h.warn)}</p>` : ''}
      ${use.length ? `<ul class="cfUse">${use.map((u) => `<li>${esc(u)}</li>`).join('')}</ul>` : ''}
      <a class="cfSrc" href="${esc(h.url)}" target="_blank" rel="noopener noreferrer">${esc(h.title)} →</a>
    </article>`;
}

function cloudflareWatchHtml() {
  const highlights = cloudflareHighlights();
  const highlighted = new Set(highlights.map((h) => h.url));
  const groups = CLOUDFLARE_GROUPS
    .map(([kind, label]) => [label, cloudflareEntries(kind).filter((entry) => !highlighted.has(entry.url))])
    .filter(([, entries]) => entries.length);
  if (!highlights.length && !groups.length) return '';
  const rest = groups.reduce((n, [, entries]) => n + entries.length, 0);
  const lists = groups.map(([label, entries]) => `<h3 class="watchRepo">${label}</h3>
        <ul class="watchList">${entries.map((entry) => `<li><a href="${esc(entry.url)}" target="_blank" rel="noopener noreferrer">${esc(entry.title)}</a>${entry.published_at ? ` <span class="watchDate">${esc(formatDate(entry.published_at))}</span>` : ''}${entry.summary ? `<p>${esc(entry.summary)}</p>` : ''}</li>`).join('')}</ul>`).join('');
  return `<section class="watchSection" id="cloudflareView">
    <p class="eyebrow">CLOUDFLARE OFFICIAL</p>
    ${highlights.length ? `<nav class="cfPicks">${highlights.map((h, i) => `<a href="#cf${i + 1}" data-cf-jump><span class="cfKind cf-${CLOUDFLARE_KINDS[h.kind] ? h.kind : 'platform'}">${i + 1}</span>${esc(h.product || h.headline)}</a>`).join('')}</nav>
    <div class="cfCards">${highlights.map(cfHighlightHtml).join('')}</div>` : ''}
    ${groups.length ? (highlights.length
      ? `<details class="cfRest"><summary>ほかの発表（${rest} 件）</summary>${lists}</details>`
      : `<div class="watchCards"><article class="watchCard">${lists}</article></div>`) : ''}
  </section>`;
}

function rankingListHtml(entries) {
  return `<ol class="rankingList">${entries.map((entry) => `<li value="${esc(entry.rank)}"><a href="${esc(entry.url)}" target="_blank" rel="noopener noreferrer">${esc(entry.repo)}</a>${entry.note ? ` <span class="rankNote">— ${esc(entry.note)}</span>` : ''}</li>`).join('')}</ol>`;
}

function ossRankingHtml() {
  const llm = Array.isArray(data.oss_ranking) ? data.oss_ranking : [];
  const general = Array.isArray(data.oss_ranking_general) ? data.oss_ranking_general : [];
  if (!llm.length && !general.length) return '';
  const groups = [
    llm.length ? `<div class="rankingGroup"><h3 class="rankingHead">LLM &amp; AGENTS</h3>${rankingListHtml(llm)}</div>` : '',
    general.length ? `<div class="rankingGroup"><h3 class="rankingHead">TOOLS &amp; APPS</h3>${rankingListHtml(general)}</div>` : '',
  ].join('');
  return `<section class="watchSection" id="rankingView">
    <p class="eyebrow">OSS RANKING</p>
    ${groups}
  </section>`;
}

function watchSectionsHtml() {
  return releaseWatchHtml() + cloudflareWatchHtml() + ossRankingHtml();
}

function renderContentTabs() {
  const hasReleaseWatch = Array.isArray(data.release_watch) && data.release_watch.length;
  const hasOssRanking = (Array.isArray(data.oss_ranking) && data.oss_ranking.length)
    || (Array.isArray(data.oss_ranking_general) && data.oss_ranking_general.length);
  const hasCloudflare = cloudflareHighlights().length || CLOUDFLARE_GROUPS.some(([kind]) => cloudflareEntries(kind).length);
  if (!hasReleaseWatch && !hasOssRanking && !hasCloudflare) return '';
  return `<div class="contentTabs" id="contentTabs" role="tablist" aria-label="Report sections">
        <button class="contentTab" type="button" role="tab" data-tab="survey" aria-selected="true">SURVEY</button>
        ${hasReleaseWatch ? '<button class="contentTab" type="button" role="tab" data-tab="releases" aria-selected="false">RELEASES</button>' : ''}
        ${hasCloudflare ? '<button class="contentTab" type="button" role="tab" data-tab="cloudflare" aria-selected="false">CLOUDFLARE</button>' : ''}
        ${hasOssRanking ? '<button class="contentTab" type="button" role="tab" data-tab="ranking" aria-selected="false">RANKING</button>' : ''}
      </div>`;
}

function renderStaticDocument() {
  const fetchList = (data.fetch_status || [])
    .map((s) => `<li><span class="${s.ok ? 'ok' : 'ng'}">${s.ok ? 'OK' : 'NG'}</span><span>${esc(String(s.source).toUpperCase())}</span><span>${esc(s.count ?? 0)}件</span>${s.note ? `<span class="muted">${esc(s.note)}</span>` : ''}</li>`)
    .join('');
  const fetch = `<div class="fetchwrap"><p class="eyebrow">FETCH STATUS</p><ul class="fetch">${fetchList}</ul></div>`;
  return (data.stories || []).map((story) => storyHtml(story)).join('') + watchSectionsHtml() + fetch;
}

let md = `# Winnow ${data.date || ''}\n\n`;
md += `## 今回のサーベイを3行で\n\n`;
for (const item of data.macro_summary || []) md += `- ${line(item)}\n`;
md += `\n## ストーリー\n\n`;
for (const story of data.stories || []) {
  md += `### ${line(story.translated_title)}\n\n`;
  md += `source_count: ${Math.max(...(story.items || []).map((i) => i.source_count || 1), 1)} / match: ${story.match_score} / quality: ${story.quality_score} / composite: ${story.composite_score}${story.is_serendipity ? ' / serendipity' : ''}\n\n`;
  md += `${line(story.summary)}\n\n`;
  md += `選定理由: ${line(story.selection_reason)}\n\n`;
  const sections = story.sections || {};
  if (sections.discussion) md += `#### 議論の論点\n\n${line(sections.discussion)}\n\n`;
  if (sections.perspectives) md += `#### Perspectives\n\n${line(sections.perspectives)}\n\n`;
  if (Array.isArray(sections.quick_questions) && sections.quick_questions.length) {
    md += `#### Quick questions\n\n`;
    for (const qa of sections.quick_questions) md += `- Q. ${line(qa.q)} / A. ${line(qa.a)}\n`;
    md += `\n`;
  }
  if (sections.did_you_know) md += `#### Did you know?\n\n${line(sections.did_you_know)}\n\n`;
  md += `関連リンク:\n`;
  for (const item of story.items || []) md += `- [${line(item.title)}](${item.url}) (${item.source})\n`;
  md += `\n`;
}
if (Array.isArray(data.release_watch) && data.release_watch.length) {
  md += `## RELEASE WATCH\n\n`;
  for (const entry of data.release_watch) {
    md += `### ${line(entry.repo)}\n\n`;
    for (const release of entry.releases || []) {
      const date = release.published_at ? ` / ${line(formatDate(release.published_at))}` : '';
      const notes = release.notes_summary ? ` — ${line(release.notes_summary)}` : '';
      md += `- [${line(release.tag)}](${release.url})${date}${notes}\n`;
    }
    md += `\n`;
  }
}
if (cloudflareHighlights().length || CLOUDFLARE_GROUPS.some(([kind]) => cloudflareEntries(kind).length)) {
  md += `## CLOUDFLARE OFFICIAL\n\n`;
  for (const h of cloudflareHighlights()) {
    md += `### ${line(h.headline)}\n\n[${line(h.title)}](${h.url})${h.product ? ` / ${line(h.product)}` : ''}\n\n`;
    const flow = (steps) => steps.map((s) => line(s.label)).join(' → ');
    if (Array.isArray(h.before) && h.before.length) md += `- これまで: ${flow(h.before)}\n`;
    if (Array.isArray(h.after) && h.after.length) md += `- ${h.before?.length ? 'これから' : 'しくみ'}: ${flow(h.after)}\n`;
    for (const s of h.stats || []) md += `- ${line(s.value)}: ${line(s.label)}\n`;
    if (h.warn) md += `- 注意: ${line(h.warn)}\n`;
    for (const u of h.use || []) md += `- ${line(u)}\n`;
    md += `\n`;
  }
  for (const [kind, label] of CLOUDFLARE_GROUPS) {
    const entries = cloudflareEntries(kind);
    if (!entries.length) continue;
    md += `### ${label}\n\n`;
    for (const entry of entries) {
      const date = entry.published_at ? ` / ${line(formatDate(entry.published_at))}` : '';
      const summary = entry.summary ? ` — ${line(entry.summary)}` : '';
      md += `- [${line(entry.title)}](${entry.url})${date}${summary}\n`;
    }
    md += `\n`;
  }
}
{
  const llmRank = Array.isArray(data.oss_ranking) ? data.oss_ranking : [];
  const generalRank = Array.isArray(data.oss_ranking_general) ? data.oss_ranking_general : [];
  if (llmRank.length || generalRank.length) {
    md += `## OSS RANKING\n\n`;
    for (const [heading, entries] of [['LLM & AGENTS', llmRank], ['TOOLS & APPS', generalRank]]) {
      if (!entries.length) continue;
      md += `### ${heading}\n\n`;
      for (const entry of entries) {
        md += `${entry.rank}. [${line(entry.repo)}](${entry.url})${entry.note ? ` — ${line(entry.note)}` : ''}\n`;
      }
      md += `\n`;
    }
  }
}
md += `## 取得状況\n\n`;
for (const status of data.fetch_status || []) {
  md += `- ${status.source}: ${status.ok ? 'ok' : 'failed'} / ${status.count ?? 0}件 / ${line(status.note || '')}\n`;
}
writeFileSync(join(outDir, 'report.md'), md);

const template = readFileSync(resolve('templates/report.html'), 'utf8');
const port = process.env.WINNOW_PORT || '8765';
const apiBase = Object.hasOwn(process.env, 'WINNOW_API_BASE') ? process.env.WINNOW_API_BASE : `http://127.0.0.1:${port}`;
const payload = { ...data, apiBase };
const html = template
  .replace('<!--__STATIC_HEADER__-->', renderStaticHeader())
  .replace('<!--__CONTENT_TABS__-->', renderContentTabs())
  .replace('<!--__STATIC_DOCUMENT__-->', renderStaticDocument())
  .replace('/*__WINNOW_DATA__*/', JSON.stringify(payload).replace(/</g, '\\u003c'));
writeFileSync(join(outDir, 'report.html'), html);
console.log(JSON.stringify({ ok: true, markdown: join(outDir, 'report.md'), html: join(outDir, 'report.html') }));

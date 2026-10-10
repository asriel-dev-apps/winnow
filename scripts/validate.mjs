#!/usr/bin/env node
import { readFileSync } from 'node:fs';

function sentences(text) {
  return String(text || '').split('。').filter((part) => part.trim().length > 0).length;
}

function violation(rule, message, clusterId) {
  return clusterId ? { rule, cluster_id: clusterId, message } : { rule, message };
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

// §4.9 の図の型ごとの形。問題点の文の配列を返す(空なら合格)
const count = (arr, min, max) => Array.isArray(arr) && arr.length >= min && arr.length <= max;
const strings = (arr, min, max) => count(arr, min, max) && arr.every(nonEmpty);
const steps = (arr) => count(arr, 2, 5) && arr.every((s) => nonEmpty(s?.label));
const FIGURE_CHECKS = {
  flow: (f) => [
    ...(f.before !== undefined && !steps(f.before) ? ['before must be 2-5 [{label, note?}]'] : []),
    ...(!steps(f.after) ? ['after must be 2-5 [{label, note?}]'] : []),
  ],
  sequence: (f) => {
    if (!strings(f.actors, 2, 4)) return ['actors must be 2-4 names'];
    if (!count(f.steps, 2, 8)) return ['steps must have 2-8 entries'];
    return f.steps.flatMap((s, i) => [
      ...(!f.actors.includes(s?.from) ? [`step ${i + 1} from "${s?.from}" is not in actors`] : []),
      ...(!f.actors.includes(s?.to) ? [`step ${i + 1} to "${s?.to}" is not in actors`] : []),
      ...(!nonEmpty(s?.label) ? [`step ${i + 1} label must be non-empty`] : []),
    ]);
  },
  layers: (f) => (count(f.layers, 2, 5) && f.layers.every((l) => nonEmpty(l?.label) && strings(l?.items, 1, 6))
    ? [] : ['layers must be 2-5 [{label, items: 1-6 strings}]']),
  compare: (f) => {
    if (!strings(f.columns, 2, 4)) return ['columns must be 2-4 headings'];
    if (!count(f.rows, 1, 6)) return ['rows must have 1-6 entries'];
    return f.rows.flatMap((r, i) => [
      ...(!nonEmpty(r?.label) ? [`row ${i + 1} label must be non-empty`] : []),
      ...(!Array.isArray(r?.cells) || r.cells.length !== f.columns.length ? [`row ${i + 1} cells must have ${f.columns.length} entries (same as columns)`] : []),
    ]);
  },
  timeline: (f) => {
    if (!count(f.events, 2, 6)) return ['events must have 2-6 entries'];
    return f.events.flatMap((e, i) => (nonEmpty(e?.date) && nonEmpty(e?.label) ? [] : [`event ${i + 1} must have date and label`]));
  },
  split: (f) => ['left', 'right'].flatMap((side) => (nonEmpty(f[side]?.label) && strings(f[side]?.items, 1, 5)
    ? [] : [`${side} must be {label, items: 1-5 strings}`])),
  stats: (f) => (count(f.items, 2, 3) && f.items.every((s) => nonEmpty(s?.value) && nonEmpty(s?.label))
    ? [] : ['items must be 2-3 [{value, label}]']),
};

// 全体図(overview)の形。flow だけは before/after でなく steps 2〜7段
const OVERVIEW_CHECKS = {
  ...FIGURE_CHECKS,
  flow: (f) => (count(f.steps, 2, 7) && f.steps.every((s) => nonEmpty(s?.label)) ? [] : ['steps must be 2-7 [{label, note?}]']),
};
const chars = (s) => [...String(s ?? '')].length;
const tooLong = (path, value, max) => (typeof value === 'string' && chars(value) > max ? [`${path} must be at most ${max} chars (got ${chars(value)})`] : []);
const LABEL_MAX = 16;
const NOTE_MAX = 24;
// 空でない文字列で、max があればその字数以下
const str = (path, value, max) => (nonEmpty(value) ? (max ? tooLong(path, value, max) : []) : [`${path} must be a non-empty string`]);
// 図の中の label/items/actors/columns は16字、note/caption は24字(コードポイント数)。compare の cells は空でない文字列だけ
function figureFields(value, path) {
  if (Array.isArray(value)) return value.flatMap((v, i) => figureFields(v, `${path}[${i}]`));
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, v]) => {
    const p = `${path}.${key}`;
    if (key === 'label') return str(p, v, LABEL_MAX);
    if (key === 'note' || key === 'caption') return str(p, v, NOTE_MAX);
    if (['items', 'actors', 'columns', 'cells'].includes(key) && Array.isArray(v)) {
      // stats の items だけは {value, label} の配列
      return v.flatMap((x, i) => (key === 'items' && x && typeof x === 'object' ? figureFields(x, `${p}[${i}]`) : str(`${p}[${i}]`, x, key === 'cells' ? 0 : LABEL_MAX)));
    }
    return typeof v === 'object' ? figureFields(v, p) : [];
  });
}
function overviewProblems(f, path) {
  const check = Object.hasOwn(OVERVIEW_CHECKS, f?.type) ? OVERVIEW_CHECKS[f.type] : null;
  if (!check) return [`${path}: unknown type (flow|sequence|layers|compare|timeline|split|stats)`];
  return [...check(f).map((p) => `${path} (${f.type}): ${p}`), ...figureFields(f, path)];
}
function m9Problems(h) {
  const problems = [];
  if (Object.hasOwn(h, 'figures')) problems.push('overview and figures cannot both be present');
  problems.push(...tooLong('headline', h.headline, 40));
  for (const [key, max] of [['essence', 90], ['who', 60], ['warn', 80]]) if (Object.hasOwn(h, key)) problems.push(...str(key, h[key], max));
  problems.push(...overviewProblems(h.overview, 'overview'));
  if (h.overview?.type === 'compare' && Array.isArray(h.overview.columns) && h.overview.columns.some((c) => c === 'これまで' || c === 'これから')) {
    problems.push('overview (compare): columns must not be "これまで"/"これから" (show old/new in changes or before_overview)');
  }
  if (Object.hasOwn(h, 'before_overview')) {
    if (h.before_overview?.type !== h.overview?.type) problems.push(`before_overview type "${h.before_overview?.type}" must match overview type "${h.overview?.type}"`);
    else problems.push(...overviewProblems(h.before_overview, 'before_overview'));
  }
  if (Object.hasOwn(h, 'changes')) {
    if (!count(h.changes, 1, 3)) problems.push('changes must have 1-3 rows');
    else h.changes.forEach((c, i) => {
      for (const [key, max] of [['label', 12], ['before', 28], ['after', 28]]) {
        problems.push(...(nonEmpty(c?.[key]) ? tooLong(`changes[${i}].${key}`, c[key], max) : [`changes[${i}].${key} must be non-empty`]));
      }
    });
  }
  if (Object.hasOwn(h, 'gains')) {
    if (!count(h.gains, 1, 2)) problems.push('gains must have 1-2 entries');
    else h.gains.forEach((g, i) => {
      problems.push(...(nonEmpty(g?.title) ? tooLong(`gains[${i}].title`, g.title, 20) : [`gains[${i}].title must be non-empty`]));
      if (Object.hasOwn(g ?? {}, 'note')) problems.push(...str(`gains[${i}].note`, g.note, 32));
    });
  }
  return problems;
}

try {
  const file = process.argv[2];
  if (!file) throw new Error('usage: validate.mjs <stories.json>');
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const errors = [];
  const stories = Array.isArray(data.stories) ? data.stories : [];
  const normalCount = stories.filter((s) => !s.is_serendipity).length;
  const serendipityCount = stories.filter((s) => s.is_serendipity).length;
  if (normalCount < 1 || normalCount > 15) errors.push(violation('story_count', 'normal story count must be 1-15'));
  if (serendipityCount > 2) errors.push(violation('story_count', 'serendipity story count must be 0-2'));
  if (!Array.isArray(data.macro_summary) || data.macro_summary.length !== 3) errors.push(violation('macro_summary', 'macro_summary must have exactly 3 entries'));
  for (const story of stories) {
    const cid = story.cluster_id || '(missing)';
    const count = sentences(story.summary);
    if (count < 2 || count > 3) errors.push(violation('summary', 'summary must contain 2-3 Japanese sentences ending with 。', cid));
    if (!story.selection_reason || String(story.selection_reason).includes('\n')) errors.push(violation('selection_reason', 'selection_reason must be non-empty and single-line', cid));
    if (!story.translated_title) errors.push(violation('translated_title', 'translated_title must be non-empty', cid));
    if (!Array.isArray(story.items) || story.items.length === 0) {
      errors.push(violation('items', 'story must have at least one item', cid));
    } else {
      for (const item of story.items) {
        if (!item.url) errors.push(violation('items', `item ${item.id || '(missing id)'} must have url`, cid));
      }
    }
    if (!story.is_serendipity && Number(story.composite_score) < 55) errors.push(violation('composite_score', 'normal story composite_score must be >= 55', cid));
  }
  if (Object.hasOwn(data, 'release_watch')) {
    if (!Array.isArray(data.release_watch)) {
      errors.push(violation('release_watch', 'release_watch must be an array'));
    } else {
      const repos = new Set();
      for (const entry of data.release_watch) {
        const repo = entry?.repo;
        if (!nonEmpty(repo)) errors.push(violation('release_watch', 'release_watch entry repo must be non-empty'));
        else if (repos.has(repo)) errors.push(violation('release_watch', `release_watch repo must be unique: ${repo}`));
        else repos.add(repo);
        if (!Array.isArray(entry?.releases) || entry.releases.length === 0) {
          errors.push(violation('release_watch', `release_watch ${repo || '(missing repo)'} must have at least one release`));
        } else {
          for (const release of entry.releases) {
            if (!nonEmpty(release?.tag)) errors.push(violation('release_watch', `release_watch ${repo || '(missing repo)'} release tag must be non-empty`));
            if (!nonEmpty(release?.url)) errors.push(violation('release_watch', `release_watch ${repo || '(missing repo)'} release url must be non-empty`));
          }
        }
      }
    }
  }
  function validateRanking(key) {
    if (!Object.hasOwn(data, key)) return;
    if (!Array.isArray(data[key])) {
      errors.push(violation(key, `${key} must be an array`));
      return;
    }
    if (data[key].length > 10) errors.push(violation(key, `${key} must have at most 10 entries`));
    data[key].forEach((entry, index) => {
      if (Number(entry?.rank) !== index + 1) errors.push(violation(key, `${key} rank must be sequential from 1`));
      if (!nonEmpty(entry?.repo)) errors.push(violation(key, `${key} entry repo must be non-empty`));
      if (!nonEmpty(entry?.url)) errors.push(violation(key, `${key} entry url must be non-empty`));
    });
  }
  if (Object.hasOwn(data, 'cloudflare_watch')) {
    const watch = data.cloudflare_watch;
    if (!watch || typeof watch !== 'object' || Array.isArray(watch)) {
      errors.push(violation('cloudflare_watch', 'cloudflare_watch must be an object'));
    } else {
      for (const [kind, entries] of Object.entries(watch)) {
        if (kind === 'highlights') {
          if (!Array.isArray(entries)) { errors.push(violation('cloudflare_watch', 'cloudflare_watch.highlights must be an array')); continue; }
          if (entries.length > 5) errors.push(violation('cloudflare_watch', 'cloudflare_watch.highlights must have at most 5 entries'));
          const isSteps = (v) => v === undefined || (Array.isArray(v) && v.every((s) => nonEmpty(s?.label)));
          for (const h of entries) {
            for (const key of ['title', 'url', 'headline']) if (!nonEmpty(h?.[key])) errors.push(violation('cloudflare_watch', `highlight ${key} must be non-empty`));
            if (!['agent', 'platform', 'pricing', 'security'].includes(h?.kind)) errors.push(violation('cloudflare_watch', `highlight kind must be agent|platform|pricing|security: ${h?.headline}`));
            if (Object.hasOwn(h ?? {}, 'overview')) {
              for (const p of m9Problems(h)) errors.push(violation('cloudflare_watch', `highlight ${p}: ${h?.headline}`));
              continue;
            }
            if (Object.hasOwn(h ?? {}, 'figures')) {
              if (!Array.isArray(h.figures) || h.figures.length < 1 || h.figures.length > 3) errors.push(violation('cloudflare_watch', `highlight figures must have 1-3 entries: ${h?.headline}`));
              else h.figures.forEach((f, i) => {
                const check = Object.hasOwn(FIGURE_CHECKS, f?.type) ? FIGURE_CHECKS[f.type] : null;
                const problems = check ? check(f) : [`unknown type (flow|sequence|layers|compare|timeline|split|stats)`];
                if (f?.caption !== undefined && !nonEmpty(f.caption)) problems.push('caption must be a non-empty string');
                for (const p of problems) errors.push(violation('cloudflare_watch', `highlight figure ${i + 1} (${f?.type}): ${p}: ${h?.headline}`));
              });
            } else {
              // 旧形式(〜2026-10-08)。過去の stories.json を描けるよう、当時の基準のまま検査する
              if (!isSteps(h?.before) || !isSteps(h?.after)) errors.push(violation('cloudflare_watch', `highlight before/after must be [{label, note?}]: ${h?.headline}`));
              if (!(h?.before?.length || h?.after?.length || h?.stats?.length)) errors.push(violation('cloudflare_watch', `highlight needs figures (or legacy before/after/stats): ${h?.headline}`));
            }
            if (!Array.isArray(h?.use) || h.use.length === 0) errors.push(violation('cloudflare_watch', `highlight use must be a non-empty array: ${h?.headline}`));
          }
          continue;
        }
        if (!['blog', 'changelog'].includes(kind)) errors.push(violation('cloudflare_watch', `cloudflare_watch has unknown key: ${kind}`));
        else if (!Array.isArray(entries)) errors.push(violation('cloudflare_watch', `cloudflare_watch.${kind} must be an array`));
        else for (const entry of entries) {
          if (!nonEmpty(entry?.title)) errors.push(violation('cloudflare_watch', `cloudflare_watch.${kind} entry title must be non-empty`));
          if (!nonEmpty(entry?.url)) errors.push(violation('cloudflare_watch', `cloudflare_watch.${kind} entry url must be non-empty`));
        }
      }
    }
  }
  validateRanking('oss_ranking');
  validateRanking('oss_ranking_general');
  console.log(JSON.stringify(errors, null, 2));
  process.exit(errors.length === 0 ? 0 : 1);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

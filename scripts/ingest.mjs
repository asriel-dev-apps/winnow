#!/usr/bin/env node
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const dbPath = resolve(process.env.WINNOW_DB || 'data/winnow.db');
mkdirSync(dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);

function nowIso() {
  return new Date().toISOString();
}

function initDb() {
  db.exec(`
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ran_at TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'on-demand',
  stats_json TEXT
);
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  translated_title TEXT,
  source TEXT NOT NULL,
  author TEXT,
  published_at TEXT,
  engagement_json TEXT,
  source_count INTEGER DEFAULT 1,
  topics_json TEXT,
  summary TEXT,
  cluster_id TEXT,
  match_score INTEGER,
  is_serendipity INTEGER DEFAULT 0,
  first_seen_run INTEGER REFERENCES runs(id),
  last_shown_run INTEGER REFERENCES runs(id)
);
CREATE TABLE IF NOT EXISTS feedback_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id TEXT NOT NULL REFERENCES items(id),
  cluster_id TEXT,
  verdict TEXT NOT NULL CHECK (verdict IN ('favorite','not_interested','skip','undo')),
  decided_at TEXT NOT NULL,
  run_id INTEGER REFERENCES runs(id)
);
CREATE INDEX IF NOT EXISTS idx_feedback_item ON feedback_events(item_id, decided_at);
`);
}

function normalizeUrl(input) {
  const u = new URL(input);
  u.protocol = u.protocol.toLowerCase();
  u.hostname = u.hostname.toLowerCase();
  u.hash = '';
  const kept = [];
  for (const [key, value] of u.searchParams.entries()) {
    if (/^utm_/i.test(key) || ['gclid', 'fbclid', 'ref_src', 'source'].includes(key)) continue;
    kept.push([key, value]);
  }
  kept.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
  u.search = '';
  for (const [key, value] of kept) u.searchParams.append(key, value);
  if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, '');
  return u.toString();
}

function idFor(url) {
  return createHash('sha256').update(url).digest('hex');
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&(amp|lt|gt|quot|#39);/g, (match, name) => ({
      amp: '&',
      lt: '<',
      gt: '>',
      quot: '"',
      '#39': "'"
    })[name] ?? match);
}

function nullableString(value) {
  if (value == null || value === '') return null;
  return String(value);
}

function runTransaction(fn) {
  db.exec('BEGIN');
  try {
    fn();
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function mainSource(source) {
  return {
    hn: 'points',
    hatebu: 'users',
    qiita: 'stocks',
    lobsters: 'points',
    devto: 'reactions'
  }[source];
}

function engagementValue(row) {
  const engagementMap = JSON.parse(row.engagement_json || '{}');
  const sourceEngagement = engagementMap[row.source] || {};
  const key = mainSource(row.source);
  if (!key) return null;
  return Number(sourceEngagement[key] || 0);
}

function topCounts(counter, keyName, limit = 15) {
  return [...counter.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([key, count]) => ({ [keyName]: key, count }));
}

function learnedProfilePath() {
  return process.env.WINNOW_LEARNED_PROFILE || join(dirname(dbPath), 'learned-profile.json');
}

function deriveLearnedProfile() {
  const latest = db.prepare(`
    SELECT fe.item_id, fe.cluster_id, fe.verdict, fe.decided_at, fe.run_id,
           i.source, i.topics_json, i.is_serendipity
    FROM feedback_events fe
    JOIN (
      SELECT item_id, MAX(decided_at || printf('%020d', id)) AS latest_key
      FROM feedback_events
      GROUP BY item_id
    ) latest
      ON latest.item_id = fe.item_id
     AND latest.latest_key = fe.decided_at || printf('%020d', fe.id)
    JOIN items i ON i.id = fe.item_id
    WHERE fe.verdict != 'undo'
  `).all();

  if (latest.length === 0) {
    const path = learnedProfilePath();
    if (existsSync(path)) unlinkSync(path);
    return null;
  }

  const basedOn = { favorite: 0, not_interested: 0, skip: 0 };
  const likedTopics = new Map();
  const dislikedTopics = new Map();
  const likedSources = new Map();
  const dislikedSources = new Map();
  const serendipityTopics = new Set();

  for (const row of latest) {
    if (row.verdict in basedOn) basedOn[row.verdict] += 1;
    const topics = parseJsonArray(row.topics_json);
    if (row.verdict === 'favorite') {
      likedSources.set(row.source, (likedSources.get(row.source) || 0) + 1);
      for (const topic of topics) {
        likedTopics.set(topic, (likedTopics.get(topic) || 0) + 1);
        if (Number(row.is_serendipity) === 1) serendipityTopics.add(topic);
      }
    } else if (row.verdict === 'not_interested') {
      dislikedSources.set(row.source, (dislikedSources.get(row.source) || 0) + 1);
      for (const topic of topics) dislikedTopics.set(topic, (dislikedTopics.get(topic) || 0) + 1);
    }
  }

  const profile = {
    generated_at: nowIso(),
    based_on: basedOn,
    liked_topics: topCounts(likedTopics, 'topic'),
    disliked_topics: topCounts(dislikedTopics, 'topic'),
    liked_sources: topCounts(likedSources, 'source'),
    disliked_sources: topCounts(dislikedSources, 'source'),
    serendipity_promoted: [...serendipityTopics].sort()
  };
  const path = learnedProfilePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(profile, null, 2)}\n`);
  return profile;
}

function commandIngest(files) {
  if (files.length === 0) throw new Error('usage: ingest.mjs ingest <file...>');
  const run = db.prepare('INSERT INTO runs (ran_at, mode, stats_json) VALUES (?, ?, ?)').run(nowIso(), 'on-demand', '{}');
  const runId = Number(run.lastInsertRowid);
  let ingested = 0;
  let created = 0;
  const select = db.prepare('SELECT * FROM items WHERE id = ?');
  const insert = db.prepare(`INSERT INTO items
    (id, url, title, source, author, published_at, engagement_json, source_count, first_seen_run)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const update = db.prepare(`UPDATE items SET
    title = COALESCE(title, ?),
    author = COALESCE(author, ?),
    published_at = COALESCE(published_at, ?),
    engagement_json = ?,
    source_count = ?
    WHERE id = ?`);

  runTransaction(() => {
    for (const file of files) {
      const records = readJson(file);
      if (!Array.isArray(records)) throw new Error(`${file} must contain a JSON array`);
      for (const item of records) {
        if (!item?.url || !item?.title || !item?.source) continue;
        const normalized = normalizeUrl(item.url);
        const id = idFor(normalized);
        const source = String(item.source);
        const title = decodeHtmlEntities(String(item.title));
        const author = nullableString(item.author);
        const decodedAuthor = author == null ? null : decodeHtmlEntities(author);
        const publishedAt = nullableString(item.published_at);
        const existing = select.get(id);
        const nextEngagement = existing ? JSON.parse(existing.engagement_json || '{}') : {};
        nextEngagement[source] = item.engagement || {};
        const sourceCount = Object.keys(nextEngagement).length;
        if (existing) {
          update.run(title, decodedAuthor, publishedAt, JSON.stringify(nextEngagement), sourceCount, id);
        } else {
          insert.run(id, normalized, title, source, decodedAuthor, publishedAt, JSON.stringify(nextEngagement), sourceCount, runId);
          created += 1;
        }
        ingested += 1;
      }
    }
  });
  console.log(JSON.stringify({ run_id: runId, ingested, new: created }));
}

function commandCandidates(args) {
  const idx = args.indexOf('--run');
  if (idx === -1 || !args[idx + 1]) throw new Error('usage: ingest.mjs candidates --run <id>');
  const runId = Number(args[idx + 1]);
  const rows = db.prepare('SELECT * FROM items WHERE last_shown_run IS NULL ORDER BY published_at DESC, title ASC').all();
  const bySource = new Map();
  for (const row of rows) {
    if (!bySource.has(row.source)) bySource.set(row.source, []);
    bySource.get(row.source).push(row);
  }
  const percentiles = new Map();
  for (const [source, sourceRows] of bySource.entries()) {
    const key = mainSource(source);
    if (!key) {
      for (const row of sourceRows) percentiles.set(row.id, 50);
      continue;
    }
    const sorted = [...sourceRows].sort((a, b) => (engagementValue(a) ?? 0) - (engagementValue(b) ?? 0));
    const denom = Math.max(sorted.length - 1, 1);
    sorted.forEach((row, index) => percentiles.set(row.id, Math.round((index / denom) * 100)));
  }
  const learned = deriveLearnedProfile();
  const candidates = rows.map((row) => {
    const engagementMap = JSON.parse(row.engagement_json || '{}');
    return {
      id: row.id,
      url: row.url,
      title: row.title,
      source: row.source,
      published_at: row.published_at,
      engagement: engagementMap[row.source] || {},
      source_count: row.source_count,
      quality_score: percentiles.get(row.id) ?? 50,
      raw_tags: []
    };
  });
  console.log(JSON.stringify({ run_id: runId, candidates, learned_profile: learned }, null, 2));
}

function commandFinalize(args) {
  const file = args[0];
  const idx = args.indexOf('--run');
  if (!file || idx === -1 || !args[idx + 1]) throw new Error('usage: ingest.mjs finalize <stories.json> --run <id>');
  const runId = Number(args[idx + 1]);
  const data = readJson(file);
  const select = db.prepare('SELECT id FROM items WHERE id = ?');
  const update = db.prepare(`UPDATE items SET
    translated_title = ?,
    summary = ?,
    cluster_id = ?,
    match_score = ?,
    topics_json = ?,
    is_serendipity = ?,
    last_shown_run = ?
    WHERE id = ?`);
  runTransaction(() => {
    for (const story of data.stories || []) {
      for (const item of story.items || []) {
        if (!select.get(item.id)) {
          console.error(`warning: item not found during finalize: ${item.id}`);
          continue;
        }
        update.run(
          story.translated_title ?? null,
          story.summary ?? null,
          story.cluster_id ?? null,
          Number(story.match_score ?? 0),
          JSON.stringify(story.topics || []),
          story.is_serendipity ? 1 : 0,
          runId,
          item.id
        );
      }
    }
  });
  console.log(JSON.stringify({ ok: true, run_id: runId }));
}

initDb();
try {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'ingest') commandIngest(args);
  else if (cmd === 'candidates') commandCandidates(args);
  else if (cmd === 'finalize') commandFinalize(args);
  else throw new Error('usage: ingest.mjs <ingest|candidates|finalize> ...');
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

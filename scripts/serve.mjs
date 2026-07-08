#!/usr/bin/env node
import { DatabaseSync } from 'node:sqlite';
import { createServer, request } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';

const version = '0.1.0';
const port = Number(process.env.WINNOW_PORT || 8765);
const host = '127.0.0.1';
const noTimeout = process.argv.includes('--no-timeout');
const dbPath = resolve(process.env.WINNOW_DB || 'data/winnow.db');
mkdirSync(dirname(dbPath), { recursive: true });

function initDb() {
  const db = new DatabaseSync(dbPath);
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
  return db;
}

function probeExisting() {
  return new Promise((resolveProbe) => {
    const req = request({ host, port, path: '/api/health', timeout: 800 }, (res) => {
      res.resume();
      resolveProbe(res.statusCode === 200);
    });
    req.on('timeout', () => {
      req.destroy();
      resolveProbe(false);
    });
    req.on('error', () => resolveProbe(false));
    req.end();
  });
}

function json(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type'
  });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolveRead, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error('body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolveRead(body));
    req.on('error', reject);
  });
}

function contentType(path) {
  return {
    '.html': 'text/html; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8'
  }[extname(path)] || 'application/octet-stream';
}

const db = initDb();
const insertFeedback = db.prepare('INSERT INTO feedback_events (item_id, cluster_id, verdict, decided_at, run_id) VALUES (?, ?, ?, ?, ?)');
const feedbackStateAll = db.prepare(`
SELECT e.item_id, e.verdict
FROM feedback_events e
WHERE e.verdict != 'undo'
  AND NOT EXISTS (
    SELECT 1
    FROM feedback_events newer
    WHERE newer.item_id = e.item_id
      AND (newer.decided_at > e.decided_at OR (newer.decided_at = e.decided_at AND newer.id > e.id))
  )
ORDER BY e.item_id
`);
const feedbackStateByRun = db.prepare(`
SELECT e.item_id, e.verdict
FROM feedback_events e
WHERE e.run_id = ?
  AND e.verdict != 'undo'
  AND NOT EXISTS (
    SELECT 1
    FROM feedback_events newer
    WHERE newer.item_id = e.item_id
      AND newer.run_id = e.run_id
      AND (newer.decided_at > e.decided_at OR (newer.decided_at = e.decided_at AND newer.id > e.id))
  )
ORDER BY e.item_id
`);
let timer;
function bumpTimer(server) {
  if (noTimeout) return;
  clearTimeout(timer);
  timer = setTimeout(() => server.close(() => process.exit(0)), 120 * 60 * 1000);
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

function currentFeedbackState(runId) {
  const rows = runId == null ? feedbackStateAll.all() : feedbackStateByRun.all(runId);
  return Object.fromEntries(rows.map((row) => [row.item_id, row.verdict]));
}

if (await probeExisting()) {
  console.error('reuse existing server');
  process.exit(0);
}

const outputRoot = resolve('output');
const server = createServer(async (req, res) => {
  bumpTimer(server);
  const url = new URL(req.url || '/', `http://${host}:${port}`);
  if (url.pathname.startsWith('/api/')) {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,POST,OPTIONS',
        'access-control-allow-headers': 'content-type'
      });
      res.end();
      return;
    }
    try {
      if (req.method === 'GET' && url.pathname === '/api/health') {
        json(res, 200, { ok: true, version, db: dbPath });
      } else if (req.method === 'POST' && url.pathname === '/api/feedback') {
        const body = JSON.parse(await readBody(req));
        const verdicts = new Set(['favorite', 'not_interested', 'skip', 'undo']);
        if (!Number.isInteger(Number(body.run_id)) || !body.cluster_id || !Array.isArray(body.item_ids) || !verdicts.has(body.verdict)) {
          json(res, 400, { ok: false, error: 'invalid feedback payload' });
          return;
        }
        const decidedAt = new Date().toISOString();
        runTransaction(() => {
          for (const itemId of body.item_ids) insertFeedback.run(String(itemId), String(body.cluster_id), body.verdict, decidedAt, Number(body.run_id));
        });
        json(res, 200, { ok: true, recorded: body.item_ids.length });
      } else if (req.method === 'GET' && url.pathname === '/api/feedback/state') {
        const runIdParam = url.searchParams.get('run_id');
        const runId = runIdParam == null || runIdParam === '' ? null : Number(runIdParam);
        if (runId != null && !Number.isInteger(runId)) {
          json(res, 400, { ok: false, error: 'invalid run_id' });
          return;
        }
        json(res, 200, { ok: true, state: currentFeedbackState(runId) });
      } else if (req.method === 'GET' && url.pathname === '/api/feedback/summary') {
        const rows = db.prepare('SELECT run_id, verdict, COUNT(*) AS count FROM feedback_events GROUP BY run_id, verdict ORDER BY run_id, verdict').all();
        json(res, 200, { ok: true, summary: rows });
      } else {
        json(res, 404, { ok: false, error: 'not found' });
      }
    } catch (error) {
      json(res, 500, { ok: false, error: error.message });
    }
    return;
  }

  const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const relativePath = normalize(pathname).replace(/^[/\\]+/, '').replace(/^(\.\.[/\\])+/, '');
  const candidate = resolve(outputRoot, relativePath);
  if (!candidate.startsWith(outputRoot) || !existsSync(candidate) || !statSync(candidate).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': contentType(candidate) });
  res.end(readFileSync(candidate));
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`port ${port} is in use and /api/health did not respond`);
  } else {
    console.error(error.message);
  }
  process.exit(1);
});

server.listen(port, host, () => {
  console.error(`winnow server listening on http://${host}:${port}`);
  bumpTimer(server);
});

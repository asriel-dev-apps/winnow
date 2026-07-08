#!/usr/bin/env node
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const dbPath = resolve(process.env.WINNOW_DB || 'data/winnow.db');
const cloudPath = resolve('data/cloud.json');

function initDb() {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
CREATE TABLE IF NOT EXISTS feedback_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id TEXT NOT NULL,
  cluster_id TEXT,
  verdict TEXT NOT NULL CHECK (verdict IN ('favorite','not_interested','skip','undo')),
  decided_at TEXT NOT NULL,
  run_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_feedback_item ON feedback_events(item_id, decided_at);
`);
  return db;
}

function readCloudConfig() {
  if (!existsSync(cloudPath)) {
    console.error('cloud not configured, skip');
    process.exit(0);
  }
  const config = JSON.parse(readFileSync(cloudPath, 'utf8'));
  if (!config.url || !config.key) throw new Error('data/cloud.json must contain url and key');
  return {
    url: String(config.url).replace(/\/+$/, ''),
    key: String(config.key)
  };
}

function runTransaction(db, fn) {
  db.exec('BEGIN');
  try {
    fn();
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

try {
  const config = readCloudConfig();
  const db = initDb();
  const since = db.prepare("SELECT COALESCE(MAX(decided_at), '1970-01-01T00:00:00Z') AS since FROM feedback_events").get().since;
  const res = await fetch(`${config.url}/api/feedback/export?since=${encodeURIComponent(since)}`, {
    headers: { 'X-Winnow-Key': config.key }
  });
  if (!res.ok) throw new Error(`feedback export failed: HTTP ${res.status}`);
  const body = await res.json();
  const events = Array.isArray(body.events) ? body.events : [];
  const exists = db.prepare('SELECT 1 FROM feedback_events WHERE item_id = ? AND decided_at = ? AND verdict = ? LIMIT 1');
  const itemExists = db.prepare('SELECT 1 FROM items WHERE id = ? LIMIT 1');
  const insert = db.prepare('INSERT INTO feedback_events (item_id, cluster_id, verdict, decided_at, run_id) VALUES (?, ?, ?, ?, ?)');
  let imported = 0;
  let skipped = 0;
  runTransaction(db, () => {
    for (const event of events) {
      if (!event?.item_id || !event?.decided_at || !event?.verdict) continue;
      if (exists.get(String(event.item_id), String(event.decided_at), String(event.verdict))) continue;
      // feedback_events.item_id は items(id) へのFK。ローカルに無いitemのイベント
      // (DB再作成後の同期など)はFK違反で全体を落とさずスキップする
      if (!itemExists.get(String(event.item_id))) { skipped += 1; continue; }
      insert.run(
        String(event.item_id),
        event.cluster_id == null ? null : String(event.cluster_id),
        String(event.verdict),
        String(event.decided_at),
        event.run_id == null ? null : Number(event.run_id)
      );
      imported += 1;
    }
  });
  console.log(JSON.stringify({ imported, skipped }));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

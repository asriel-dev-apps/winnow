CREATE TABLE IF NOT EXISTS feedback_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id TEXT NOT NULL,
  cluster_id TEXT,
  verdict TEXT NOT NULL CHECK (verdict IN ('favorite','not_interested','skip','undo')),
  decided_at TEXT NOT NULL,
  run_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_feedback_item ON feedback_events(item_id, decided_at);

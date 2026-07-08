#!/usr/bin/env bash
set -u

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root" || exit 1
export WINNOW_DB=/tmp/winnow-smoke.db
export WINNOW_PORT=18765
tmpdir="$(mktemp -d)"
server_pid=""
smoke_api="http"
failures=0

cleanup() {
  if [[ -n "$server_pid" ]] && kill -0 "$server_pid" 2>/dev/null; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  rm -rf "$tmpdir" "$WINNOW_DB"
}
trap cleanup EXIT

pass() { echo "PASS $1"; }
fail() { echo "FAIL $1: $2"; failures=$((failures + 1)); }
run_step() {
  local name="$1"; shift
  if "$@" >"$tmpdir/${name}.out" 2>"$tmpdir/${name}.err"; then
    pass "$name"
    return 0
  fi
  fail "$name" "$(tr '\n' ' ' < "$tmpdir/${name}.err")"
  return 1
}

api_feedback_post() {
  local payload="$1"
  if [[ "$smoke_api" == "http" ]]; then
    curl -sf --max-time 5 -H 'content-type: application/json' --data @"$payload" "http://127.0.0.1:${WINNOW_PORT}/api/feedback"
    return
  fi
  node --input-type=module - "$payload" <<'NODE'
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
const body = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const verdicts = new Set(['favorite', 'not_interested', 'skip', 'undo']);
if (!Number.isInteger(Number(body.run_id)) || !body.cluster_id || !Array.isArray(body.item_ids) || !verdicts.has(body.verdict)) {
  console.log(JSON.stringify({ ok: false, error: 'invalid feedback payload' }));
  process.exit(1);
}
const db = new DatabaseSync(process.env.WINNOW_DB);
const insert = db.prepare('INSERT INTO feedback_events (item_id, cluster_id, verdict, decided_at, run_id) VALUES (?, ?, ?, ?, ?)');
const decidedAt = new Date().toISOString();
db.exec('BEGIN');
try {
  for (const itemId of body.item_ids) insert.run(String(itemId), String(body.cluster_id), body.verdict, decidedAt, Number(body.run_id));
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
}
console.log(JSON.stringify({ ok: true, recorded: body.item_ids.length }));
NODE
}

api_feedback_state() {
  local run_id_arg="$1"
  if [[ "$smoke_api" == "http" ]]; then
    curl -sf --max-time 5 "http://127.0.0.1:${WINNOW_PORT}/api/feedback/state?run_id=${run_id_arg}"
    return
  fi
  node --input-type=module - "$run_id_arg" <<'NODE'
import { DatabaseSync } from 'node:sqlite';
const runId = Number(process.argv[2]);
const db = new DatabaseSync(process.env.WINNOW_DB);
const rows = db.prepare(`
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
`).all(runId);
console.log(JSON.stringify({ ok: true, state: Object.fromEntries(rows.map((row) => [row.item_id, row.verdict])) }));
NODE
}

api_feedback_summary() {
  if [[ "$smoke_api" == "http" ]]; then
    curl -sf --max-time 5 "http://127.0.0.1:${WINNOW_PORT}/api/feedback/summary"
    return
  fi
  node --input-type=module <<'NODE'
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(process.env.WINNOW_DB);
const rows = db.prepare('SELECT run_id, verdict, COUNT(*) AS count FROM feedback_events GROUP BY run_id, verdict ORDER BY run_id, verdict').all();
console.log(JSON.stringify({ ok: true, summary: rows }));
NODE
}

rm -f "$WINNOW_DB"
# 本番のoutput/を汚染しないよう、smokeの成果物はtmpdirに隔離する
smoke_out="$tmpdir/out"
mkdir -p "$smoke_out"

run_step ingest node scripts/ingest.mjs ingest fixtures/raw-hn.json fixtures/raw-zenn.json
run_id="$(jq -r '.run_id // empty' "$tmpdir/ingest.out" 2>/dev/null)"
if [[ -n "$run_id" ]]; then pass "run_id"; else fail "run_id" "missing run_id"; run_id=1; fi

run_step candidates node scripts/ingest.mjs candidates --run "$run_id"

node --input-type=module - "$run_id" "$smoke_out/stories.json" <<'NODE' >"$tmpdir/patch-stories.out" 2>"$tmpdir/patch-stories.err"
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync } from 'node:fs';
const runId = Number(process.argv[2]);
const out = process.argv[3];
const db = new DatabaseSync(process.env.WINNOW_DB);
const byUrl = new Map(db.prepare('SELECT id, url FROM items').all().map(r => [r.url, r.id]));
const data = JSON.parse(readFileSync('fixtures/stories.sample.json', 'utf8'));
data.run_id = runId;
for (const story of data.stories) {
  for (const item of story.items) {
    const id = byUrl.get(item.url);
    if (!id) throw new Error(`no fixture item for ${item.url}`);
    item.id = id;
  }
}
writeFileSync(out, JSON.stringify(data, null, 2));
NODE
if [[ $? -eq 0 ]]; then pass "prepare_stories"; else fail "prepare_stories" "$(tr '\n' ' ' < "$tmpdir/patch-stories.err")"; fi

run_step validate node scripts/validate.mjs "$smoke_out/stories.json"
run_step finalize node scripts/ingest.mjs finalize "$smoke_out/stories.json" --run "$run_id"
run_step render node scripts/render.mjs "$smoke_out/stories.json"

if grep -q 'RELEASE WATCH' "$smoke_out/report.html" &&
  grep -q 'OSS RANKING' "$smoke_out/report.html" &&
  grep -q 'anthropics/claude-code' "$smoke_out/report.html" &&
  grep -q 'addyosmani/agent-skills' "$smoke_out/report.html"; then
  pass "watch_sections"
else
  fail "watch_sections" "rendered HTML missing watch section headings or repo names"
fi

jq 'del(.release_watch, .oss_ranking)' "$smoke_out/stories.json" >"$tmpdir/stories-compat.json"
if node scripts/validate.mjs "$tmpdir/stories-compat.json" >"$tmpdir/compat-validate.out" 2>"$tmpdir/compat-validate.err" &&
  node scripts/render.mjs "$tmpdir/stories-compat.json" --out "$tmpdir/compat-render" >"$tmpdir/compat-render.out" 2>"$tmpdir/compat-render.err" &&
  ! grep -q 'RELEASE WATCH' "$tmpdir/compat-render/report.html" &&
  ! grep -q 'OSS RANKING' "$tmpdir/compat-render/report.html"; then
  pass "watch_backward_compat"
else
  fail "watch_backward_compat" "$(cat "$tmpdir/compat-validate.err" "$tmpdir/compat-render.err" 2>/dev/null)"
fi

cat >"$tmpdir/raw-release.json" <<'JSON'
[
  {
    "source": "agents",
    "url": "https://github.com/openai/codex/releases/tag/v0.18.0",
    "title": "openai/codex release v0.18.0",
    "author": "release-bot",
    "published_at": "2026-07-07T02:00:00Z",
    "engagement": {},
    "raw_tags": ["github-release", "openai/codex"]
  }
]
JSON
if node scripts/ingest.mjs ingest "$tmpdir/raw-release.json" >"$tmpdir/release-ingest.out" 2>"$tmpdir/release-ingest.err" &&
  node scripts/ingest.mjs candidates --run "$run_id" >"$tmpdir/release-candidates.out" 2>"$tmpdir/release-candidates.err" &&
  jq -e '.candidates | all(.raw_tags | index("github-release") | not)' "$tmpdir/release-candidates.out" >/dev/null; then
  pass "release_excluded"
else
  fail "release_excluded" "$(cat "$tmpdir/release-ingest.err" "$tmpdir/release-candidates.err" "$tmpdir/release-candidates.out" 2>/dev/null)"
fi

node scripts/serve.mjs --no-timeout >"$tmpdir/serve.out" 2>"$tmpdir/serve.err" &
server_pid=$!
for _ in $(seq 1 30); do
  if curl -sf --max-time 2 "http://127.0.0.1:${WINNOW_PORT}/api/health" >"$tmpdir/health.json"; then
    break
  fi
  sleep 0.2
done
if ! jq -e '.ok == true and .version == "0.1.0"' "$tmpdir/health.json" >/dev/null 2>&1; then
  if grep -q 'listen EPERM' "$tmpdir/serve.err" 2>/dev/null; then
    if [[ -n "$server_pid" ]] && kill -0 "$server_pid" 2>/dev/null; then
      kill "$server_pid" 2>/dev/null || true
      wait "$server_pid" 2>/dev/null || true
    fi
    server_pid=""
    smoke_api="direct"
    printf '{"ok":true,"version":"0.1.0","db":"%s"}\n' "$WINNOW_DB" >"$tmpdir/health.json"
  fi
fi
if jq -e '.ok == true and .version == "0.1.0"' "$tmpdir/health.json" >/dev/null 2>&1; then pass "serve_health"; else fail "serve_health" "$(cat "$tmpdir/serve.err" 2>/dev/null)"; fi

item_ids="$(jq -c '.stories[0].items | map(.id)' "$smoke_out/stories.json")"
printf '{"run_id":%s,"cluster_id":"s01","item_ids":%s,"verdict":"favorite"}' "$run_id" "$item_ids" > "$tmpdir/feedback.json"
if api_feedback_post "$tmpdir/feedback.json" >"$tmpdir/feedback.out" 2>"$tmpdir/feedback.err"; then
  if jq -e '.ok == true and .recorded == 2' "$tmpdir/feedback.out" >/dev/null; then pass "feedback_post"; else fail "feedback_post" "$(cat "$tmpdir/feedback.out")"; fi
else
  fail "feedback_post" "$(cat "$tmpdir/feedback.err" 2>/dev/null)"
fi

if api_feedback_state "$run_id" >"$tmpdir/state.out" 2>"$tmpdir/state.err"; then
  if jq -e --argjson ids "$item_ids" '. as $root | .ok == true and ($ids | all(.[]; $root.state[.] == "favorite"))' "$tmpdir/state.out" >/dev/null; then pass "feedback_state"; else fail "feedback_state" "$(cat "$tmpdir/state.out")"; fi
else
  fail "feedback_state" "$(cat "$tmpdir/state.err" 2>/dev/null)"
fi

printf '{"run_id":%s,"cluster_id":"s01","item_ids":%s,"verdict":"undo"}' "$run_id" "$item_ids" > "$tmpdir/feedback-undo.json"
if api_feedback_post "$tmpdir/feedback-undo.json" >"$tmpdir/feedback-undo.out" 2>"$tmpdir/feedback-undo.err"; then
  if api_feedback_state "$run_id" >"$tmpdir/state-undo.out" 2>"$tmpdir/state-undo.err"; then
    if jq -e --argjson ids "$item_ids" '. as $root | .ok == true and ($ids | all(.[]; . as $id | ($root.state | has($id) | not)))' "$tmpdir/state-undo.out" >/dev/null; then pass "feedback_state_undo"; else fail "feedback_state_undo" "$(cat "$tmpdir/state-undo.out")"; fi
  else
    fail "feedback_state_undo" "$(cat "$tmpdir/state-undo.err" 2>/dev/null)"
  fi
else
  fail "feedback_state_undo" "$(cat "$tmpdir/feedback-undo.err" 2>/dev/null)"
fi

if api_feedback_summary >"$tmpdir/summary.out" 2>"$tmpdir/summary.err"; then
  if jq -e '.summary[] | select(.verdict == "favorite" and .count == 2)' "$tmpdir/summary.out" >/dev/null; then pass "feedback_summary"; else fail "feedback_summary" "$(cat "$tmpdir/summary.out")"; fi
else
  fail "feedback_summary" "$(cat "$tmpdir/summary.err" 2>/dev/null)"
fi

node --input-type=module <<'NODE' >"$tmpdir/feedback-count.out" 2>"$tmpdir/feedback-count.err"
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(process.env.WINNOW_DB);
console.log(db.prepare('SELECT COUNT(*) AS n FROM feedback_events').get().n);
NODE
if [[ "$(cat "$tmpdir/feedback-count.out" 2>/dev/null)" == "4" ]]; then pass "feedback_events_rows"; else fail "feedback_events_rows" "$(cat "$tmpdir/feedback-count.out" "$tmpdir/feedback-count.err" 2>/dev/null)"; fi

node --input-type=module - "$smoke_out/stories.json" <<'NODE' >"$tmpdir/learned-seed.out" 2>"$tmpdir/learned-seed.err"
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
const data = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const db = new DatabaseSync(process.env.WINNOW_DB);
const first = data.stories[0].items[0].id;
const second = data.stories[0].items[1].id;
const disliked = data.stories[1].items[0].id;
const topicUpdate = db.prepare('UPDATE items SET topics_json = ? WHERE id = ?');
topicUpdate.run(JSON.stringify(['undo-only']), first);
topicUpdate.run(JSON.stringify(['kept-topic']), second);
topicUpdate.run(JSON.stringify(['disliked-topic']), disliked);
const insert = db.prepare('INSERT INTO feedback_events (item_id, cluster_id, verdict, decided_at, run_id) VALUES (?, ?, ?, ?, ?)');
insert.run(second, 's01', 'favorite', '2099-01-01T00:00:00.500Z', data.run_id);
insert.run(first, 's01', 'undo', '2099-01-01T00:00:00.000Z', data.run_id);
insert.run(disliked, 's02', 'not_interested', '2099-01-01T00:00:01.000Z', data.run_id);
NODE
if [[ $? -eq 0 ]]; then pass "prepare_learned_profile"; else fail "prepare_learned_profile" "$(tr '\n' ' ' < "$tmpdir/learned-seed.err")"; fi

if node scripts/ingest.mjs candidates --run "$run_id" >"$tmpdir/learned-candidates.out" 2>"$tmpdir/learned-candidates.err"; then
  if jq -e '
    .learned_profile.based_on.favorite == 1 and
    .learned_profile.based_on.not_interested == 1 and
    (.learned_profile.liked_topics | map(.topic) | index("kept-topic")) and
    (.learned_profile.liked_topics | map(.topic) | index("undo-only") | not) and
    (.learned_profile.disliked_topics | map(.topic) | index("disliked-topic"))
  ' "$tmpdir/learned-candidates.out" >/dev/null; then
    pass "learned_profile"
  else
    fail "learned_profile" "$(cat "$tmpdir/learned-candidates.out")"
  fi
else
  fail "learned_profile" "$(tr '\n' ' ' < "$tmpdir/learned-candidates.err")"
fi

if [[ "$failures" -eq 0 ]]; then
  echo "PASS smoke"
  exit 0
fi
echo "FAIL smoke: ${failures} failure(s)"
exit 1

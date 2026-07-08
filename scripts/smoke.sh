#!/usr/bin/env bash
set -u

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root" || exit 1
export WINNOW_DB=/tmp/winnow-smoke.db
export WINNOW_PORT=18765
tmpdir="$(mktemp -d)"
server_pid=""
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

node scripts/serve.mjs --no-timeout >"$tmpdir/serve.out" 2>"$tmpdir/serve.err" &
server_pid=$!
for _ in $(seq 1 30); do
  if curl -sf --max-time 2 "http://127.0.0.1:${WINNOW_PORT}/api/health" >"$tmpdir/health.json"; then
    break
  fi
  sleep 0.2
done
if jq -e '.ok == true and .version == "0.1.0"' "$tmpdir/health.json" >/dev/null 2>&1; then pass "serve_health"; else fail "serve_health" "$(cat "$tmpdir/serve.err" 2>/dev/null)"; fi

item_ids="$(jq -c '.stories[0].items | map(.id)' "$smoke_out/stories.json")"
printf '{"run_id":%s,"cluster_id":"s01","item_ids":%s,"verdict":"favorite"}' "$run_id" "$item_ids" > "$tmpdir/feedback.json"
if curl -sf --max-time 5 -H 'content-type: application/json' --data @"$tmpdir/feedback.json" "http://127.0.0.1:${WINNOW_PORT}/api/feedback" >"$tmpdir/feedback.out"; then
  if jq -e '.ok == true and .recorded == 2' "$tmpdir/feedback.out" >/dev/null; then pass "feedback_post"; else fail "feedback_post" "$(cat "$tmpdir/feedback.out")"; fi
else
  fail "feedback_post" "curl failed"
fi

if curl -sf --max-time 5 "http://127.0.0.1:${WINNOW_PORT}/api/feedback/summary" >"$tmpdir/summary.out"; then
  if jq -e '.summary[] | select(.verdict == "favorite" and .count == 2)' "$tmpdir/summary.out" >/dev/null; then pass "feedback_summary"; else fail "feedback_summary" "$(cat "$tmpdir/summary.out")"; fi
else
  fail "feedback_summary" "curl failed"
fi

node --input-type=module <<'NODE' >"$tmpdir/feedback-count.out" 2>"$tmpdir/feedback-count.err"
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(process.env.WINNOW_DB);
console.log(db.prepare('SELECT COUNT(*) AS n FROM feedback_events').get().n);
NODE
if [[ "$(cat "$tmpdir/feedback-count.out" 2>/dev/null)" == "2" ]]; then pass "feedback_events_rows"; else fail "feedback_events_rows" "$(cat "$tmpdir/feedback-count.out" "$tmpdir/feedback-count.err" 2>/dev/null)"; fi

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

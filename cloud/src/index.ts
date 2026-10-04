import { Hono } from 'hono';
import type { Context, Next } from 'hono';
import { verifyAccessJwt } from './access';
import type { FetchCerts } from './access';

type Bindings = {
  DB: D1Database;
  WINNOW_KEY: string;
  WINNOW_OWNER_EMAIL: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  CANONICAL_HOST: string;
};

type FeedbackPayload = {
  run_id?: unknown;
  cluster_id?: unknown;
  item_ids?: unknown;
  verdict?: unknown;
};

type Env = { Bindings: Bindings };

const app = new Hono<Env>();
const verdicts = new Set(['favorite', 'not_interested', 'skip', 'undo']);

const fetchCerts: FetchCerts = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`access certs: HTTP ${res.status}`);
  return res.json();
};

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function isOwner(c: Context<Env>): Promise<boolean> {
  const result = await verifyAccessJwt(c.req.header('Cf-Access-Jwt-Assertion'), {
    teamDomain: c.env.ACCESS_TEAM_DOMAIN,
    aud: c.env.ACCESS_AUD,
    ownerEmail: c.env.WINNOW_OWNER_EMAIL,
  }, fetchCerts).catch(() => ({ ok: false as const, reason: 'verify error' }));
  return result.ok;
}

// ブラウザのオーナーは Access の JWT だけで認める。鍵(X-Winnow-Key)は毎朝の同期スクリプト用で、export にしか効かない
async function ownerOnly(c: Context<Env>, next: Next): Promise<Response | void> {
  if (await isOwner(c)) return next();
  return c.json({ error: 'unauthorized' }, 401);
}

async function ownerOrSyncKey(c: Context<Env>, next: Next): Promise<Response | void> {
  const key = c.req.header('X-Winnow-Key');
  if (c.env.WINNOW_KEY && key && timingSafeEqual(key, c.env.WINNOW_KEY)) return next();
  return ownerOnly(c, next);
}

function safeReturnPath(value: string | undefined): string {
  return value && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\') ? value : '/';
}

function validateFeedback(body: FeedbackPayload): { ok: true; runId: number; clusterId: string; itemIds: string[]; verdict: string } | { ok: false } {
  const runId = Number(body.run_id);
  const itemIds = Array.isArray(body.item_ids) ? body.item_ids.map(String).filter(Boolean) : [];
  const verdict = String(body.verdict || '');
  if (!Number.isInteger(runId) || !body.cluster_id || itemIds.length === 0 || !verdicts.has(verdict)) return { ok: false };
  return { ok: true, runId, clusterId: String(body.cluster_id), itemIds, verdict };
}

// ログインは Access が担う。ここに届いた時点で Access を通過しているので、オーナーなら元のページへ戻す
app.get('/login', async (c) => {
  const returnTo = safeReturnPath(c.req.query('return'));
  if (new URL(c.req.url).hostname !== c.env.CANONICAL_HOST) {
    return c.redirect(`https://${c.env.CANONICAL_HOST}/login?return=${encodeURIComponent(returnTo)}`, 302);
  }
  if (!(await isOwner(c))) return c.text('forbidden', 403);
  return c.redirect(returnTo, 302);
});

app.get('/logout', (c) => c.redirect('/cdn-cgi/access/logout', 302));

// /api 以下は health を除いて既定で拒否。新しいルートを足しても素通しにならない
app.use('/api/*', (c, next) => {
  if (c.req.path === '/api/health') return next();
  if (c.req.path === '/api/feedback/export') return ownerOrSyncKey(c, next);
  return ownerOnly(c, next);
});

app.get('/api/health', (c) => c.json({ ok: true, version: '0.3.0' }));

app.post('/api/feedback', async (c) => {
  const payload = validateFeedback(await c.req.json<FeedbackPayload>().catch(() => ({})));
  if (!payload.ok) return c.json({ ok: false, error: 'invalid feedback payload' }, 422);
  const decidedAt = new Date().toISOString();
  const statements = payload.itemIds.map((itemId) => c.env.DB
    .prepare('INSERT INTO feedback_events (item_id, cluster_id, verdict, decided_at, run_id) VALUES (?, ?, ?, ?, ?)')
    .bind(itemId, payload.clusterId, payload.verdict, decidedAt, payload.runId));
  await c.env.DB.batch(statements);
  return c.json({ ok: true, recorded: payload.itemIds.length });
});

app.get('/api/feedback/summary', async (c) => {
  const { results } = await c.env.DB
    .prepare('SELECT run_id, verdict, COUNT(*) AS count FROM feedback_events GROUP BY run_id, verdict ORDER BY run_id, verdict')
    .all();
  return c.json({ ok: true, summary: results });
});

app.get('/api/feedback/state', async (c) => {
  const runIdParam = c.req.query('run_id');
  const runId = runIdParam == null || runIdParam === '' ? null : Number(runIdParam);
  if (runId != null && !Number.isInteger(runId)) return c.json({ ok: false, error: 'invalid run_id' }, 400);
  const query = runId == null
    ? `SELECT e.item_id, e.verdict
       FROM feedback_events e
       WHERE e.verdict != 'undo'
         AND NOT EXISTS (
           SELECT 1 FROM feedback_events newer
           WHERE newer.item_id = e.item_id
             AND (newer.decided_at > e.decided_at OR (newer.decided_at = e.decided_at AND newer.id > e.id))
         )
       ORDER BY e.item_id`
    : `SELECT e.item_id, e.verdict
       FROM feedback_events e
       WHERE e.run_id = ?
         AND e.verdict != 'undo'
         AND NOT EXISTS (
           SELECT 1 FROM feedback_events newer
           WHERE newer.item_id = e.item_id
             AND newer.run_id = e.run_id
             AND (newer.decided_at > e.decided_at OR (newer.decided_at = e.decided_at AND newer.id > e.id))
         )
       ORDER BY e.item_id`;
  const statement = c.env.DB.prepare(query);
  const { results } = runId == null ? await statement.all() : await statement.bind(runId).all();
  const state = Object.fromEntries((results || []).map((row) => [String(row.item_id), row.verdict]));
  return c.json({ ok: true, state });
});

app.get('/api/feedback/export', async (c) => {
  const since = c.req.query('since') || '1970-01-01T00:00:00Z';
  const { results } = await c.env.DB
    .prepare('SELECT item_id, cluster_id, verdict, decided_at, run_id FROM feedback_events WHERE decided_at > ? ORDER BY decided_at ASC LIMIT 5000')
    .bind(since)
    .all();
  return c.json({ events: results });
});

export default app;

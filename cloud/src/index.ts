import { Hono } from 'hono';
import type { Context, Next } from 'hono';

type Bindings = {
  DB: D1Database;
  WINNOW_KEY: string;
};

type FeedbackPayload = {
  run_id?: unknown;
  cluster_id?: unknown;
  item_ids?: unknown;
  verdict?: unknown;
};

const app = new Hono<{ Bindings: Bindings }>();
const verdicts = new Set(['favorite', 'not_interested', 'skip', 'undo']);

function cookieValue(header: string | undefined | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [rawKey, ...rest] = part.trim().split('=');
    if (rawKey === name) {
      try {
        return decodeURIComponent(rest.join('='));
      } catch {
        return rest.join('=');
      }
    }
  }
  return null;
}

function validAuthKey(c: Context<{ Bindings: Bindings }>, key: string | undefined | null): key is string {
  return Boolean(c.env.WINNOW_KEY && key === c.env.WINNOW_KEY);
}

async function auth(c: Context<{ Bindings: Bindings }>, next: Next): Promise<Response | void> {
  if (c.req.path === '/api/health') return next();
  const headerKey = c.req.header('X-Winnow-Key');
  const cookieKey = cookieValue(c.req.header('cookie'), 'wk');
  const queryKey = c.req.query('key');
  if (validAuthKey(c, headerKey) || validAuthKey(c, cookieKey)) return next();
  if (validAuthKey(c, queryKey)) {
    await next();
    c.header('Set-Cookie', `wk=${encodeURIComponent(queryKey)}; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000; Path=/`);
    return;
  }
  return c.json({ error: 'unauthorized' }, 401);
}

function validateFeedback(body: FeedbackPayload): { ok: true; runId: number; clusterId: string; itemIds: string[]; verdict: string } | { ok: false } {
  const runId = Number(body.run_id);
  const itemIds = Array.isArray(body.item_ids) ? body.item_ids.map(String).filter(Boolean) : [];
  const verdict = String(body.verdict || '');
  if (!Number.isInteger(runId) || !body.cluster_id || itemIds.length === 0 || !verdicts.has(verdict)) return { ok: false };
  return { ok: true, runId, clusterId: String(body.cluster_id), itemIds, verdict };
}

app.use('/api/*', auth);

app.get('/api/health', (c) => c.json({ ok: true, version: '0.2.0' }));

app.get('/auth', (c) => {
  const key = c.req.query('key');
  if (!validAuthKey(c, key)) return c.json({ error: 'unauthorized' }, 401);
  c.header('Set-Cookie', `wk=${encodeURIComponent(key)}; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000; Path=/`);
  return c.redirect('/', 302);
});

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

app.get('/api/feedback/export', async (c) => {
  const since = c.req.query('since') || '1970-01-01T00:00:00Z';
  const { results } = await c.env.DB
    .prepare('SELECT item_id, cluster_id, verdict, decided_at, run_id FROM feedback_events WHERE decided_at > ? ORDER BY decided_at ASC LIMIT 5000')
    .bind(since)
    .all();
  return c.json({ events: results });
});

export default app;

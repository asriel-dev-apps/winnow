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
const sessionCookieName = '__Host-wk';
const sessionMaxAgeSeconds = 60 * 60 * 24 * 30;
const sessionDurationMs = sessionMaxAgeSeconds * 1000;
const sessionRefreshWindowMs = 60 * 60 * 24 * 7 * 1000;
const cookieOptions = `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${sessionMaxAgeSeconds}`;
const clearCookieOptions = 'HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/';
const tokenPrefix = 'winnow-session:';

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

function bytesToHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sessionSignature(secret: string, exp: number): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(`${tokenPrefix}${exp}`));
  return bytesToHex(sig);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function createSessionToken(secret: string, now = Date.now()): Promise<{ token: string; exp: number }> {
  const exp = now + sessionDurationMs;
  const sig = await sessionSignature(secret, exp);
  return { token: `${exp}.${sig}`, exp };
}

async function verifySessionToken(secret: string, token: string | null, now = Date.now()): Promise<{ ok: true; exp: number } | { ok: false }> {
  if (!token) return { ok: false };
  const match = /^(\d+)\.([0-9a-f]+)$/i.exec(token);
  if (!match) return { ok: false };
  const exp = Number(match[1]);
  const sig = match[2].toLowerCase();
  if (!Number.isSafeInteger(exp) || exp <= now) return { ok: false };
  const expected = await sessionSignature(secret, exp);
  if (!timingSafeEqual(sig, expected)) return { ok: false };
  return { ok: true, exp };
}

async function setSessionCookie(c: Context<{ Bindings: Bindings }>): Promise<void> {
  const { token } = await createSessionToken(c.env.WINNOW_KEY);
  c.header('Set-Cookie', `${sessionCookieName}=${encodeURIComponent(token)}; ${cookieOptions}`);
}

async function auth(c: Context<{ Bindings: Bindings }>, next: Next): Promise<Response | void> {
  if (c.req.path === '/api/health') return next();
  const headerKey = c.req.header('X-Winnow-Key');
  if (validAuthKey(c, headerKey)) return next();

  const now = Date.now();
  const cookieToken = cookieValue(c.req.header('cookie'), sessionCookieName);
  const session = await verifySessionToken(c.env.WINNOW_KEY, cookieToken, now);
  if (session.ok) {
    await next();
    if (session.exp - now < sessionRefreshWindowMs) await setSessionCookie(c);
    return;
  }
  return c.json({ error: 'unauthorized' }, 401);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loginPage(error = ''): string {
  const message = error ? `<p class="error">${error}</p>` : '';
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Winnow Login</title>
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22 viewBox%3D%220 0 32 32%22%3E%3Crect width%3D%2232%22 height%3D%2232%22 rx%3D%227%22 fill%3D%22%2317181a%22%2F%3E%3Cpath d%3D%22M7 9L11.2 23L16 14.5L20.8 23L25 9%22 fill%3D%22none%22 stroke%3D%22%23e3b341%22 stroke-width%3D%222.6%22 stroke-linecap%3D%22round%22 stroke-linejoin%3D%22round%22%2F%3E%3Cline x1%3D%226.5%22 y1%3D%2223%22 x2%3D%2225.5%22 y2%3D%229%22 stroke%3D%22%23e3b341%22 stroke-width%3D%221.8%22 stroke-linecap%3D%22round%22 opacity%3D%22.85%22%2F%3E%3C%2Fsvg%3E">
  <style>
    :root { color-scheme: light dark; --page:#f9f9f7; --card:#fcfcfb; --ink:#17181a; --ink-2:#52514e; --line:#e1e0d9; --gold:#c9920e; --gold-text:#7a5800; --gold-wash:rgba(201,146,14,.08); --mono:ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,monospace; --sans:"Hiragino Sans","Hiragino Kaku Gothic ProN","Yu Gothic UI",system-ui,-apple-system,"Segoe UI",sans-serif; }
    @media (prefers-color-scheme: dark) { :root { --page:#0d0d0d; --card:#1a1a19; --ink:#f2f2ef; --ink-2:#c3c2b7; --line:#2c2c2a; --gold:#e3b341; --gold-text:#e3b341; --gold-wash:rgba(227,179,65,.09); } }
    * { box-sizing:border-box; }
    body { margin:0; min-height:100vh; display:grid; place-items:center; padding:24px; background:var(--page); color:var(--ink); font-family:var(--sans); }
    main { width:min(420px,100%); }
    .eyebrow { font-family:var(--mono); font-size:11px; font-weight:700; letter-spacing:.14em; color:var(--gold-text); }
    h1 { margin:6px 0 18px; font-size:26px; line-height:1.35; }
    form { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:22px; }
    label { display:block; margin-bottom:8px; font-size:13px; color:var(--ink-2); }
    input { width:100%; min-height:46px; border:1px solid var(--line); border-radius:8px; padding:0 12px; background:var(--page); color:var(--ink); font:16px var(--sans); }
    button { width:100%; min-height:46px; margin-top:14px; border:1px solid var(--gold); border-radius:8px; background:var(--gold-wash); color:var(--gold-text); font-weight:800; cursor:pointer; }
    .error { margin:0 0 12px; color:#b42318; font-weight:700; }
  </style>
</head>
<body>
  <main>
    <div class="eyebrow">WINNOW OWNER</div>
    <h1>ログイン</h1>
    <form method="post" action="/login">
      ${message}
      <label for="key">オーナーキー</label>
      <input id="key" name="key" type="password" autocomplete="current-password" required autofocus>
      <button type="submit">ログイン</button>
    </form>
  </main>
</body>
</html>`;
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

app.get('/login', (c) => c.html(loginPage()));

app.post('/login', async (c) => {
  const form = await c.req.formData().catch(() => null);
  const key = String(form?.get('key') || '');
  if (validAuthKey(c, key)) {
    await setSessionCookie(c);
    return c.redirect('/', 302);
  }
  await sleep(1000);
  return c.html(loginPage('キーが正しくありません。'), 401);
});

app.get('/logout', (c) => {
  c.header('Set-Cookie', `${sessionCookieName}=; ${clearCookieOptions}`);
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

// Cloudflare Access が付ける JWT（Cf-Access-Jwt-Assertion）を検証する。
// Access が外れた・設定が欠けた場合はすべて拒否する（fail-closed）。

export type AccessConfig = {
  teamDomain: string; // https://<team>.cloudflareaccess.com
  aud: string;
  ownerEmail: string;
};

type Jwk = JsonWebKey & { kid?: string };
export type FetchCerts = (url: string) => Promise<{ keys: Jwk[] }>;

const certsTtlMs = 60 * 60 * 1000;
let certsCache: { url: string; keys: Jwk[]; at: number } | null = null;

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(base64);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function decodeJson(segment: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment)));
}

async function certs(url: string, fetchCerts: FetchCerts, now: number, refresh: boolean): Promise<Jwk[]> {
  if (!refresh && certsCache && certsCache.url === url && now - certsCache.at < certsTtlMs) return certsCache.keys;
  const { keys } = await fetchCerts(url);
  certsCache = { url, keys, at: now };
  return keys;
}

export function resetCertsCache(): void {
  certsCache = null;
}

export async function verifyAccessJwt(
  token: string | null | undefined,
  config: Partial<AccessConfig>,
  fetchCerts: FetchCerts,
  now = Date.now(),
): Promise<{ ok: true; email: string } | { ok: false; reason: string }> {
  const { teamDomain, aud, ownerEmail } = config;
  if (!teamDomain || !aud || !ownerEmail) return { ok: false, reason: 'access not configured' };
  if (!token) return { ok: false, reason: 'no token' };
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed token' };

  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = decodeJson(parts[0]);
    payload = decodeJson(parts[1]);
  } catch {
    return { ok: false, reason: 'malformed token' };
  }
  if (header.alg !== 'RS256') return { ok: false, reason: 'unexpected alg' };

  const certsUrl = `${teamDomain}/cdn-cgi/access/certs`;
  let keys = await certs(certsUrl, fetchCerts, now, false);
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    // 鍵の入れ替え直後はキャッシュに新しい kid が無い
    keys = await certs(certsUrl, fetchCerts, now, true);
    jwk = keys.find((k) => k.kid === header.kid);
  }
  if (!jwk) return { ok: false, reason: 'unknown kid' };

  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    base64UrlToBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!valid) return { ok: false, reason: 'bad signature' };

  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(aud)) return { ok: false, reason: 'wrong aud' };
  if (payload.iss !== teamDomain) return { ok: false, reason: 'wrong iss' };
  const nowSec = Math.floor(now / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= nowSec) return { ok: false, reason: 'expired' };
  if (typeof payload.nbf === 'number' && payload.nbf > nowSec + 60) return { ok: false, reason: 'not yet valid' };
  const email = typeof payload.email === 'string' ? payload.email : '';
  if (!email || email.toLowerCase() !== ownerEmail.trim().toLowerCase()) return { ok: false, reason: 'not owner' };
  return { ok: true, email };
}

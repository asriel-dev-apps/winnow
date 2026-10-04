import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resetCertsCache, verifyAccessJwt } from '../src/access.ts';

const team = 'https://example-team.cloudflareaccess.com';
const aud = 'aud-123';
const owner = 'owner@example.com';
const config = { teamDomain: team, aud, ownerEmail: owner };
const now = Date.UTC(2026, 9, 5);
const nowSec = Math.floor(now / 1000);

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');
const enc = (obj: unknown) => b64url(new TextEncoder().encode(JSON.stringify(obj)));

async function keyPair(kid: string) {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid };
  return { privateKey: pair.privateKey, jwk };
}

async function sign(privateKey: CryptoKey, kid: string, payload: Record<string, unknown>, alg = 'RS256') {
  const head = enc({ alg, kid, typ: 'JWT' });
  const body = enc(payload);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(new Uint8Array(sig))}`;
}

const good = { aud: [aud], iss: team, email: owner, exp: nowSec + 600, iat: nowSec };

test('verifyAccessJwt', async (t) => {
  const real = await keyPair('k1');
  const attacker = await keyPair('k1');
  let certFetches = 0;
  const fetchCerts = async (url: string) => {
    certFetches += 1;
    assert.equal(url, `${team}/cdn-cgi/access/certs`);
    return { keys: [real.jwk] };
  };
  const check = async (token: string | null, cfg: Partial<typeof config> = config) =>
    verifyAccessJwt(token, cfg, fetchCerts, now);

  await t.test('オーナーの正しいトークンは通る', async () => {
    resetCertsCache();
    assert.deepEqual(await check(await sign(real.privateKey, 'k1', good)), { ok: true, email: owner });
  });
  await t.test('メールの大文字小文字は区別しない', async () => {
    assert.deepEqual(await check(await sign(real.privateKey, 'k1', { ...good, email: 'Owner@Example.com' })), { ok: true, email: 'Owner@Example.com' });
  });
  const rejects: [string, () => Promise<string | null>, Partial<typeof config>?][] = [
    ['no token', async () => null],
    ['malformed token', async () => 'abc.def'],
    ['unexpected alg', async () => sign(real.privateKey, 'k1', good, 'none')],
    ['bad signature', async () => sign(attacker.privateKey, 'k1', good)],
    ['unknown kid', async () => sign(real.privateKey, 'k9', good)],
    ['wrong aud', async () => sign(real.privateKey, 'k1', { ...good, aud: ['other-app'] })],
    ['wrong iss', async () => sign(real.privateKey, 'k1', { ...good, iss: 'https://evil.cloudflareaccess.com' })],
    ['expired', async () => sign(real.privateKey, 'k1', { ...good, exp: nowSec - 1 })],
    ['not owner', async () => sign(real.privateKey, 'k1', { ...good, email: 'someone@example.com' })],
    ['access not configured', async () => sign(real.privateKey, 'k1', good), { ...config, aud: '' }],
  ];
  for (const [reason, make, cfg] of rejects) {
    await t.test(`拒否: ${reason}`, async () => {
      assert.deepEqual(await check(await make(), cfg), { ok: false, reason });
    });
  }
  await t.test('公開鍵はキャッシュされ、未知の kid のときだけ取り直す', async () => {
    resetCertsCache();
    certFetches = 0;
    await check(await sign(real.privateKey, 'k1', good));
    await check(await sign(real.privateKey, 'k1', good));
    assert.equal(certFetches, 1);
    await check(await sign(real.privateKey, 'k9', good));
    assert.equal(certFetches, 1, '取得直後は未知の kid でも取り直さない');
    await verifyAccessJwt(await sign(real.privateKey, 'k9', good), config, fetchCerts, now + 61_000);
    assert.equal(certFetches, 2, '間隔を空ければ取り直す');
    await verifyAccessJwt(await sign(real.privateKey, 'k9', good), config, fetchCerts, now + 62_000);
    assert.equal(certFetches, 2);
  });
});

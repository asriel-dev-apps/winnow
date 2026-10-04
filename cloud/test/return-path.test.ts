import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeReturnPath } from '../src/return-path.ts';

test('safeReturnPath', () => {
  assert.equal(safeReturnPath('/2026-10-04/report#cloudflare'), '/2026-10-04/report#cloudflare');
  assert.equal(safeReturnPath(undefined), '/');
  for (const bad of ['//evil.example', '/\t/evil.example', '/\n/evil.example', '/\\evil.example', 'https://evil.example/', 'evil.example']) {
    assert.equal(safeReturnPath(bad), '/', JSON.stringify(bad));
  }
});

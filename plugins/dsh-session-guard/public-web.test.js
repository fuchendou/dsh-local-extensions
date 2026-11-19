import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchPublic, isPublicAddress } from './public-web.js';

test('accepts public destinations and rejects special-use addresses before dispatch', async () => {
  assert.equal(isPublicAddress('1.1.1.1'), true);
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
  for (const address of ['127.0.0.1', '192.0.2.1', '::1', '2001:db8::1', 'fd00::1']) {
    assert.equal(isPublicAddress(address), false);
  }
  await assert.rejects(fetchPublic({ url: 'http://127.0.0.1/' }), { code: 'WEB_FETCH_URL_BLOCKED' });
  await assert.rejects(fetchPublic({ url: 'file:///example' }), { code: 'WEB_FETCH_INVALID_URL' });
});

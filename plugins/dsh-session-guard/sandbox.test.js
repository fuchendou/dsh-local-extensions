import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import Guard from './sandbox.js';

const config = Guard.Config({ protectedDataHomes: ['/tmp/old-home', '/tmp/new-home'] });

test('sandbox accepts explicit protected homes and propagates cancellation', async () => {
  assert.deepEqual(config.protectedDataHomes, ['/tmp/old-home', '/tmp/new-home']);
  const guard = new Guard(new Context(), config);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(guard.confine(['/bin/true'], { mode: 'read-only', workspaceRoot: '/tmp', sessionId: 'ch-test' }, controller.signal), { name: 'AbortError' });
});

test('sandbox methods remain valid through a Cordis-style proxy', async () => {
  const guard = new Proxy(new Guard(new Context(), config), {});
  if (process.platform !== 'linux') {
    await assert.rejects(guard.confine(['/bin/true'], { mode: 'read-only', workspaceRoot: '/tmp', sessionId: 'ch-test' }),
      error => error.code === 'SANDBOX_UNAVAILABLE');
  }
});

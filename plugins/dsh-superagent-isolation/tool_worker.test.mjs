import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import test from 'node:test';
import { callTool, createToolRuntime, imagePixels } from './tool_worker.mjs';

const runtime = process.env.DSH_ISOLATION_RUNTIME;
if (!runtime) throw new Error('DSH_ISOLATION_RUNTIME is required for the worker integration test');
const ctx = await createToolRuntime(runtime, process.cwd());
let index = 0;
const call = (name, args) => callTool(ctx, `test-${++index}`, name, args, new AbortController().signal);
const text = result => result.content.filter(part => part.type === 'text').map(part => part.text).join('');

test('executes real DSH file, search, and shell tools in one workspace', async () => {
  assert.equal((await call('write', { file_path: 'probe.txt', content: '中文样本\n' })).isError, false);
  assert.match(text(await call('read', { file_path: 'probe.txt' })), /中文样本/);
  assert.equal((await call('edit', { file_path: 'probe.txt', old_string: '样本', new_string: '内容' })).isError, false);
  assert.match(text(await call('glob', { pattern: '*.txt' })), /probe\.txt/);
  assert.match(text(await call('grep', { pattern: '中文内容' })), /中文内容/);
  assert.match(text(await call('bash', { command: 'printf worker-ok', description: 'test shell' })), /worker-ok/);
  assert.match(text(await call('bash', { command: 'printf %s "$DSH_LIBREOFFICE_KIT_CLI"', description: 'test office environment' })), /\/opt\/runtime\/app\/node_modules/);
});

test('tracks and cancels a background shell job in the worker', async () => {
  const started = await call('bash', { command: 'sleep 30', description: 'test cancellation', run_in_background: true });
  assert.equal(started.isError, false);
  const listing = await call('job_list', {});
  assert.equal(listing.isError, false);
  const running = listing.value.find(job => job.status === 'running');
  assert.ok(running?.id);
  const killed = await call('job_kill', { job_id: running.id });
  assert.equal(killed.isError, false);
});

test('decodes a workspace image inside the worker attachment store', async () => {
  await writeFile('pixel.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC', 'base64'));
  const result = await call('read_image', { file_path: 'pixel.png' });
  assert.equal(result.isError, false, JSON.stringify(result.error));
  const image = await ctx.ctx.attachments.readImage(result.value.image);
  assert.equal(image.ref.width, 1);
  assert.equal(image.ref.height, 1);
  const pixels = await imagePixels(ctx, result, new AbortController().signal);
  assert.equal(Buffer.from(pixels.rgb, 'base64').length, pixels.width * pixels.height * 3);
});

test('rejects non-worker tools', async () => {
  await assert.rejects(call('run_code', { code: 'return 1' }), /not available/);
});

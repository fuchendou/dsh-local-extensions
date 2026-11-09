import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.SMART_ROUTER_LOG = join(await mkdtemp(join(tmpdir(), 'router-test-')), 'router.log');
process.env.DEEPSEEK_API_KEY = 'test-placeholder';
const { apply } = await import('./index.js');
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const base = { provider: 'original', model: 'old', reasoningEffort: 'max', maxTokens: 1024 };

function setup(policy = { mode: 'auto' }, config = {}) {
  const events = new Map();
  const state = { policy };
  const ctx = { logger: () => ({ info() {}, warn() {} }), on: (name, fn) => events.set(name, fn),
    get: name => name === 'channelSessions' ? { getModelPolicy: async () => state.policy }
      : name === 'llm' ? state.llm
      : name === 'agentDefaultModel' ? { currentSelection: () => ({ provider: 'default', model: 'default-model' }) } : undefined,
  };
  apply(ctx, { classifierTimeoutMs: 20, ...config });
  const agent = { id: 'test-session' };
  return { state, events, agent, claim: (text, source = { kind: 'user' }, turn, attachments = []) => events.get('agent/inbox/claimed')({ agent, turn, message: { content: [{ type: 'text', text }, ...attachments], source } }),
    request: turn => events.get('agent/request')({ agent, turn }, async () => base) };
}
function result(task_type, confidence = 1, complexity = 1) {
  return { status: 200, ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify({ task_type, complexity, confidence }) } }] }) };
}

test('manual policy skips paid classification and overrides every automatic route', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return result('research'); };
  const f = setup({ mode: 'manual', selection: { provider: 'chosen', model: 'fixed', reasoningEffort: 'low' } });
  f.claim('开展深度研究');
  assert.deepEqual(await f.request(), { provider: 'chosen', model: 'fixed', reasoningEffort: 'low', maxTokens: 1024 });
  assert.equal(calls, 0);
});

test('harness classifier and primary-model overrides do not call DeepSeek', async () => {
  globalThis.fetch = async () => { throw new Error('unexpected external classifier'); };
  const primary = { provider: 'minimax-cn', model: 'MiniMax-M3.1-Flash', reasoningEffort: 'high' };
  const f = setup(undefined, { classifier: { backend: 'harness', ...primary, reasoningEffort: 'low' },
    depthRoutes: { high: primary } });
  let called;
  f.state.llm = { async *stream(options) {
    called = options;
    yield { type: 'text-delta', text: JSON.stringify({ task_type: 'doc_writing', complexity: 2, confidence: 1 }) };
    yield { type: 'finish', reason: { kind: 'stop' } };
  } };
  f.claim('写一份正式方案');
  assert.equal((await f.request()).model, 'MiniMax-M3.1-Flash');
  assert.equal(called.reasoningEffort, 'low');
  assert.equal(called.provider, 'minimax-cn');
});
test('auto routes coding without inheriting another model reasoning effort', async () => {
  globalThis.fetch = async () => result('coding');
  const f = setup(); f.claim('修复代码');
  assert.deepEqual(await f.request(), { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'high', maxTokens: 1024 });
});

for (const complexity of [2, 3]) test(`complex coding ${complexity} uses maximum reasoning on the measured technical model`, async () => {
  globalThis.fetch = async () => result('coding', 1, complexity);
  const f = setup(); f.claim('排查复杂故障', undefined, 1);
  assert.equal((await f.request(1)).model, 'deepseek-flash');
  assert.equal((await f.request(1)).reasoningEffort, 'max');
  assert.equal((await f.request(2)).provider, 'default');
});

test('Office skill invocation receives writing route without a classifier request', async () => {
  globalThis.fetch = async () => { throw new Error('classifier must not be called'); };
  const f = setup(); f.claim('/office-documents 编写正式方案');
  assert.equal((await f.request()).model, 'deepseek-v4-pro');
  assert.equal((await f.request()).reasoningEffort, 'high');
});

test('scheduled and plugin messages cannot reuse the previous route', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return result(calls === 1 ? 'research' : 'chat'); };
  const f = setup(); f.claim('研究'); await f.request();
  f.claim('早报', { kind: 'schedule' });
  assert.equal((await f.request()).provider, 'default');
  f.claim('内部消息', { kind: 'plugin' });
  assert.equal((await f.request()).provider, 'default');
  assert.equal(calls, 2);
});

test('follow-up classifier receives only bounded current-session context', async () => {
  const inputs = [];
  globalThis.fetch = async (_url, request) => { inputs.push(JSON.parse(request.body).messages[1].content); return result('coding', 1, 2); };
  const f = setup(); f.claim('分析数据库锁冲突'); await f.request();
  f.claim('再具体一点'); await f.request();
  assert.match(inputs[1], /数据库锁冲突/);
  assert.match(inputs[1], /当前需求：\n再具体一点/);
  f.events.get('agent/disposed')({ agent: f.agent });
  f.claim('新问题'); await f.request();
  assert.doesNotMatch(inputs[2], /数据库锁冲突/);
});

test('multimodal tasks and their follow-ups stay on a compatible model', async () => {
  globalThis.fetch = async () => result('research', 1, 3);
  const f = setup(); f.claim('分析截图', undefined, 1, [{ type: 'image', image: 'mock' }]);
  assert.equal((await f.request(1)).model, 'deepseek-flash');
  assert.equal((await f.request(1)).reasoningEffort, 'max');
  f.claim('继续分析', undefined, 2);
  assert.equal((await f.request(2)).model, 'deepseek-flash');
});

test('image chat and a cold-resumed image conversation keep a compatible route', async () => {
  globalThis.fetch = async () => result('chat', 1, 1);
  const f = setup(); f.claim('这是什么', undefined, 1, [{ type: 'image', image: 'mock' }]);
  assert.equal((await f.request(1)).model, 'deepseek-flash');
  f.events.get('agent/disposed')({ agent: f.agent });
  f.agent.session = { snapshotEvents: () => [{ type: 'user/message', data: { content: [{ type: 'image', image: 'old' }] } }] };
  globalThis.fetch = async () => result('research', 1, 3);
  f.claim('继续分析', undefined, 2);
  assert.equal((await f.request(2)).model, 'deepseek-flash');
});
test('returning to auto restores the default for chat, not the last manually selected model', async () => {
  globalThis.fetch = async () => result('chat');
  const f = setup({ mode: 'manual', selection: { provider: 'chosen', model: 'fixed' } });
  f.claim('你好'); await f.request();
  f.state.policy = { mode: 'auto' }; f.claim('你好');
  assert.deepEqual(await f.request(), { provider: 'default', model: 'default-model', maxTokens: 1024 });
});
for (const [name, response] of [
  ['low confidence', async () => result('research', 0.1)],
  ['exception', async () => { throw new Error('offline'); }],
  ['timeout', () => new Promise(() => {})],
  ['invalid JSON', async () => ({ status: 200, ok: true, text: async () => 'invalid' })],
]) test(`classification ${name} keeps the default`, async () => {
  globalThis.fetch = response;
  const f = setup(); f.claim('任务');
  assert.deepEqual(await f.request(), { provider: 'default', model: 'default-model', maxTokens: 1024 });
});
test('slash commands clear stale decisions and plugin instructions do not trigger classification', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return result('research'); };
  const f = setup(); f.claim('research'); await f.request();
  f.claim('/new');
  assert.equal((await f.request()).provider, 'default');
  f.claim('internal instructions', { kind: 'plugin' });
  assert.equal(calls, 1);
});

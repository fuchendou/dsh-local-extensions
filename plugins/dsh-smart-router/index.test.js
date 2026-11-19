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
  let router;
  const ctx = { logger: () => ({ info() {}, warn() {} }), on: (name, fn) => events.set(name, fn),
    provide: (_key, service) => { router = service; },
    get: name => name === 'channelSessions' ? { getSessionEntry: () => state.policy
      ? { ...state.entry, modelPolicy: state.policy } : undefined }
      : name === 'llm' ? state.llm
      : name === 'agentDefaultModel' ? { currentSelection: () => ({ provider: 'default', model: 'default-model' }) } : undefined,
  };
  apply(ctx, { classifierTimeoutMs: 20, ...config });
  const { maxTokens, ...baseSelection } = base;
  let selection = policy?.mode === 'manual' ? policy.selection : baseSelection;
  let ordinal = 0;
  const agent = { id: 'test-session', model: { current: () => selection, select: value => { selection = value; } } };
  async function claim(text, source = { kind: 'user' }, turn, attachments = []) {
    const message = { id: String(++ordinal), content: [{ type: 'text', text }, ...attachments], source };
    await router.prepare(agent, message);
    events.get('agent/inbox/claimed')({ agent, turn: turn ?? ordinal, message });
  }
  return { state, events, agent, router, claim, request: () => ({ ...selection, maxTokens }) };
}
function result(task_type, confidence = 1, complexity = 1) {
  return { status: 200, ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify({ task_type, complexity, confidence }) } }] }) };
}

test('manual policy skips paid classification and overrides every automatic route', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return result('research'); };
  const f = setup({ mode: 'manual', selection: { provider: 'chosen', model: 'fixed', reasoningEffort: 'low' } });
  await f.claim('开展深度研究');
  assert.deepEqual(f.request(), { provider: 'chosen', model: 'fixed', reasoningEffort: 'low', maxTokens: 1024 });
  assert.equal(calls, 0);
});

test('managed Super-agent sessions retain their role model without classification', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return result('research'); };
  const f = setup();
  f.state.entry = { managed: { role: 'worker' } };
  await f.claim('后台任务');
  assert.deepEqual(f.request(), base);
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
  await f.claim('写一份正式方案');
  assert.equal(f.request().model, 'MiniMax-M3.1-Flash');
  assert.equal(called.reasoningEffort, 'low');
  assert.equal(called.provider, 'minimax-cn');
});
test('auto routes coding without inheriting another model reasoning effort', async () => {
  globalThis.fetch = async () => result('coding');
  const f = setup(); await f.claim('修复代码');
  assert.deepEqual(f.request(), { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'high', maxTokens: 1024 });
});

for (const complexity of [2, 3]) test(`complex coding ${complexity} uses maximum reasoning on the measured technical model`, async () => {
  globalThis.fetch = async () => result('coding', 1, complexity);
  const f = setup(); await f.claim('排查复杂故障', undefined, 1);
  assert.equal(f.request().model, 'deepseek-flash');
  assert.equal(f.request().reasoningEffort, 'max');
  await f.claim('系统消息', { kind: 'plugin' }, 2);
  assert.equal(f.request().provider, 'default');
});

test('Office skill invocation receives writing route without a classifier request', async () => {
  globalThis.fetch = async () => { throw new Error('classifier must not be called'); };
  const f = setup(); await f.claim('/office-documents 编写正式方案');
  assert.equal(f.request().model, 'deepseek-v4-pro');
  assert.equal(f.request().reasoningEffort, 'high');
});

test('scheduled and plugin messages cannot reuse the previous route', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return result(calls === 1 ? 'research' : 'chat'); };
  const f = setup(); await f.claim('研究');
  await f.claim('早报', { kind: 'schedule' });
  assert.equal(f.request().provider, 'default');
  await f.claim('内部消息', { kind: 'plugin' });
  assert.equal(f.request().provider, 'default');
  assert.equal(calls, 2);
});

test('follow-up classifier receives only bounded current-session context', async () => {
  const inputs = [];
  globalThis.fetch = async (_url, request) => { inputs.push(JSON.parse(request.body).messages[1].content); return result('coding', 1, 2); };
  const f = setup(); await f.claim('分析数据库锁冲突');
  await f.claim('再具体一点'); f.request();
  assert.match(inputs[1], /数据库锁冲突/);
  assert.match(inputs[1], /当前需求：\n再具体一点/);
  f.events.get('agent/disposed')({ agent: f.agent });
  await f.claim('新问题'); f.request();
  assert.doesNotMatch(inputs[2], /数据库锁冲突/);
});

test('multimodal tasks and their follow-ups stay on a compatible model', async () => {
  globalThis.fetch = async () => result('research', 1, 3);
  const f = setup(); await f.claim('分析截图', undefined, 1, [{ type: 'image', image: 'mock' }]);
  assert.equal(f.request().model, 'deepseek-flash');
  assert.equal(f.request().reasoningEffort, 'max');
  await f.claim('继续分析', undefined, 2);
  assert.equal(f.request().model, 'deepseek-flash');
});

test('image chat and a cold-resumed image conversation keep a compatible route', async () => {
  globalThis.fetch = async () => result('chat', 1, 1);
  const f = setup(); await f.claim('这是什么', undefined, 1, [{ type: 'image', image: 'mock' }]);
  assert.equal(f.request().model, 'deepseek-flash');
  f.events.get('agent/disposed')({ agent: f.agent });
  f.agent.session = { snapshotEvents: () => [{ type: 'user/message', data: { content: [{ type: 'image', image: 'old' }] } }] };
  globalThis.fetch = async () => result('research', 1, 3);
  await f.claim('继续分析', undefined, 2);
  assert.equal(f.request().model, 'deepseek-flash');
});
test('returning to auto restores the default for chat, not the last manually selected model', async () => {
  globalThis.fetch = async () => result('chat');
  const f = setup({ mode: 'manual', selection: { provider: 'chosen', model: 'fixed' } });
  await f.claim('你好');
  f.state.policy = { mode: 'auto' }; await f.claim('你好');
  assert.deepEqual(f.request(), { provider: 'default', model: 'default-model', maxTokens: 1024 });
});
for (const [name, response] of [
  ['low confidence', async () => result('research', 0.1)],
  ['exception', async () => { throw new Error('offline'); }],
  ['timeout', () => new Promise(() => {})],
  ['invalid JSON', async () => ({ status: 200, ok: true, text: async () => 'invalid' })],
]) test(`classification ${name} keeps the default`, async () => {
  globalThis.fetch = response;
  const f = setup(); await f.claim('任务');
  assert.deepEqual(f.request(), { provider: 'default', model: 'default-model', maxTokens: 1024 });
});
test('slash commands clear stale decisions and plugin instructions do not trigger classification', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return result('research'); };
  const f = setup(); await f.claim('research');
  await f.claim('/new');
  assert.equal(f.request().provider, 'default');
  await f.claim('internal instructions', { kind: 'plugin' });
  assert.equal(calls, 1);
});

test('chooses the route associated with the claimed RPC and discards cancelled preparation', async () => {
  globalThis.fetch = async (_url, request) => {
    const input = JSON.parse(request.body).messages[1].content;
    return result(input.includes('研究') ? 'research' : 'coding');
  };
  const f = setup();
  const message = (rpcId, text) => ({ source: { kind: 'user', rpcId }, content: [{ type: 'text', text }] });
  const research = message('research', '开展研究');
  const coding = message('coding', '修复代码');
  await f.router.prepare(f.agent, research);
  await f.router.prepare(f.agent, coding);
  f.events.get('agent/inbox/claimed')({ agent: f.agent, message: { ...research, id: 'host-id' }, turn: 1 });
  assert.equal(f.agent.model.current().model, 'deepseek-v4-pro');
  f.router.discard(f.agent, coding);
  f.events.get('agent/inbox/claimed')({ agent: f.agent, message: { ...coding, id: 'another-host-id' }, turn: 2 });
  assert.equal(f.agent.model.current().model, 'default-model');
});

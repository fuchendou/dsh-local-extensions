import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TodoService, apply, createTodoRuntime, ownerAdmission } from '../lib/index.js';

const owner = { key: 'a'.repeat(64), sessionId: 'ch-original' };
const other = { key: 'b'.repeat(64), sessionId: 'ch-other' };

test('owned storage, retry, restart and original recipient', async () => {
  const root = mkdtempSync(join(tmpdir(), 'personalai-todo-'));
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = root;
  let fail = true;
  const sent = [];
  const ctx = { channelSessions: {
    listOwners: async () => [owner, other], singleOwner: async () => owner,
    getSessionEntry: () => true, ownerForAgent: async () => owner,
    notifyOwner: async (target, text) => { if (fail) throw new Error('offline'); sent.push({ target, text }); },
  } };
  try {
    const first = createTodoRuntime(ctx);
    const store = first.getForOwner(owner);
    store.add({ title: 'test reminder', dueAt: Date.now() - 1000 });
    first.getForOwner(other).add({ title: 'private other' });
    await first.tick();
    assert.equal(store.pendingDeliveries().length, 1);
    const event = store.pendingDeliveries()[0];
    store.dismissReminder(event.id);
    assert.equal(store.pendingDeliveries().length, 1);
    fail = false;
    const restarted = createTodoRuntime(ctx);
    await restarted.tick();
    assert.deepEqual(sent, [{ target: owner, text: '【提醒】test reminder' }]);
    await restarted.tick();
    assert.equal(sent.length, 1);
    assert.equal(restarted.getForOwner(owner).state().todos.length, 1);
    assert.equal(restarted.getForOwner(other).state().todos[0].title, 'private other');
    assert.equal(restarted.getForOwner(owner).pendingDeliveries().length, 0);
  } finally { if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous; }
});

test('recurring missed reminders fire once and advance to a future occurrence', () => {
  const root = mkdtempSync(join(tmpdir(), 'personalai-repeat-'));
  const store = new TodoService(join(root, 'todos.json'));
  store.setOriginSession(owner.sessionId);
  const now = Date.now();
  const item = store.add({ title: 'daily', dueAt: now - 3 * 86400000, repeat: 'daily' });
  store.tick(now);
  assert.equal(store.pendingDeliveries().length, 1);
  assert.ok(store.allTodos().find((entry) => entry.id === item.id).dueAt > now);
  store.tick(now);
  assert.equal(store.pendingDeliveries().length, 1);
});

test('corrupt data fails closed and write failures roll back memory', () => {
  const root = mkdtempSync(join(tmpdir(), 'personalai-failure-'));
  const corrupt = join(root, 'corrupt.json');
  writeFileSync(corrupt, '{broken');
  assert.throws(() => new TodoService(corrupt));
  assert.equal(readFileSync(corrupt, 'utf8'), '{broken');
  const parent = join(root, 'blocked');
  const store = new TodoService(join(parent, 'todo.json'));
  writeFileSync(parent, 'not a directory');
  assert.throws(() => store.add({ title: 'must not persist' }));
  assert.equal(store.allTodos().length, 0);
});

test('Web routes require an admitted owner and fail closed without authentication', () => {
  assert.equal(ownerAdmission(undefined, {}), 503);
  assert.equal(ownerAdmission({ admit: () => ({ rejection: 401 }) }, {}), 401);
  assert.equal(ownerAdmission({ admit: () => ({ rejection: 403 }) }, {}), 403);
  assert.equal(ownerAdmission({ admit: () => ({ peer: { principal: { kind: 'remote' } } }) }, {}), 403);
  assert.equal(ownerAdmission({ admit: () => ({ peer: { principal: { kind: 'owner' } } }) }, {}), 200);
});

test('all registered Web routes enforce admission and model tools reject an unauthorized owner', async () => {
  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'personalai-routes-'));
  const routes = [];
  const tools = [];
  let admission = { rejection: 401 };
  let allowed = true;
  const ctx = {
    connection: { admit: () => admission },
    channelSessions: {
      singleOwner: async () => owner,
      listOwners: async () => [owner],
      getSessionEntry: () => true,
      assertWritable: () => {},
      ownerForAgent: async () => { if (!allowed) throw new Error('access denied'); return owner; },
      notifyOwner: async () => {},
    },
    webServer: { register: route => { routes.push(route); return () => {}; } },
    tools: { register: tool => { tools.push(tool); return () => {}; } },
    systemPrompt: { section: () => () => {} },
    provide: () => {}, interval: () => () => {}, effect: fn => fn(),
  };
  try {
    apply(ctx);
    assert.ok(routes.length >= 8);
    for (const route of routes) {
      const res = { code: undefined, writeHead(code) { this.code = code; }, end() {} };
      await route.handler({ method: 'GET', socket: { remoteAddress: '127.0.0.1' } }, res);
      assert.equal(res.code, 401, route.path);
    }
    admission = { peer: { principal: { kind: 'owner' } } };
    const response = { code: undefined, body: '', writeHead(code) { this.code = code; }, end(text = '') { this.body = text; } };
    await routes.find(route => route.path === '/api/todo/state').handler({ method: 'GET', socket: { remoteAddress: '127.0.0.1' } }, response);
    assert.equal(response.code, 200);
    assert.deepEqual(JSON.parse(response.body).todos, []);
    const unsafe = { code: undefined, writeHead(code) { this.code = code; }, end() {} };
    await routes.find(route => route.path === '/api/todo/add').handler({ method: 'POST', headers: { 'content-type': 'text/plain' }, socket: { remoteAddress: '127.0.0.1' } }, unsafe);
    assert.equal(unsafe.code, 415);
    allowed = false;
    const add = tools.find(tool => tool.name === 'todo_add');
    await assert.rejects(add.execute({ title: 'forbidden' }, { agent: { id: 'ch-other' } }), /access denied/);
  } finally { if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous; }
});

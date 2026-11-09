import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { searchCommand, officeCommand, todoCommands, reminderTool } from './index.js';
import { formatBeijing, parseSchedule } from './time.js';
import { TodoService } from '../../vendor/dsh-todo-reminder/lib/index.js';

const agent = { id: 'ch-test', session: { header: { cwd: '/tmp' } } };
const invoke = (command, rawInput = '') => command.handler({ agent, rawInput, signal: new AbortController().signal });

test('search returns sources and errors without using a model', async () => {
  let request;
  const ctx = { web: { search: async (value) => { request = value; return { sources: [{ title: '官网', url: 'https://example.com', snippet: '内容' }] }; } } };
  const command = searchCommand(ctx);
  assert.match((await invoke(command, ' 测试 ')).text, /官网\nhttps:\/\/example.com/);
  assert.deepEqual(request, { query: '测试', maxResults: 5 });
  assert.equal((await invoke(command)).kind, 'error');
  ctx.web.search = async () => { throw new Error('network failed'); };
  assert.match((await invoke(command, '测试')).text, /network failed/);
});

test('office commands verify the skill and submit a native invocation with the requester', async () => {
  const messages = [];
  const ctx = { skills: { get: async () => ({ invocation: { userInvocable: true } }) },
    channelSessions: { submitFromCommand: (owner, message) => messages.push({ owner, message }) } };
  const command = officeCommand(ctx, 'documents');
  assert.match((await invoke(command)).text, /示例/);
  assert.equal(messages.length, 0);
  assert.match((await invoke(command, '做纪要')).text, /已开始/);
  assert.equal(messages[0].owner, agent);
  assert.equal(messages[0].message.content[0].text, '/office-documents 做纪要');
  assert.equal(messages[0].message.source.kind, 'user');
  ctx.skills.get = async () => undefined;
  assert.equal((await invoke(command, '做纪要')).kind, 'error');
});

test('Beijing schedules reject bad dates and advance daily and weekly occurrences', () => {
  const now = Date.parse('2026-11-04T08:00:00Z');
  assert.equal(formatBeijing(parseSchedule('+10m 喝水', now).dueAt), '2026-11-04 16:10');
  assert.equal(formatBeijing(parseSchedule('2026-11-05T09:00 开会', now).dueAt), '2026-11-05 09:00');
  assert.equal(formatBeijing(parseSchedule('daily 09:00 日报', now).dueAt), '2026-11-05 09:00');
  assert.equal(formatBeijing(parseSchedule('tomorrow 09:00 会议', now).dueAt), '2026-11-05 09:00');
  assert.equal(formatBeijing(parseSchedule('weekly fri 17:00 周报', now).dueAt), '2026-11-06 17:00');
  assert.throws(() => parseSchedule('2026-02-30T09:00 invalid', now));
  assert.throws(() => parseSchedule('+0m invalid', now));
  assert.throws(() => parseSchedule('daily 25:99 invalid', now));
});

test('natural-language reminder tool uses the same owned service and clock', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'reminder-tool-')), 'todos.json');
  const store = new TodoService(path);
  store.setOriginSession('ch-original');
  const tool = reminderTool({ personalTodos: { forAgent: async () => ({ store }) }, channelSessions: { assertWritable() {} } });
  assert.match(await tool.execute({ action: 'clock' }, { agent }), /北京时间/);
  assert.match(await tool.execute({ action: 'create', when: '+10m', title: '喝水' }, { agent }), /喝水/);
  assert.match(await tool.execute({ action: 'list' }, { agent }), /喝水/);
  const id = store.allTodos()[0].id.slice(0, 8);
  assert.match(await tool.execute({ action: 'cancel', id }, { agent }), /取消/);
  await assert.rejects(tool.execute({ action: 'create', when: '+10m' }, { agent }));
});

test('todo and reminder commands share persisted state and validate identifiers', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'assistant-')), 'todos.json');
  const store = new TodoService(path);
  store.setOriginSession('ch-original');
  const ctx = { personalTodos: { forAgent: async () => ({ store }) }, channelSessions: { assertWritable() {} } };
  const [todo, remind, reminders] = todoCommands(ctx);
  assert.match((await invoke(todo, 'add 交周报')).text, /已添加/);
  const id = store.allTodos()[0].id.slice(0, 8);
  assert.match((await invoke(todo, `edit ${id} 修改周报`)).text, /修改周报/);
  assert.equal((await invoke(todo, `done ${id}`)).kind, 'success');
  assert.match((await invoke(todo, 'done')).text, /修改周报/);
  await invoke(todo, `archive ${id}`);
  assert.doesNotMatch((await invoke(todo, 'all')).text, /修改周报/);
  assert.match((await invoke(todo, 'archived')).text, /修改周报/);
  await invoke(todo, `restore ${id}`);
  await invoke(todo, `reopen ${id}`);
  assert.match((await invoke(todo)).text, /修改周报/);
  assert.equal((await invoke(todo, 'show missing')).kind, 'error');
  assert.match((await invoke(remind, '+10m 喝水')).text, /北京时间/);
  const reminderId = store.allTodos().find(item => item.title === '喝水').id.slice(0, 8);
  assert.match((await invoke(reminders)).text, /喝水/);
  assert.equal((await invoke(remind, `pause ${reminderId}`)).kind, 'success');
  assert.match((await invoke(reminders)).text, /已暂停/);
  assert.equal((await invoke(remind, `resume ${reminderId}`)).kind, 'success');
  assert.equal((await invoke(remind, `snooze ${reminderId} 0`)).kind, 'error');
  assert.equal((await invoke(remind, `snooze ${reminderId} 10`)).kind, 'success');
  assert.equal((await invoke(remind, `cancel ${reminderId}`)).kind, 'success');
  assert.doesNotMatch((await invoke(reminders)).text, /喝水/);
  assert.equal(new TodoService(path).allTodos().length, 2);
});

test('read-only planning permits listing but denies task and reminder changes', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'assistant-readonly-')), 'todos.json');
  const store = new TodoService(path);
  const ctx = { personalTodos: { forAgent: async () => ({ store }) }, channelSessions: { assertWritable() { throw new Error('只读规划模式'); } } };
  const [todo, remind, reminders] = todoCommands(ctx);
  assert.equal((await invoke(todo)).kind, 'success');
  assert.equal((await invoke(reminders)).kind, 'success');
  assert.match((await invoke(todo, 'add 不应写入')).text, /只读/);
  assert.match((await invoke(remind, '+10m 不应写入')).text, /只读/);
  assert.equal(store.allTodos().length, 0);
});

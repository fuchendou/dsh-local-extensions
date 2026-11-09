import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import CommandRuntime from '@deepseek-ai/dsh-commands';
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session';
import { AgentRegistry } from '@deepseek-ai/dsh-agent';
import { createScope } from '@deepseek-ai/dsh-scope';
import { apply } from './index.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

test('real Cordis and command registry mount and dispose plugin capabilities', async () => {
  const ctx = new Context();
  new CommandRuntime(ctx);
  const sessions = new SessionStore(ctx);
  const agents = new AgentRegistry(ctx);
  const session = sessions.create(SessionId('test-office'));
  const agent = { id: session.id, session, status: 'idle', followup() {} };
  agent.ctx = createScope(ctx, agent).ctx;
  const unregister = agents.register(agent);
  const skillNames = ['office-documents', 'office-spreadsheets', 'office-presentations', 'office-pdf'];
  ctx.provide('web', { search: async () => ({ sources: [{ title: 'Example', url: 'https://example.com' }] }) });
  ctx.provide('skills', { snapshot: async () => ({ complete: true, skills: skillNames.map(name => ({ name, invocation: { userInvocable: true } })) }),
    get: async () => ({ invocation: { userInvocable: true } }) });
  ctx.provide('channelSessions', { submitFromCommand() {} });
  ctx.provide('personalTodos', { forAgent: async () => ({ store: { allTodos: () => [], pendingDeliveries: () => [] } }) });
  const tools = new Map();
  ctx.provide('tools', { register: tool => { tools.set(tool.name, tool); return () => tools.delete(tool.name); } });
  const fiber = ctx.plugin({ name: 'personalai-office-assistant-test', apply });
  try {
    await fiber.await();
    for (let i = 0; i < 50 && !ctx.commands.find(agent, 'documents'); i++) await sleep(10);
    for (const name of ['search', 'documents', 'spreadsheets', 'presentations', 'pdf', 'todo', 'remind', 'reminders']) {
      assert.ok(ctx.commands.find(agent, name), `missing command ${name}`);
    }
    assert.ok(tools.has('personal_reminder'));
    const execution = await ctx.commands.execute(agent, '/search test', [], new AbortController().signal);
    assert.equal(execution.result.kind, 'success');
    assert.match(execution.result.text, /https:\/\/example.com/);
  } finally {
    await fiber.dispose();
    unregister();
  }
  assert.equal(ctx.commands.find(agent, 'search'), undefined);
  assert.equal(tools.size, 0);
});

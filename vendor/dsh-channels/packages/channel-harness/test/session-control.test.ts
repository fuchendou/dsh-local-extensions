import { afterEach, describe, expect, it, vi } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import CommandRuntime from '@deepseek-ai/dsh-commands';
import SessionStore, { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session';
import { AgentRegistry, type Agent, type AgentSetup } from '@deepseek-ai/dsh-agent';
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection';
import GoalService from '@deepseek-ai/dsh-goal';
import { createScope, scopeTarget } from '@deepseek-ai/dsh-scope';
import { MessageId } from '@deepseek-ai/dsh-llm';
import { AgentManager, type AgentGateway, type GatewayAgentHandle } from '../src/agent-manager.ts';
import { AgentRouter } from '../src/agent-router.ts';
import { MemoryBindingStore } from '../src/binding-store.ts';
import { ChannelHarnessBridge } from '../src/bridge.ts';
import { ChannelSessionIndex, shortSessionId } from '../src/session-index.ts';
import { ChannelSessionControl, historyMessages } from '../src/session-control.ts';
import { Config } from '../src/config.ts';
import { ReplyContextStore } from '../src/reply-context-store.ts';
import { allowAllAccessResolver } from './access-test-helper.ts';
import type { MessageReceived } from '@wsz987/channel-core';

const disposers: (() => Promise<void>)[] = [];
afterEach(async () => { for (const dispose of disposers.splice(0)) await dispose(); });

function fixture(startControl = true, reply?: { maxTextLength?: number; finalFlush?: boolean }) {
  const ctx = new Context();
  new CommandRuntime(ctx);
  const store = new SessionStore(ctx);
  ctx.on('session/flush', async () => {});
  const agents = new AgentRegistry(ctx);
  new SessionProjectionRegistry(ctx);
  const goals = new GoalService(ctx);
  const defaults = { provider: 'mock', model: 'default' };
  const saveDefault = vi.fn();
  ctx.provide('agentDefaultModel', { currentSelection: () => defaults, saveSelection: saveDefault } as never);
  ctx.provide('llm', {
    listProviders: () => [{ id: 'mock', name: 'Mock' }],
    listModels: async () => [{ id: 'deep', name: 'Deep' }],
    resolveModelInfo: async (_p: string, model: string) => {
      if (model === 'missing') throw new Error('unknown model');
      return { id: model, provider: 'mock', reasoning: { efforts: [{ id: 'low' }, { id: 'high' }] } };
    },
  } as never);
  const live = new Map<string, GatewayAgentHandle>();
  const followups: { id: string; message: unknown }[] = [];
  const retired: string[] = [];
  async function make(id: string, setup?: AgentSetup): Promise<GatewayAgentHandle> {
    const session = store.get(SessionId(id)) ?? store.create(SessionId(id), { meta: { cwd: '/tmp/channel-shared' } });
    const agent = { id: SessionId(id), session, status: 'idle', options: defaults,
      ctx: new Context(), inbox: { nextStep: [], nextTurn: [] },
      cancel: vi.fn(), followup: (message: unknown) => followups.push({ id, message }),
      whenIdle: async () => {},
    } as unknown as Agent;
    agent.ctx = createScope(ctx, agent).ctx;
    const unregister = agents.register(agent);
    if (setup) { const commit = await setup(agent.ctx, agent); commit?.commit(); }
    const handle = { id, agent, followup: (message: unknown) => agent.followup(message as never),
      whenIdle: async () => {}, dispose: async () => { retired.push(id); live.delete(id); unregister(); } };
    live.set(id, handle);
    return handle;
  }
  const gateway: AgentGateway = {
    get: id => live.get(id), create: (id, _route, setup) => make(id, setup),
    resume: (id, _route, setup) => make(id, setup), canResume: () => true, exists: async id => Boolean(store.get(SessionId(id))),
  };
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const manager = new AgentManager(gateway, logger, 4);
  const bindings = new MemoryBindingStore();
  const index = new ChannelSessionIndex();
  const sent: { target: unknown; text: string }[] = [];
  const adapter = { capabilities: { text: true, file: true, streaming: 'buffered' }, send: vi.fn(async (target, message) => {
    sent.push({ target, text: message.text }); return { delivered: true };
  }) };
  const replyContexts = new ReplyContextStore();
  const access = { allowed: true };
  let bridge: ChannelHarnessBridge;
  const control = new ChannelSessionControl(ctx, index, bindings, {
    create: (agent, background) => bridge.createSessionFor(agent, background), acquire: binding => bridge.acquireSession(binding),
    events: async id => store.get(SessionId(id))!.snapshotEvents(), authorized: async () => access.allowed,
    adapter: () => adapter as never,
    replyContext: (id, turn) => replyContexts.getTurn(id, turn),
  });
  const config = Config({ agent: { default: {} }, sessionControl: { enabled: true }, bindingStore: { type: 'memory' },
    ...(reply ? { reply } : {}) });
  bridge = new ChannelHarnessBridge({ ctx, config, sessions: control, bindingStore: bindings, agentManager: manager,
    agentRouter: new AgentRouter(config), replyContexts, logger,
    getAdapter: () => adapter as never, accessResolver: allowAllAccessResolver,
    commandDeps: { startNewSession: agent => bridge.startNewSession(agent) }, workspaceResolver: { resolve: async () => ({}) },
  });
  if (startControl) control.start();
  disposers.push(async () => { await control.stop(); await bridge.disposeCommandSetups(); await manager.disposeAll(); });
  let message = 0;
  async function send(text: string, owner = 'alice') {
    await bridge.handleChannelEvent({ type: 'message.received', channel: 'weixin', accountId: 'main',
      conversation: { id: owner, type: 'dm' }, sender: { id: owner },
      message: { id: `message-${++message}`, content: [{ type: 'text', text }] },
    } as MessageReceived);
    return sent.at(-1)?.text ?? '';
  }
  const active = async (owner = 'alice') => (await bindings.get(`weixin:main:${owner}`))!;
  return { ctx, store, agents, goals, control, index, bindings, manager, send, active, followups, retired, sent, saveDefault, adapter, replyContexts, access };
}

function appendPlan(session: ReturnType<SessionStore['create']>, turn: number, reason: 'completed' | 'blocked' = 'completed') {
  session.append('assistant/message', { turn, step: 0,
    message: { id: MessageId(`plan-${turn}`), role: 'assistant', content: [{ type: 'text', text: '实施计划：先核对，再执行。' }],
      source: { kind: 'model', provider: 'mock', model: 'mock' } }, stream: [] }, { surfaceOp: 'append' });
  session.append('turn/end', { turn, reason: { kind: reason } });
}

describe('managed channel conversations', () => {
  it('creates an owned background routine without changing the active conversation', async () => {
    const f = fixture();
    await f.send('原会话');
    const original = await f.active();
    const agent = f.agents.get(SessionId(original.sessionId))!;
    const owner = await f.control.ownerForAgent(agent);
    const routine = await f.control.createRoutine(owner);
    expect((await f.active()).sessionId).toBe(original.sessionId);
    expect((await f.index.get(routine))?.routine?.ownerSessionId).toBe(original.sessionId);
    expect((await f.index.list(original)).map(entry => entry.binding.sessionId)).not.toContain(routine);
    expect(await f.control.listOwners()).toEqual([owner]);
    await f.control.validateRoutine(owner, routine);
    await expect(f.control.validateRoutine({ ...owner, key: 'wrong' }, routine)).rejects.toThrow('权限');
    await f.send('/new 另一个会话');
    await f.control.notifyOwner(owner, '后台早报');
    expect(f.sent.at(-1)?.target).toMatchObject({ conversationId: 'alice' });
    f.access.allowed = false;
    await expect(f.control.validateRoutine(owner, routine)).rejects.toThrow('权限');
  });

  it('admits only registered schedule work and preserves a manual routine model', async () => {
    const f = fixture();
    await f.send('原会话');
    const owner = await f.control.ownerForAgent(f.agents.get(SessionId((await f.active()).sessionId))!);
    const id = await f.control.createRoutine(owner);
    const agent = f.agents.get(SessionId(id))!;
    const restrict = vi.fn();
    f.ctx.provide('tools', { restrict, guard: () => () => {} } as never);
    const admit = vi.fn(async () => '本轮早报指令');
    const failed = vi.fn(async () => {});
    const stop = f.control.registerRoutineHandler({ admit, failed });
    const step = async (kind: string, number = 0) => agent.ctx.waterfall(scopeTarget(agent, agent), 'agent/pre-step', {
      agent, messages: [{ id: MessageId('scheduled'), role: 'user', content: [{ type: 'text', text: 'ignored payload' }], source: { kind } } as never],
      turn: 1, step: number, signal: new AbortController().signal,
    }, async () => ({ kind: 'reject' as const }));
    const accepted = await step('schedule');
    expect(accepted.kind).toBe('enter');
    if (accepted.kind === 'enter') expect(accepted.messages[0]?.source.kind).toBe('channel-routine');
    expect(restrict).toHaveBeenCalledWith({ allow: ['briefing_sources', 'briefing_submit'] });
    expect((await step('user')).kind).toBe('reject');
    expect((await step('schedule', 12)).kind).toBe('reject');
    expect(failed).toHaveBeenCalledOnce();
    agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } });
    expect(failed).toHaveBeenCalledTimes(2);
    const request = () => agent.ctx.waterfall(scopeTarget(agent, agent), 'agent/request', {
      agent, turn: 1, step: 0, signal: new AbortController().signal,
    }, async () => ({ provider: 'default', model: 'default' }));
    expect(await request()).toMatchObject({ model: 'deepseek-v4-pro', reasoningEffort: 'high' });
    await f.control.configureRoutineModel(owner, id, { provider: 'mock', model: 'deep', reasoningEffort: 'high' });
    expect(await request()).toMatchObject({ model: 'deep', reasoningEffort: 'high' });
    await expect(f.control.configureRoutineModel(owner, id, { provider: 'mock', model: 'deep', reasoningEffort: 'ultra' })).rejects.toThrow('不可用');
    await f.control.setModelPolicy(id, { mode: 'manual', selection: { provider: 'mock', model: 'fixed', reasoningEffort: 'low' } });
    expect(await request()).toMatchObject({ model: 'fixed', reasoningEffort: 'low' });
    f.access.allowed = false;
    expect((await step('schedule')).kind).toBe('reject');
    stop();
  });
  it('delivers presented files only to the originating authorized channel turn', async () => {
    const f = fixture();
    await f.send('请求办公文件');
    const binding = await f.active();
    expect(f.control.fileDeliveryForTurn(binding.sessionId, 42)).toBeUndefined();
    f.replyContexts.register('file-message', { sessionId: binding.sessionId,
      context: { conversationType: 'dm', senderId: 'alice', runId: 'file-run' } });
    f.replyContexts.claim({ sessionId: binding.sessionId, messageId: 'file-message', turn: 42 });
    const deliver = f.control.fileDeliveryForTurn(binding.sessionId, 42)!;
    await f.send('/new 另一个会话');
    await deliver({ parts: [{ type: 'file', name: 'report.pdf', localData: new Uint8Array([1]) }] });
    expect(f.adapter.send).toHaveBeenLastCalledWith(expect.objectContaining({ conversationId: 'alice', runId: 'file-run' }),
      expect.objectContaining({ parts: [expect.objectContaining({ name: 'report.pdf' })] }));
    f.access.allowed = false;
    await expect(deliver({ text: 'notice' })).rejects.toThrow('权限已失效');
  });
  it('renders readable complete help through the channel bridge, including the final split reply', async () => {
    const f = fixture(true, { maxTextLength: 350, finalFlush: false });
    for (const [name, description, hint] of [
      ['permission', 'Switch permissions', '<preset>'],
      ['export', 'Download session', ''],
      ['feedback', 'Record feedback', '<text>'],
      ['custom', 'Custom extension', '<arg>'],
    ] as const) {
      f.ctx.commands.register({ name, description, ...(hint ? { input: { hint } } : {}),
        handler: () => ({ kind: 'success', text: 'ok' }) });
    }
    await f.send('/help');
    const chunks = f.sent.map(message => message.text);
    const text = chunks.join('\n\n');
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every(chunk => chunk.length <= 350)).toBe(true);
    for (const heading of ['会话与上下文', '模型与思考强度', '规划与后台目标', '状态与停止', '其他功能', '其他已注册命令']) {
      expect(text).toContain(`【${heading}】`);
    }
    for (const command of ['new', 'session', 'sessions', 'switch', 'history', 'rename', 'compact', 'bind',
      'model', 'models', 'effort', 'plan', 'execute', 'goal', 'status', 'stop', 'mirror', 'permission',
      'export', 'feedback', 'version', 'help', 'custom']) {
      expect(text).toMatch(new RegExp(`(?:^|\\n\\n)/${command}(?:[ ：\\[]|$)`));
    }
    expect(text).toContain('/export：在 Web 下载');
    expect(text).toContain('微信不触发下载');
    expect(text).toContain('/goal status [短ID]：查看目标进度');
    expect(text).toContain('/goal pause [短ID]：暂停目标');
    expect(text).toContain('/goal resume [短ID]：恢复目标');
    expect(text).toContain('/effort auto：使用当前模型的默认强度，仍锁定该模型');
    expect(text).toContain('/plan off：退出规划，不执行计划');
    expect(text).toContain('/custom 〈arg〉：Custom extension');
    expect(f.followups).toEqual([]);
  });

  it('explains command variants and accepts help names with or without a slash', async () => {
    const f = fixture();
    f.ctx.commands.register({ name: 'export', description: 'Download session', handler: () => ({ kind: 'success', text: 'ok' }) });
    const goal = await f.send('/help goal');
    expect(goal).toBe(await f.send('/help /goal'));
    for (const usage of ['/goal 目标内容', '/goal status', '/goal pause', '/goal resume']) expect(goal).toContain(usage);
    expect(await f.send('/help effort')).toContain('/effort auto 清除强度覆盖');
    expect(await f.send('/help effort')).toContain('/model auto 才会恢复自动选模');
    expect(await f.send('/help history')).toContain('纯数字短 ID 需同时提供页码');
    expect(await f.send('/help export')).toContain('微信不触发下载');
    expect(await f.send('/help no-such-command')).toContain('未知指令');
    expect(f.followups).toEqual([]);
  });

  it('provides detailed help for each of the standard registered commands', async () => {
    const f = fixture();
    for (const name of ['permission', 'export', 'feedback']) {
      f.ctx.commands.register({ name, description: 'Host command', handler: () => ({ kind: 'success', text: 'ok' }) });
    }
    for (const name of ['new', 'session', 'sessions', 'switch', 'history', 'rename', 'compact', 'bind',
      'model', 'models', 'effort', 'plan', 'execute', 'goal', 'status', 'stop', 'mirror', 'permission',
      'export', 'feedback', 'version', 'help']) {
      const text = await f.send(`/help ${name}`);
      expect(text.startsWith(`/${name}`)).toBe(true);
      expect(text.split('\n\n').length).toBeGreaterThanOrEqual(2);
    }
    expect(f.followups).toEqual([]);
  });

  it('keeps managed help localized and reflects live command registration', async () => {
    const f = fixture();
    f.ctx.provide('settings', { get: () => ({ preference: 'en' }) } as never);
    const dispose = f.ctx.commands.register({ name: 'custom', description: 'Custom extension',
      handler: () => ({ kind: 'success', text: 'ok' }) });
    const start = f.sent.length;
    await f.send('/help');
    const text = f.sent.slice(start).map(message => message.text).join('\n\n');
    expect(text).toContain('【Command guide】');
    expect(text).toContain('【Sessions and context】');
    expect(text).toContain('/custom：Custom extension');
    expect(text).not.toContain('会话与上下文');
    expect(await f.send('/help goal')).toContain('/goal objective starts immediately');
    dispose();
    const after = f.sent.length;
    await f.send('/help');
    expect(f.sent.slice(after).map(message => message.text).join('\n\n')).not.toContain('/custom');
  });

  it('shows only registered office and reminder commands with detailed usage', async () => {
    const f = fixture(true, { maxTextLength: 350, finalFlush: false });
    const disposers = ['search', 'documents', 'spreadsheets', 'presentations', 'pdf', 'todo', 'remind', 'reminders'].map(name =>
      f.ctx.commands.register({ name, description: 'extension', handler: () => ({ kind: 'success', text: 'ok' }) }));
    const start = f.sent.length;
    await f.send('/help');
    const text = f.sent.slice(start).map(item => item.text).join('\n\n');
    for (const heading of ['联网查询', '办公文件', '待办与提醒']) expect(text).toContain(`【${heading}】`);
    for (const name of ['search', 'documents', 'spreadsheets', 'presentations', 'pdf', 'todo', 'remind', 'reminders']) {
      expect(text).toMatch(new RegExp(`(?:^|\\n\\n)/${name}(?:[ ：\\[]|$)`));
      expect(await f.send(`/help ${name}`)).toContain(`/${name}`);
    }
    disposers.forEach(dispose => dispose());
    const next = f.sent.length;
    await f.send('/help');
    expect(f.sent.slice(next).map(item => item.text).join('\n\n')).not.toContain('【办公文件】');
  });

  it('new creates a blank session, preserves files and permits owner-scoped switching', async () => {
    const f = fixture();
    expect(await f.send('/new 旧话题')).toContain('旧话题');
    const old = await f.active();
    await f.send('只属于旧会话的随机测试信息');
    expect(await f.send('/new 新话题')).toContain('上下文为空');
    const current = await f.active();
    expect(current.sessionId).not.toBe(old.sessionId);
    await f.send('我们刚刚聊了什么？');
    expect(f.followups.at(-1)?.id).toBe(current.sessionId);
    expect(f.followups.filter(x => x.id === current.sessionId)).toHaveLength(1);
    expect(f.store.get(SessionId(old.sessionId))!.header.cwd).toBe(f.store.get(SessionId(current.sessionId))!.header.cwd);
    expect(await f.send('/sessions')).toContain('旧话题');
    expect(await f.send(`/switch ${shortSessionId(old.sessionId)}`)).toContain('已切换');
    expect((await f.active()).sessionId).toBe(old.sessionId);
    await f.send('/new', 'bob');
    expect(await f.send(`/switch ${shortSessionId(old.sessionId)}`, 'bob')).toContain('未找到');
    expect(await f.send('/sessions', 'bob')).not.toContain('旧话题');
    const bob = await f.active('bob');
    expect(await f.send(`/bind ${bob.sessionId} confirm`)).toContain('未找到');
    expect((await f.active()).sessionId).toBe(old.sessionId);
  });

  it('manual model and effort stay in the current session and never save global defaults', async () => {
    const f = fixture();
    await f.send('/new');
    const id = (await f.active()).sessionId;
    expect(await f.send('/model mock deep high')).toContain('已锁定');
    expect((await f.control.getModelPolicy(id))).toEqual({ mode: 'manual', selection: { provider: 'mock', model: 'deep', reasoningEffort: 'high' } });
    expect(await f.send('/effort impossible')).toContain('不支持');
    expect((await f.control.getModelPolicy(id))).toMatchObject({ selection: { reasoningEffort: 'high' } });
    await f.send('/effort auto');
    expect((await f.control.getModelPolicy(id))).toEqual({ mode: 'manual', selection: { provider: 'mock', model: 'deep' } });
    await f.send('/new');
    expect((await f.control.getModelPolicy((await f.active()).sessionId))?.mode).toBe('auto');
    await f.send(`/switch ${shortSessionId(id)}`);
    await f.send('/model auto');
    expect((await f.control.getModelPolicy(id))?.mode).toBe('auto');
    expect(f.saveDefault).not.toHaveBeenCalled();
  });

  it('goal creates an independent native goal and remains alive when the foreground changes', async () => {
    const f = fixture();
    await f.send('/new 普通聊天');
    const original = await f.active();
    expect(await f.send('/goal')).toContain('下一条需求');
    const task = await f.active();
    expect(task.sessionId).not.toBe(original.sessionId);
    await f.send('完成测试任务');
    const agent = f.agents.get(SessionId(task.sessionId))!;
    expect(f.goals.get(agent)).toMatchObject({ objective: '完成测试任务', phase: 'active', maxGoalRounds: 256 });
    expect(await f.send(`/switch ${shortSessionId(original.sessionId)}`)).toContain('已切换');
    expect(f.retired).not.toContain(task.sessionId);
    expect(f.agents.get(SessionId(task.sessionId))).toBe(agent);
    expect(await f.send(`/goal pause ${shortSessionId(task.sessionId)}`)).toContain('paused');
    expect(f.goals.get(agent)?.phase).toBe('paused');
    expect(await f.send(`/goal resume ${shortSessionId(task.sessionId)}`)).toContain('active');
    f.goals.disarm(agent);
    await f.control.recover();
    expect(f.goals.get(agent)?.activation).toBe('armed');
    await f.control.pause(agent);
    await f.control.recover();
    expect(f.goals.get(agent)?.phase).toBe('paused');
  });

  it('terminal goal notifications preserve the original recipient and deduplicate events', async () => {
    const f = fixture();
    await f.send('/new');
    await f.send('/goal 完成任务');
    const task = await f.active();
    const agent = f.agents.get(SessionId(task.sessionId))!;
    await f.send('/new 其他聊天');
    const before = f.sent.length;
    f.goals.complete(agent, f.goals.get(agent)!);
    await vi.waitFor(() => expect(f.sent.length).toBe(before + 1));
    expect(f.sent.at(-1)!.text).toContain(`[目标 ${shortSessionId(task.sessionId)}`);
    expect(f.sent.at(-1)!.target).toMatchObject({ conversationId: 'alice', accountId: 'main' });
    await f.control.recover();
    expect(f.sent.length).toBe(before + 1);
    expect((await f.index.get(task.sessionId))?.runIntent).toBe('paused');
  });

  it('first-message goal creates only one session and stop persists a paused intent', async () => {
    const f = fixture();
    expect(await f.send('/goal 独立任务')).toContain('自主推进');
    expect(await f.index.all()).toHaveLength(1);
    const binding = await f.active();
    await f.send('/stop');
    await vi.waitFor(async () => expect((await f.index.get(binding.sessionId))?.runIntent).toBe('paused'));
    await f.control.recover();
    expect(f.goals.get(f.agents.get(SessionId(binding.sessionId))!)?.phase).toBe('paused');
  });

  it('planning applies a read-only policy, restores it on exit and reports compaction failures', async () => {
    const f = fixture();
    let active = false;
    f.ctx.provide('planMode', { get: () => ({ active }), set: (_agent: Agent, value: boolean) => { active = value; return 'committed'; } } as never);
    const compactNow = vi.fn(async () => ({ shadowedSeqs: [1, 2], shadowedTokenCount: 300 }));
    f.ctx.provide('compaction', { compactNow } as never);
    await f.send('/new');
    const id = (await f.active()).sessionId;
    expect(await f.send('/plan 调查问题')).toContain('只读');
    const mode = () => f.store.get(SessionId(id))!.snapshotEvents().filter(e => e.type === 'sandbox/mode').at(-1)?.data.mode;
    expect(mode()).toBe('read-only');
    appendPlan(f.store.get(SessionId(id))!, 0);
    const before = f.followups.length;
    expect(await f.send('/plan off')).toContain('尚未开始执行');
    expect(f.followups).toHaveLength(before);
    expect(mode()).toBe('workspace-write');
    await f.send('/execute');
    expect(f.followups).toHaveLength(before + 1);
    expect(await f.send('/compact')).toContain('已压缩 2');
    compactNow.mockRejectedValueOnce(new Error('summary failed'));
    expect(await f.send('/compact')).toBe('summary failed');
    expect((await f.active()).sessionId).toBe(id);
  });

  it('rejects execution until a completed plan exists and preserves it across plan off', async () => {
    const f = fixture();
    let active = false;
    f.ctx.provide('planMode', { get: () => ({ active }), set: (_agent: Agent, value: boolean) => { active = value; return 'committed'; } } as never);
    await f.send('/new');
    const session = f.store.get(SessionId((await f.active()).sessionId))!;
    expect(await f.send('/execute')).toContain('尚无');
    await f.send('/plan 测试计划');
    expect(await f.send('/execute')).toContain('尚无');
    appendPlan(session, 0, 'blocked');
    expect(await f.send('/execute')).toContain('尚无');
    appendPlan(session, 1);
    await f.send('/plan off');
    expect(await f.send('/execute')).toContain('已开始执行');
    expect(await f.send('/execute')).toContain('尚无');
  });

  it('binds command-started model turns to the requesting channel message', async () => {
    const f = fixture();
    let active = false;
    f.ctx.provide('planMode', { get: () => ({ active }), set: (_agent: Agent, value: boolean) => { active = value; return 'committed'; } } as never);
    await f.send('/new');
    const sessionId = (await f.active()).sessionId;
    await f.send('/plan 规划任务');
    const message = f.followups.at(-1)!.message as { id: string };
    expect(f.replyContexts.pendingContext(message.id)).toMatchObject({ conversationType: 'dm', senderId: 'alice' });
    expect(f.replyContexts.pendingSessionId(message.id)).toBe(sessionId);
    appendPlan(f.store.get(SessionId(sessionId))!, 0);
    await f.send('/execute');
    const executeMessage = f.followups.at(-1)!.message as { id: string };
    expect(f.replyContexts.pendingSessionId(executeMessage.id)).toBe(sessionId);
  });

  it('keeps concurrent command reply scopes separate and never binds later Web work', async () => {
    const f = fixture();
    await f.send('/new');
    const agent = f.agents.get(SessionId((await f.active()).sessionId))!;
    const seen: string[] = [];
    const first = { id: 'first' } as never;
    const second = { id: 'second' } as never;
    await Promise.all([
      f.control.withCommandReply(agent, () => seen.push('first'), async () => { await Promise.resolve(); f.control.submitFromCommand(agent, first); }),
      f.control.withCommandReply(agent, () => seen.push('second'), async () => { await Promise.resolve(); f.control.submitFromCommand(agent, second); }),
    ]);
    f.control.submitFromCommand(agent, { id: 'web' } as never);
    expect(seen).toEqual(['first', 'second']);
  });

  it('explains Web-only export and prevents unsafe permission changes', async () => {
    const f = fixture();
    let active = false;
    const set = vi.fn();
    f.ctx.provide('planMode', { get: () => ({ active }), set: (_agent: Agent, value: boolean) => { active = value; return 'committed'; } } as never);
    f.ctx.provide('permissionPresets' as never, { names: ['read-only', 'workspace-write', 'danger-full-access'],
      current: () => 'workspace-write', resolve: (name: string) => ({ sandbox: name }), set } as never);
    await f.send('/new');
    expect(await f.send('/export')).toContain('Web');
    expect(await f.send('/export anything')).toContain('用法');
    expect(await f.send('/permission')).toContain('workspace-write');
    expect(await f.send('/permission danger-full-access')).toContain('拒绝');
    await f.send('/plan');
    expect(await f.send('/permission workspace-write')).toContain('规划');
    const planningAgent = f.agents.get(SessionId((await f.active()).sessionId))!;
    expect(() => f.control.assertWritable(planningAgent)).toThrow('只读');
    expect(set).not.toHaveBeenCalled();
    expect(await f.send('/permission read-only')).toContain('read-only');
    expect(set).toHaveBeenCalledTimes(1);
  });

  it('resolves and rechecks reminder ownership without following the current binding', async () => {
    const f = fixture();
    await f.send('/new 提醒来源');
    const original = await f.active();
    const owner = await f.control.ownerForAgent(f.agents.get(SessionId(original.sessionId))!);
    expect(await f.control.singleOwner()).toEqual(owner);
    await f.send('/new 另一个会话');
    await f.control.notifyOwner(owner, '测试提醒');
    expect(f.sent.at(-1)).toMatchObject({ target: { conversationId: 'alice' }, text: '测试提醒' });
    await expect(f.control.notifyOwner({ ...owner, key: 'wrong' }, '不可发送')).rejects.toThrow('权限');
    await f.send('/new', 'bob');
    await expect(f.control.singleOwner()).rejects.toThrow('唯一');
  });

  it('resolves planning and compaction from the owning agent preset', async () => {
    const f = fixture();
    let active = false;
    const plan = { get: () => ({ active }), set: (_agent: Agent, value: boolean) => { active = value; return 'committed'; } };
    const compactNow = vi.fn(async () => ({ shadowedSeqs: [1], shadowedTokenCount: 12 }));
    const serviceFor = vi.fn((_agent: Agent, name: string) => name === 'planMode' ? plan : name === 'compaction' ? { compactNow } : undefined);
    f.ctx.provide('agentPresets', { serviceFor } as never);
    await f.send('/new 预设服务');
    expect(await f.send('/plan')).toContain('只读规划模式');
    expect(active).toBe(true);
    expect(await f.send('/plan off')).toContain('已退出规划模式');
    expect(active).toBe(false);
    expect(await f.send('/compact')).toContain('已压缩 1');
    expect(serviceFor).toHaveBeenCalledWith(expect.anything(), 'planMode');
    expect(serviceFor).toHaveBeenCalledWith(expect.anything(), 'compaction');
  });

  it('does not acknowledge a successful new session when index persistence fails', async () => {
    const f = fixture();
    await f.send('/new 原会话');
    const previous = await f.active();
    vi.spyOn(f.index, 'track').mockImplementationOnce(async binding => (await f.index.get(binding.sessionId))!)
      .mockRejectedValueOnce(new Error('index disk full'));
    expect(await f.send('/new')).toContain('index disk full');
    expect((await f.active()).sessionId).toBe(previous.sessionId);
  });

  it('keeps failed background delivery pending and retries without resending acknowledged notifications', async () => {
    const f = fixture();
    await f.send('/goal 通知测试');
    const binding = await f.active();
    const agent = f.agents.get(SessionId(binding.sessionId))!;
    f.adapter.send.mockRejectedValueOnce(new Error('temporary transport failure'));
    f.goals.complete(agent, f.goals.get(agent)!);
    await vi.waitFor(async () => expect((await f.index.get(binding.sessionId))?.notification?.sent).toBe(false));
    await f.control.recover();
    await vi.waitFor(async () => expect((await f.index.get(binding.sessionId))?.notification?.sent).toBe(true));
    const count = f.sent.length;
    await f.control.recover();
    expect(f.sent).toHaveLength(count);
  });

  it('recovers terminal results committed while the notification observer was offline', async () => {
    const f = fixture(false);
    await f.send('/goal 重启边界测试');
    const binding = await f.active();
    const agent = f.agents.get(SessionId(binding.sessionId))!;
    f.goals.complete(agent, f.goals.get(agent)!);
    expect((await f.index.get(binding.sessionId))?.runIntent).toBe('running');
    expect((await f.index.get(binding.sessionId))?.notification).toBeUndefined();
    f.control.start();
    await f.control.recover();
    expect((await f.index.get(binding.sessionId))?.notification?.sent).toBe(true);
    expect((await f.index.get(binding.sessionId))?.goalPhase).toBe('complete');
    expect(f.sent.at(-1)?.text).toContain('已完成');
  });

  it('inherits history and no-question policy through live subagent ownership, not a guessed ID prefix', async () => {
    const f = fixture();
    await f.send('/goal 子任务归属');
    const binding = await f.active();
    const parent = f.agents.get(SessionId(binding.sessionId))!;
    const id = SessionId('delegated-without-channel-prefix');
    const child = { id, session: f.store.create(id, { meta: { cwd: '/tmp/channel-shared' } }), ctx: new Context() } as Agent;
    const detach = f.agents.enter(child, parent);
    try {
      expect(f.control.getSessionEntry(String(id))?.binding.sessionId).toBe(binding.sessionId);
      expect(f.control.getSessionEntry(String(id))?.kind).toBe('goal');
      expect(f.control.getSessionEntry('unrelated')).toBeUndefined();
    } finally { detach(); }
  });

  it('history rendering never includes tool results, reasoning or system instructions', () => {
    const events = [
      { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '用户问题' }] } },
      { type: 'user/message', data: { source: { kind: 'plugin' }, content: [{ type: 'text', text: '内部指令' }] } },
      { type: 'assistant/message', data: { message: { content: [{ type: 'reasoning', text: '隐藏思考' }, { type: 'text', text: '公开回答' }] } } },
      { type: 'tool/result', data: { secret: '工具原始数据' } },
    ] as unknown as SessionEvent[];
    expect(historyMessages(events)).toEqual(['用户：用户问题', '助手：公开回答']);
  });

  it('keeps long historical replies across display pages instead of silently truncating them', () => {
    const text = 'x'.repeat(9000) + '最后的结果';
    const events = [{ type: 'assistant/message', data: { message: { content: [{ type: 'text', text }] } } }] as unknown as SessionEvent[];
    const parts = historyMessages(events);
    expect(parts.length).toBeGreaterThan(6);
    expect(parts.map(part => part.slice('助手：'.length)).join('')).toBe(text);
  });
});

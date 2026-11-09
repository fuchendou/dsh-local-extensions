import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { formatBeijing, parseSchedule } from './time.js';
import { deliverPresentedFiles } from './delivery.js';
import { mountBriefings } from './briefing.js';

export const name = 'dsh-office-assistant';
const office = {
  documents: ['office-documents', 'Word 文档'],
  spreadsheets: ['office-spreadsheets', 'Excel 表格'],
  presentations: ['office-presentations', 'PPT 演示文稿'],
  pdf: ['office-pdf', 'PDF 文件'],
};

function definition(name, description, hint, handler) {
  return { name, description, ...(hint ? { input: { hint } } : {}), async handler(invocation) {
    try { return { kind: 'success', text: await handler(invocation) }; }
    catch (error) { return { kind: 'error', text: error instanceof Error ? error.message : '操作失败。' }; }
  } };
}

export function searchCommand(ctx) {
  return definition('search', '联网查询资料并显示来源', '<关键词>', async ({ rawInput, signal }) => {
    const query = rawInput.trim();
    if (!query || query.length > 500) throw new Error('用法：/search 关键词（最多 500 字）。');
    const result = await ctx.web.search({ query, maxResults: 5 }, signal);
    if (!result.sources.length) return '没有取得可用搜索结果，请更换关键词或稍后重试。';
    return result.sources.map((source, i) => `${i + 1}. ${source.title || source.url}\n${source.url}${source.snippet ? `\n${source.snippet}` : ''}`).join('\n\n');
  });
}

export function officeCommand(ctx, command) {
  const [skillName, label] = office[command];
  return definition(command, `处理${label}`, '[需求]', async ({ agent, rawInput, signal }) => {
    const request = rawInput.trim();
    if (!request) return `/${command} 需求：创建、阅读或修改${label}。示例：/${command} 根据当前资料制作一份报告。`;
    const skill = await ctx.skills.get(skillName, { cwd: agent.session.header.cwd, scope: agent, signal });
    if (!skill || !skill.invocation.userInvocable) throw new Error(`${label}功能未就绪。`);
    const message = createUserMessage({ content: [{ type: 'text', text: `/${skillName} ${request}` }], source: { kind: 'user' } });
    ctx.channelSessions.submitFromCommand(agent, message);
    return `已开始处理${label}，结果将在本会话回复。`;
  });
}

function resolveItem(store, query, includeArchived = false) {
  if (!query || query.length < 4) throw new Error('请提供至少 4 位待办或提醒 ID。');
  const items = store.allTodos().filter(item => (includeArchived || !item.archived) && item.id.startsWith(query));
  if (items.length !== 1) throw new Error(items.length ? 'ID 不唯一，请提供更长的 ID。' : '未找到属于你的事项。');
  return items[0];
}
function summary(item) {
  return `${item.done ? '✓' : '○'} ${item.id.slice(0, 8)} ${item.title}${item.dueAt ? ` · ${formatBeijing(item.dueAt)} 北京时间` : ''}${item.repeat ? ` · ${item.repeat === 'daily' ? '每天' : '每周'}` : ''}${item.paused ? ' · 已暂停' : ''}${item.archived ? ' · 已归档' : ''}`;
}

export function todoCommands(ctx) {
  const todo = definition('todo', '管理个人待办', '[pending|done|all|archived|add|show|edit|done|reopen|archive|restore]', async ({ agent, rawInput }) => {
    const { store } = await ctx.personalTodos.forAgent(agent);
    const [action = 'pending', ...rest] = rawInput.trim().split(/\s+/).filter(Boolean);
    if (['pending', 'done', 'all', 'archived'].includes(action) && rest.length === 0) {
      const items = store.allTodos().filter(item => action === 'archived' ? item.archived
        : !item.archived && (action === 'all' || (action === 'done' ? item.done : !item.done)));
      return `个人待办（${items.length} 项）：\n${items.map(summary).join('\n') || '暂无事项。'}`;
    }
    if (action === 'add') {
      ctx.channelSessions.assertWritable(agent);
      const title = rest.join(' ').trim();
      if (!title || title.length > 500) throw new Error('用法：/todo add 内容（最多 500 字）。');
      return `已添加：${summary(store.add({ title }))}`;
    }
    if (!['show', 'edit', 'done', 'reopen', 'archive', 'restore'].includes(action)) throw new Error('用法：/help todo');
    const id = rest.shift();
    const item = resolveItem(store, id, action === 'restore' || action === 'show');
    if (action === 'show') {
      if (rest.length) throw new Error('用法：/todo show ID');
      return `${summary(item)}${item.note ? `\n备注：${item.note}` : ''}`;
    }
    let patch;
    ctx.channelSessions.assertWritable(agent);
    if (action === 'edit') {
      const title = rest.join(' ').trim();
      if (!title || title.length > 500) throw new Error('用法：/todo edit ID 内容（最多 500 字）。');
      patch = { title };
    } else {
      if (rest.length) throw new Error('用法：/help todo');
      patch = action === 'done' ? { done: true } : action === 'reopen' ? { done: false }
        : action === 'archive' ? { archived: true } : { archived: false };
    }
    const updated = store.update(item.id, patch);
    return `已更新：${summary(updated)}`;
  });

  const remind = definition('remind', '创建或管理北京时间提醒', '<时间|pause|resume|cancel|snooze> 内容或ID', async ({ agent, rawInput }) => {
    const { store } = await ctx.personalTodos.forAgent(agent);
    ctx.channelSessions.assertWritable(agent);
    const input = rawInput.trim();
    const [action, id, extra, ...rest] = input.split(/\s+/);
    if (['pause', 'resume', 'cancel', 'snooze'].includes(action)) {
      const item = resolveItem(store, id);
      if (!item.dueAt) throw new Error('该事项没有提醒。');
      if (rest.length || (action !== 'snooze' && extra)) throw new Error('用法：/help remind');
      if (action === 'snooze') {
        const minutes = Number(extra);
        if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) throw new Error('延后时间必须为 1–1440 分钟。');
        store.snooze(item.id, minutes);
        return `已延后 ${minutes} 分钟：${item.title}。`;
      }
      const updated = store.update(item.id, action === 'cancel' ? { archived: true } : { paused: action === 'pause' });
      return `已${action === 'cancel' ? '取消' : action === 'pause' ? '暂停' : '恢复'}提醒：${summary(updated)}`;
    }
    const parsed = parseSchedule(input);
    if (parsed.title.length > 500) throw new Error('提醒内容最多 500 字。');
    const item = store.add(parsed);
    return `已创建提醒：${summary(item)}。到点只发送通知，不自动执行。`;
  });

  const reminders = definition('reminders', '分页查看个人提醒', '[页码]', async ({ agent, rawInput }) => {
    const { store } = await ctx.personalTodos.forAgent(agent);
    const value = rawInput.trim();
    if (value && !/^[1-9]\d{0,5}$/.test(value)) throw new Error('用法：/reminders [正整数页码]');
    const page = Number(value || '1');
    const all = store.allTodos().filter(item => item.dueAt && !item.done && !item.archived).sort((a, b) => a.dueAt - b.dueAt);
    const selected = all.slice((page - 1) * 8, page * 8);
    if (page > 1 && !selected.length) throw new Error('该页没有提醒。');
    return `个人提醒 ${page}/${Math.max(1, Math.ceil(all.length / 8))}（北京时间）：\n${selected.map(summary).join('\n') || '暂无提醒。'}\n待发送：${store.pendingDeliveries().length} 条。`;
  });
  return [todo, remind, reminders];
}

export function reminderTool(ctx) {
  return {
    name: 'personal_reminder',
    description: '管理个人微信提醒。所有时间使用北京时间，提醒只发通知、不执行任务。先用 clock 获取当前日期；create 的 when 使用 +10m、tomorrow 09:00、YYYY-MM-DDTHH:mm、daily 09:00 或 weekly fri 17:00。',
    parameters: { type: 'object', properties: {
      action: { type: 'string', enum: ['clock', 'create', 'list', 'pause', 'resume', 'cancel', 'snooze'] },
      when: { type: 'string', description: '创建时的北京时间或相对时间' },
      title: { type: 'string', description: '提醒内容' },
      id: { type: 'string', description: '提醒短 ID' },
      minutes: { type: 'integer', description: '延后分钟数' },
    }, required: ['action'] },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, execution) {
      if (!execution.agent) throw new Error('无法确认待办所有者。');
      if (args.action === 'clock') return `当前北京时间：${formatBeijing(Date.now())}。`;
      const [, remind, reminders] = todoCommands(ctx);
      let result;
      if (args.action === 'list') result = await reminders.handler({ agent: execution.agent, rawInput: '' });
      else if (args.action === 'create') {
        if (typeof args.when !== 'string' || typeof args.title !== 'string') throw new Error('创建提醒需要 when 和 title。');
        result = await remind.handler({ agent: execution.agent, rawInput: `${args.when} ${args.title}` });
      } else if (['pause', 'resume', 'cancel', 'snooze'].includes(args.action)) {
        if (typeof args.id !== 'string') throw new Error('请提供提醒 ID。');
        result = await remind.handler({ agent: execution.agent, rawInput: `${args.action} ${args.id}${args.action === 'snooze' ? ` ${args.minutes ?? ''}` : ''}` });
      } else throw new Error('未知提醒操作。');
      if (result.kind === 'error') throw new Error(result.text);
      return result.text;
    },
  };
}

function register(ctx, definitions) {
  const dispose = definitions.map(command => ctx.commands.register(command));
  return () => { for (const stop of dispose) stop(); };
}

export function apply(ctx, config = {}) {
  ctx.inject(['channelSessions', 'personalTodos', 'schedule', 'web', 'llm', 'tools', 'commands', 'timer'], scope => {
    scope.effect(() => mountBriefings(scope, config), 'office-assistant: daily briefings');
  });
  ctx.inject(['channelSessions', 'channelHistoryGuard'], scope => scope.effect(() => scope.on('session/event', (session, event) => {
    if (event.type !== 'deliverables/presented') return;
    const deliver = scope.channelSessions.fileDeliveryForTurn(String(session.id), event.data.turn);
    if (deliver) void deliverPresentedFiles(scope.channelHistoryGuard, session, event.data.files, deliver);
  }), 'office-assistant: channel files'));
  ctx.inject(['commands', 'web'], scope => scope.effect(() => register(scope, [searchCommand(scope)]), 'office-assistant: search'));
  ctx.inject(['commands', 'personalTodos', 'channelSessions'], scope => scope.effect(() => register(scope, todoCommands(scope)), 'office-assistant: todos'));
  ctx.inject(['tools', 'personalTodos', 'channelSessions'], scope => scope.effect(() => scope.tools.register(reminderTool(scope)), 'office-assistant: reminder tool'));
  ctx.inject(['commands', 'skills', 'channelSessions'], scope => scope.effect(() => {
    const mounted = new Map();
    let active = true;
    let revision = 0;
    const refresh = async () => {
      const current = ++revision;
      try {
        const snapshot = await scope.skills.snapshot();
        if (!active || current !== revision || !snapshot.complete) return;
        for (const [command, [skill]] of Object.entries(office)) {
          const available = snapshot.skills.some(item => item.name === skill && item.invocation.userInvocable);
          if (available && !mounted.has(command)) mounted.set(command, scope.commands.register(officeCommand(scope, command)));
          else if (!available && mounted.has(command)) { mounted.get(command)(); mounted.delete(command); }
        }
      } catch (error) { scope.logger.warn('office skill discovery failed: %s', error instanceof Error ? error.message : String(error)); }
    };
    const stop = scope.on('skills/change', () => { void refresh(); });
    void refresh();
    return () => { active = false; stop(); for (const dispose of mounted.values()) dispose(); };
  }, 'office-assistant: office commands'));
}

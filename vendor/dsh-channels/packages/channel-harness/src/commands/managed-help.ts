import type { CommandDescriptor } from '@deepseek-ai/dsh-commands';
import type { ChannelCommandLocale } from './locale.js';

interface HelpEntry {
  usage: string;
  summary: string;
  details: readonly string[];
  menuExtra?: readonly string[];
}

const zh: Record<string, HelpEntry> = {
  new: {
    usage: '/new [名称]', summary: '创建并切换到空白会话，保留共享工作文件。',
    details: ['不带名称时使用默认名称；旧会话仍可通过 /sessions 找回。', '示例：/new 工作计划', '普通会话正在运行时，请先 /stop；后台目标可继续运行。'],
  },
  session: {
    usage: '/session', summary: '查看当前会话、工作模式、模型和目标状态。',
    details: ['显示会话短 ID、名称、运行状态、模型策略；目标会话还会显示目标进度。'],
  },
  sessions: {
    usage: '/sessions [页码]', summary: '分页列出自己可访问的会话，● 表示当前会话。',
    details: ['每页最多 10 条，省略页码时显示第 1 页。', '示例：/sessions 2；复制列表中的短 ID，用 /switch 切换。'],
  },
  switch: {
    usage: '/switch 短ID', summary: '切换到自己的指定会话，恢复其上下文和设置。',
    details: ['短 ID 从 /sessions 获取，只能切换到当前用户已登记的会话。', '普通会话正在运行时，请先 /stop；切走时后台目标可继续运行。'],
  },
  history: {
    usage: '/history [短ID] [页码]', summary: '分页查看当前或指定会话的聊天记录；单独输入数字表示页码。',
    details: ['省略短 ID 查看当前会话；页码越大，记录越早，每页最多 6 条。', '示例：/history 2 查看当前会话第 2 页；/history 短ID 1 查看指定会话。', '只输入数字会被识别为页码；纯数字短 ID 需同时提供页码。历史记录不会自动加入当前模型上下文。'],
  },
  rename: {
    usage: '/rename 名称', summary: '重命名当前会话，名称最长 80 字。',
    details: ['示例：/rename 工作计划。只修改名称，不删除聊天记录。'],
  },
  compact: {
    usage: '/compact', summary: '压缩当前模型上下文，保留原始聊天记录。',
    details: ['压缩成功会报告结果；没有可压缩内容或压缩失败时会明确提示。', '目标会话执行此命令会先暂停目标，之后可用 /goal resume 恢复。'],
  },
  bind: {
    usage: '/bind 短ID', summary: '兼容旧用法；与 /switch 一样切换到本人已登记的会话。',
    details: ['建议使用 /switch 短ID；不能借此访问其他用户或未登记的会话。'],
  },
  model: {
    usage: '/model', summary: '查看当前会话的选模策略和最近使用的模型。',
    menuExtra: ['/model auto：恢复当前会话的自动选模和自动思考强度。', '/model provider model [effort]：锁定当前会话模型；参数通过 /models 查询。'],
    details: ['默认自动选模，一般无需手动设置；/model 显示当前策略和最近实际使用的模型。', '/model auto 恢复当前会话的自动选模和自动思考强度。', '/model provider model [effort] 手动锁定模型；provider、model 和可选 effort 请先通过 /models 查询并替换为实际值。', '手动设置只影响当前会话；模型或强度无效时保留原设置。'],
  },
  models: {
    usage: '/models [provider]', summary: '查看可用的模型服务商和模型；指定服务商时显示思考强度。',
    details: ['先发送 /models 获取服务商 ID，再发送 /models provider 查看该服务商的模型和支持的强度。', '模型列表获取失败会显示提示，不会改变当前设置。'],
  },
  effort: {
    usage: '/effort', summary: '查看当前模型支持的思考强度。',
    menuExtra: ['/effort 等级：设置强度并锁定当前模型。', '/effort auto：使用当前模型的默认强度，仍锁定该模型；/model auto 恢复自动选模。'],
    details: ['/effort 查看当前模型支持的等级；/effort 等级 设置其中一个等级。', '/effort auto 清除强度覆盖并使用该模型默认值，但仍锁定当前模型；/model auto 才会恢复自动选模。'],
  },
  plan: {
    usage: '/plan [需求]', summary: '进入只读规划，分析需求但不修改文件。',
    menuExtra: ['/plan off：退出规划，不执行计划。'],
    details: ['/plan 进入规划模式，再发送需求；/plan 需求 可一步进入并提交需求。', '/plan off 退出规划但不执行；确认实施时发送 /execute。', '在目标会话进入规划会先暂停目标；之后用 /execute 或 /goal resume 恢复。'],
  },
  execute: {
    usage: '/execute', summary: '退出规划并开始实施当前计划；目标会话会恢复目标。',
    details: ['请先在当前会话形成计划，再发送 /execute。此命令会开始实际执行和验证。'],
  },
  goal: {
    usage: '/goal [目标]', summary: '创建独立后台目标；不填时，下一条普通消息作为目标。',
    menuExtra: ['/goal status [短ID]：查看目标进度。', '/goal pause [短ID]：暂停目标。', '/goal resume [短ID]：恢复目标。省略短 ID 时操作当前目标。'],
    details: ['/goal 新建目标会话，下一条普通消息作为目标；/goal 目标内容 则立即创建并开始。', '/goal status [短ID] 查看进度；/goal pause [短ID] 暂停；/goal resume [短ID] 恢复。省略短 ID 时操作当前目标会话。', '切换到其他会话后目标可继续运行；遇到必要授权或外部条件缺失会阻塞并保留进度。'],
  },
  status: {
    usage: '/status', summary: '查看当前会话、运行模式、模型和目标状态。',
    details: ['与 /session 一样显示当前会话概况；可通过 /goal status 短ID 查看其他目标的进度。'],
  },
  stop: {
    usage: '/stop', summary: '立即停止当前任务；如果是目标会话，同时暂停自动续行。',
    details: ['停止的是当前会话的执行，不删除会话和记录。目标需要继续时发送 /goal resume。'],
  },
  mirror: {
    usage: '/mirror [on | off]', summary: '查看回复同步状态；on 开启、off 关闭 Web 回复同步到本对话。',
    details: ['/mirror 查看状态；/mirror on 开启，/mirror off 关闭。', '开启后，从 Web 发起的当前绑定会话的回复也会发到本对话；默认关闭。'],
  },
  permission: {
    usage: '/permission [预设]', summary: '查看或切换当前会话的文件、命令执行和审批权限。',
    details: ['/permission 查看当前预设与可选项；/permission 预设 切换到列出的预设。', '权限切换受当前部署的保护配置约束。'],
  },
  export: {
    usage: '/export', summary: '在 Web 下载当前会话及其子会话、附件的 ZIP；微信不触发下载。',
    details: ['请在 DSH Web 打开要导出的会话并输入 /export，或使用会话菜单的下载功能。', '导出由浏览器选择保存位置，不接受路径参数。'],
  },
  feedback: {
    usage: '/feedback 评价内容', summary: '为当前会话记录反馈，不会将反馈作为需求发给模型。',
    details: ['示例：/feedback 回答太简略。反馈会记录到会话日志；微信中需要填写内容。'],
  },
  version: {
    usage: '/version', summary: '查看渠道组件版本、Harness 兼容基线和更新提示。',
    details: ['更新信息不可用时，仍会显示当前版本与兼容基线。'],
  },
  help: {
    usage: '/help [指令名]', summary: '查看全部命令，或查看某个命令的详细用法。',
    details: ['示例：/help goal 或 /help /goal；参数中的方括号表示可省略，竖线表示任选一种。'],
  },
  search: { usage: '/search 关键词', summary: '联网搜索并显示来源链接。', details: ['示例：/search 深度学习入门。返回最多 5 条结果；需要综合分析时可直接用自然语言提问。'] },
  documents: { usage: '/documents [需求]', summary: '创建、阅读或修改 Word 文档。', details: ['示例：/documents 根据资料制作会议纪要。', '生成并交付工作目录内的文件；微信文件单个不超过 20 MiB。'] },
  spreadsheets: { usage: '/spreadsheets [需求]', summary: '创建、读取或修改 Excel 表格。', details: ['示例：/spreadsheets 制作一份预算表并计算合计。', '生成并交付工作目录内的文件；微信文件单个不超过 20 MiB。'] },
  presentations: { usage: '/presentations [需求]', summary: '创建或修改 PPT 演示文稿。', details: ['示例：/presentations 根据报告制作 5 页汇报。', '生成并交付工作目录内的文件；微信文件单个不超过 20 MiB。'] },
  pdf: { usage: '/pdf [需求]', summary: '创建、阅读或处理 PDF 文件。', details: ['示例：/pdf 总结刚发送的 PDF。扫描件不保证能识别文字。', '生成并交付工作目录内的文件；微信文件单个不超过 20 MiB。'] },
  todo: { usage: '/todo [pending | done | all | archived]', summary: '查看自己的待办；默认显示未完成。',
    menuExtra: ['/todo add 内容：新增待办。', '/todo show ID：查看详情；/todo edit ID 内容：修改标题。', '/todo done ID：完成；/todo reopen ID：恢复未完成。', '/todo archive ID：归档；/todo restore ID：恢复归档。'],
    details: ['示例：/todo add 周五提交周报。/todo pending 查看未完成，/todo done 查看已完成，/todo all 查看未归档，/todo archived 查看已归档。', 'ID 从列表获取，至少输入前 4 位；show、edit、done、reopen、archive、restore 后填写 ID。', '待办跨本人会话共享，但不会自动作为旧聊天内容注入新会话。'] },
  remind: { usage: '/remind 时间 内容', summary: '创建北京时间提醒，到点只通知。',
    menuExtra: ['/remind +10m 喝水：10 分钟后提醒；/remind 2026-11-05T09:00 开会：指定时间。', '/remind daily 09:00 日报：每日提醒；/remind weekly fri 17:00 周报：每周五提醒。', '/remind pause|resume|cancel ID：暂停、恢复或取消；/remind snooze ID 分钟数：延后。'],
    details: ['时间均按北京时间。支持 +10m、+2h、+1d、today 09:00、tomorrow 09:00，以及 YYYY-MM-DDTHH:mm。', '每日：/remind daily 09:00 内容；每周：/remind weekly fri 17:00 内容。星期使用 mon、tue、wed、thu、fri、sat、sun。', '使用 /reminders 查看 ID；pause、resume、cancel、snooze 可管理自己的提醒。到点只通知，不执行任务。'] },
  reminders: { usage: '/reminders [页码]', summary: '分页查看自己的提醒和待发送数量。', details: ['默认第 1 页，每页最多 8 项；所有时间均为北京时间。'] },
  brief: { usage: '/brief [on | off | status | now]', summary: '订阅、暂停或查看每天北京时间 09:00 的待办＋AI 资讯早报。',
    details: ['/brief on 开启早报并授权按订阅读取本人待办；/brief off 暂停；/brief status 查看生成与投递状态；/brief now 立即准备一次。', '/brief topics 主题1,主题2 设置 1–3 个关注主题。早报核验官方原文和日期，没有可靠新消息会明确说明。'] },
};

const en: Record<string, HelpEntry> = {
  new: { usage: '/new [name]', summary: 'Start an empty session and keep shared workspace files.', details: ['Example: /new Work plan. Previous sessions remain available via /sessions.', 'Stop an ordinary running task first; background goals may continue.'] },
  session: { usage: '/session', summary: 'Show the current session, mode, model and goal status.', details: ['Shows the short ID, name, status, model policy and any goal progress.'] },
  sessions: { usage: '/sessions [page]', summary: 'List your sessions; ● marks the current one.', details: ['There are at most 10 sessions per page. Example: /sessions 2. Use an ID from the list with /switch.'] },
  switch: { usage: '/switch shortID', summary: 'Resume one of your registered sessions and its settings.', details: ['Get the short ID from /sessions. Stop an ordinary running task first; background goals can continue.'] },
  history: { usage: '/history [shortID] [page]', summary: 'Read chat history for the current or a specified session.', details: ['Pages contain up to 6 messages; larger page numbers show older messages.', 'A single number is a page; include a page after a numeric-only short ID. History is not injected into the current model context.'] },
  rename: { usage: '/rename name', summary: 'Rename the current session, up to 80 characters.', details: ['Example: /rename Work plan. Chat history is kept.'] },
  compact: { usage: '/compact', summary: 'Compress model context while keeping the original chat history.', details: ['The result or failure is reported. A goal is paused before compaction; use /goal resume to continue.'] },
  bind: { usage: '/bind shortID', summary: 'Compatibility alias for switching to your registered session.', details: ['Prefer /switch shortID; unregistered or other users’ sessions cannot be accessed.'] },
  model: { usage: '/model', summary: 'Show the session model policy and last-used model.', menuExtra: ['/model auto: Restore automatic selection and reasoning effort.', '/model provider model [effort]: Lock this session to a model; use /models to find values.'], details: ['Automatic selection is the default. /model shows the policy and last-used model; /model auto restores automatic selection.', 'Use /models to find valid provider, model and optional effort values. Manual changes affect only this session.'] },
  models: { usage: '/models [provider]', summary: 'List providers and models; specify a provider to see reasoning efforts.', details: ['Run /models first, then /models provider using an ID from the list.'] },
  effort: { usage: '/effort', summary: 'List supported reasoning levels for the current model.', menuExtra: ['/effort level: Set the level and lock the current model.', '/effort auto: Use the model default but keep the model locked; /model auto restores automatic selection.'], details: ['/effort lists supported levels. /effort auto clears the effort override but keeps the model locked; /model auto restores automatic selection.'] },
  plan: { usage: '/plan [request]', summary: 'Enter read-only planning without modifying files.', menuExtra: ['/plan off: Exit planning without executing.'], details: ['/plan request also submits the request. Use /execute to implement the plan.', 'Planning pauses a goal; /execute or /goal resume resumes it.'] },
  execute: { usage: '/execute', summary: 'Exit planning and implement the current plan, or resume the current goal.', details: ['Form a plan in this session before starting implementation and verification.'] },
  goal: { usage: '/goal [objective]', summary: 'Create an independent background goal; omit the objective to send it next.', menuExtra: ['/goal status [shortID]: Show goal progress.', '/goal pause [shortID]: Pause the goal.', '/goal resume [shortID]: Resume the goal; omit the ID for the current goal.'], details: ['/goal creates a session and uses the next ordinary message as the objective; /goal objective starts immediately.', '/goal status, /goal pause and /goal resume accept an optional short ID; otherwise they use the current goal session.', 'The goal may continue after switching sessions and stops when necessary authorization or external conditions are missing.'] },
  status: { usage: '/status', summary: 'Show the current session, mode, model and goal status.', details: ['This shows the same overview as /session. Use /goal status shortID for another goal.'] },
  stop: { usage: '/stop', summary: 'Stop the current task and pause automatic goal continuation.', details: ['The session and history remain available. Resume a goal with /goal resume.'] },
  mirror: { usage: '/mirror [on | off]', summary: 'Inspect or change reply mirroring for this conversation.', details: ['/mirror shows the state; /mirror on and /mirror off change it. Web-initiated replies in the bound session are mirrored when enabled.'] },
  permission: { usage: '/permission [preset]', summary: 'Inspect or change the current session permission preset.', details: ['/permission lists the current and available presets; /permission preset selects one. Deployment protections still apply.'] },
  export: { usage: '/export', summary: 'Download the current session and attachments as ZIP from Web; not from WeChat.', details: ['Open the session in DSH Web and run /export or use its download menu. A path argument is not accepted.'] },
  feedback: { usage: '/feedback text', summary: 'Record session feedback without sending it to the model.', details: ['Example: /feedback The answer was too short. On a channel, feedback text is required.'] },
  version: { usage: '/version', summary: 'Show the channel bundle version, Harness baseline and update hint.', details: ['The version and baseline remain available if update information cannot be fetched.'] },
  help: { usage: '/help [command]', summary: 'List commands or show detailed help for one command.', details: ['Example: /help goal or /help /goal. Brackets mark optional arguments; | separates alternatives.'] },
  search: { usage: '/search query', summary: 'Search the web and show source links.', details: ['Example: /search machine learning. Up to five results are returned.'] },
  documents: { usage: '/documents [request]', summary: 'Create, read or edit Word documents.', details: ['Example: /documents create meeting notes.'] },
  spreadsheets: { usage: '/spreadsheets [request]', summary: 'Create, read or edit Excel workbooks.', details: ['Example: /spreadsheets create a budget.'] },
  presentations: { usage: '/presentations [request]', summary: 'Create or edit PowerPoint presentations.', details: ['Example: /presentations create a five-slide summary.'] },
  pdf: { usage: '/pdf [request]', summary: 'Create, read or process PDF files.', details: ['Example: /pdf summarize the attached file. Scanned pages may require OCR.'] },
  todo: { usage: '/todo [pending | done | all | archived]', summary: 'Show your personal todos.', details: ['/todo add text creates a todo; show, edit, done, reopen, archive and restore operate on an ID from the list.', '/todo all excludes archived items; /todo archived lists them.'] },
  remind: { usage: '/remind time text', summary: 'Create a notification using Beijing time.', details: ['Examples: /remind +10m break; /remind daily 09:00 report; /remind weekly fri 17:00 report.', 'Use pause, resume, cancel or snooze with an ID from /reminders. Reminders do not execute tasks.'] },
  reminders: { usage: '/reminders [page]', summary: 'List your reminders and pending deliveries.', details: ['Times are shown in Beijing time.'] },
  brief: { usage: '/brief [on | off | status | now]', summary: 'Manage a daily todo and AI briefing at 09:00 Beijing time.', details: ['on subscribes and authorizes reading your todos; off pauses; status shows generation and delivery; now prepares one briefing.', '/brief topics topic1,topic2 sets up to three topics.'] },
};

const sections = [
  ['会话与上下文', 'Sessions and context', ['new', 'session', 'sessions', 'switch', 'history', 'rename', 'compact', 'bind']],
  ['模型与思考强度', 'Models and reasoning', ['model', 'models', 'effort']],
  ['规划与后台目标', 'Planning and goals', ['plan', 'execute', 'goal']],
  ['联网查询', 'Web search', ['search']],
  ['办公文件', 'Office files', ['documents', 'spreadsheets', 'presentations', 'pdf']],
  ['待办与提醒', 'Todos and reminders', ['todo', 'remind', 'reminders', 'brief']],
  ['状态与停止', 'Status and stopping', ['status', 'stop']],
  ['其他功能', 'Other commands', ['mirror', 'permission', 'export', 'feedback', 'version', 'help']],
] as const;

export function managedCommandHelp(locale: ChannelCommandLocale, name: string): string | undefined {
  const entry = (locale === 'zh' ? zh : en)[name];
  if (!entry) return undefined;
  return [entry.usage + '：' + entry.summary, ...entry.details].join('\n\n');
}

export function managedUsageFor(name: string, hint?: string): string {
  return '/' + name + (hint ? ' ' + hint.replace(/</g, '〈').replace(/>/g, '〉') : '');
}

export function renderManagedHelp(locale: ChannelCommandLocale, defs: readonly CommandDescriptor[]): string {
  const entries = locale === 'zh' ? zh : en;
  const byName = new Map(defs.map(def => [def.name, def]));
  const displayed = new Set<string>();
  const lines = locale === 'zh'
    ? ['【命令使用指南】', '方括号 [ ] 内的参数可省略，未括起的参数和 〈 〉 内的参数为必填，| 表示任选一项；请将参数替换为实际内容。发送 /help 指令名 查看详细用法，例如 /help goal。']
    : ['【Command guide】', 'Arguments in [ ] are optional; unbracketed arguments and those in 〈 〉 are required. | separates alternatives. Replace parameter names with actual values. Send /help command for details, e.g. /help goal.'];
  for (const [zhTitle, enTitle, names] of sections) {
    const available = names.filter(name => byName.has(name));
    if (!available.length) continue;
    lines.push(`【${locale === 'zh' ? zhTitle : enTitle}】`);
    for (const name of available) {
      const entry = entries[name]!;
      displayed.add(name);
      lines.push(entry.usage + '：' + entry.summary);
      lines.push(...(entry.menuExtra ?? []));
    }
  }
  const extra = defs.filter(def => !displayed.has(def.name));
  if (extra.length) {
    lines.push(locale === 'zh' ? '【其他已注册命令】' : '【Other registered commands】');
    for (const def of extra) {
      const usage = managedUsageFor(def.name, def.input?.hint);
      lines.push(usage + '：' + (def.description ?? (locale === 'zh' ? '暂无说明，请使用 /help 指令名 查看。' : 'No description; use /help command for details.')));
    }
  }
  return lines.join('\n\n');
}

/**
 * dsh-smart-router — 自动任务分类与模型路由（零依赖本地 Cordis 插件）
 *
 * 在消息入队前分类，通过 agent/inbox/claimed 同步选择本步模型。
 *
 * 已验证的 provider/model（2026-10）：
 *   - deepseek-official/deepseek-flash   快、支持图片输入（effort low/high/max）
 *   - deepseek-official/deepseek-v4-pro  旗舰、纯文本（effort low/high/max）
 *   - minimax-cn/MiniMax-M3.1-Flash      用户当前默认模型
 */

export const name = 'smart-router';

import { appendFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QUALITY_GUIDANCE } from './quality.js';

const LOG_FILE = process.env.SMART_ROUTER_LOG
  ?? join(dirname(fileURLToPath(import.meta.url)), 'router.log');

// 运行时默认只输出 warning 级日志，路由决策写独立日志文件便于随时查看
async function logFile(line) {
  try {
    await appendFile(LOG_FILE, `${new Date().toISOString()} ${line}\n`);
    const s = await stat(LOG_FILE);
    if (s.size > 4 * 1024 * 1024) await writeFile(LOG_FILE, '');
  } catch { /* 日志失败不影响路由 */ }
}

const TASK_TYPES = ['chat', 'quick_task', 'coding', 'doc_writing', 'research', 'reply_advice'];

const DEFAULTS = {
  enabled: true,
  minConfidence: 0.6,
  classifierTimeoutMs: 4000,
  classifier: {
    backend: 'deepseek',
    baseURL: 'https://api.deepseek.com',
    model: 'deepseek-flash',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    // Jev (TypeSafe System One) 预留：拿到 key 后把 backend 改为 'jev' 即可
    jevBaseURL: 'https://api.typesafe.ai',
    jevModel: 'jev-latest',
    jevApiKeyEnv: 'TYPESAFE_API_KEY',
  },
  routes: {
    // null = 不改写，使用默认模型（当前 minimax-cn / MiniMax-M3.1-Flash）
    chat: null,
    quick_task: { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'low' },
    coding: { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'high' },
    // flash 支持图片输入，正好用于群聊截图 / 转发内容分析
    reply_advice: { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'high' },
    doc_writing: { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'high' },
    research: { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'max' },
  },
  depthRoutes: {
    high: { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'high' },
    max: { provider: 'deepseek-official', model: 'deepseek-v4-pro', reasoningEffort: 'max' },
    vision: { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'max' },
    technical: { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'max' },
    technicalMax: { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'max' },
  },
};

const CLASSIFY_SYSTEM_PROMPT = [
  '你是一个任务路由分类器，负责把用户发给 AI 助手的消息分类，以便系统选择合适的模型。只输出 JSON，不要输出任何其他内容。',
  '',
  'task_type 六选一：',
  '- chat: 日常闲聊、问候、简单问答、翻译、改写等轻量对话',
  '- quick_task: 明确、单步的工具型任务（查天气、查服务器状态、设置提醒、简单查询）',
  '- coding: 编程、调试、脚本、技术配置相关',
  '- doc_writing: 写文章、写报告、长文案、正式文书',
  '- research: 复杂分析、多角度调研、方案比较、决策支持',
  '- reply_advice: 转发的聊天记录/群聊截图等，请求总结、代拟回复或给回复建议',
  '',
  'complexity: 0-3 整数（0 最简单，3 最复杂）。',
  '输入可能包含本会话最近的用户需求，仅用于识别当前追问的目标和复杂度。以“当前需求”为分类对象；“继续、再具体一点”等追问沿用相关任务的类型与复杂度，明确换题则重新判断。',
  'confidence: 0 到 1 的小数，表示分类把握。',
  '',
  '输出格式：{"task_type": "...", "complexity": 0, "confidence": 0.0}',
].join('\n');

export function apply(ctx, config) {
  const cfg = mergeConfig(config);
  const logger = ctx.logger('smart-router');
  if (!cfg.enabled) {
    logger.info('disabled by config');
    return;
  }

  const states = new WeakMap();
  const channelEntry = agent => ctx.get?.('channelSessions')?.getSessionEntry?.(String(agent.id));
  const defaultSelection = () => ctx.get?.('agentDefaultModel')?.currentSelection();

  function stateFor(agent) {
    let state = states.get(agent);
    if (!state) {
      const history = agent.session?.snapshotEvents?.() ?? [];
      state = {
        pending: new Map(),
        recent: [],
        vision: history.some(event => event.type === 'user/message'
          && extractContent(event.data?.message ?? event.data).attachments > 0),
      };
      states.set(agent, state);
    }
    return state;
  }

  async function prepare(agent, message, signal) {
    const entry = channelEntry(agent);
    if (entry?.managed || entry?.routine || entry?.modelPolicy?.mode === 'manual') return;
    if (message.source?.kind && !['user', 'goal', 'schedule'].includes(message.source.kind)) return;
    const { text, attachments } = extractContent(message);
    const skill = /^\/office-(documents|spreadsheets|presentations|pdf)\s+([\s\S]+)/.exec(text);
    if ((!text && !attachments) || (text.startsWith('/') && !skill) || signal?.aborted) return;

    const state = stateFor(agent);
    if (state.manual || state.manualPending) return;
    const current = skill ? skill[2] : text;
    const input = `${state.recent.length ? `本会话最近需求（仅作上下文）：\n${state.recent.join('\n')}\n\n` : ''}当前需求：\n`
      + (attachments ? `[带 ${attachments} 个图片/文件附件] ` : '') + current.slice(0, 4000);
    const classified = skill
      ? { task_type: 'doc_writing', complexity: 2, confidence: 1 }
      : await withTimeout(classify(input, cfg, ctx, signal).catch(error => {
        if (!signal?.aborted) {
          logger.warn('classify failed (fail-open):', error?.message ?? error);
          void logFile(`classify failed: ${error?.message ?? error}`);
        }
        return null;
      }), cfg.classifierTimeoutMs, null);
    if (signal?.aborted || states.get(agent) !== state) return;
    state.pending.set(messageKey(message), { classified, current, text, attachments });
    while (state.pending.size > 256) state.pending.delete(state.pending.keys().next().value);
  }

  const router = {
    prepare,
    discard(agent, message) {
      states.get(agent)?.pending.delete(messageKey(message));
    },
    markManual(agent) {
      stateFor(agent).manual = true;
    },
  };
  ctx.provide('personalModelRouter', router);
  ctx.inject?.(['channelSessions'], (scope) => {
    scope.effect(() => scope.get('channelSessions').registerAutomaticRouter(prepare));
  });
  ctx.inject?.(['systemPrompt'], scope => {
    scope.effect(() => scope.systemPrompt.section({ name: 'personalai:answer-quality', order: 205, text: QUALITY_GUIDANCE }));
  });

  ctx.on('agent/inbox/claimed', ({ agent, message, turn }) => {
    try {
      const state = stateFor(agent);
      const key = messageKey(message);
      let prepared = state.pending.get(key);
      state.pending.delete(key);
      if (prepared) {
        const { text, attachments } = extractContent(message);
        if (prepared.text !== text || prepared.attachments !== attachments) prepared = undefined;
      }
      const entry = channelEntry(agent);
      if (entry?.managed || entry?.routine || entry?.modelPolicy?.mode === 'manual' || state.manual) return;
      if (!prepared && turn === state.turn) return;
      state.turn = turn;

      if (prepared) {
        state.vision ||= prepared.attachments > 0;
        if (message.source?.kind !== 'schedule') state.recent = [...state.recent, prepared.current.slice(0, 700)].slice(-3);
      }
      const decision = prepared?.classified;
      const route = decision && decision.confidence >= cfg.minConfidence
        ? selectRoute(decision, state.vision, cfg) : null;
      const current = agent.model.current();
      if (!state.applied || !sameSelection(current, state.applied)) state.baseline = current;
      const fallback = entry ? defaultSelection() ?? state.baseline : state.baseline ?? defaultSelection();
      const selected = route ?? fallback;
      if (selected?.provider && selected.model && !sameSelection(current, selected)) agent.model.select(selected);
      state.applied = selected;
      if (route) {
        const line = `route: type=${decision.task_type} complexity=${decision.complexity} confidence=${decision.confidence}`
          + ` -> ${route.provider}/${route.model}${route.reasoningEffort ? ` effort=${route.reasoningEffort}` : ''}`;
        logger.info(line);
        void logFile(line);
      }
    } catch (error) {
      logger.warn('inbox/claimed selection failed (fail-open):', error?.message ?? error);
    }
  });
  ctx.on('agent/inbox/discarded', ({ agent, message }) => router.discard(agent, message));
  ctx.on('agent/disposed', ({ agent }) => states.delete(agent));
  ctx.on('agent/status', ({ agent, status }) => {
    const state = states.get(agent);
    if (status !== 'idle' || !state?.applied || !state.baseline || state.manual || channelEntry(agent)) return;
    try {
      const current = agent.model.current();
      if (sameSelection(current, state.applied) && !sameSelection(current, state.baseline)) agent.model.select(state.baseline);
      state.applied = undefined;
    } catch (error) {
      logger.warn('unable to restore Web session model:', error?.message ?? error);
    }
  });
  logger.info(`smart-router ready (backend=${cfg.classifier.backend}, minConfidence=${cfg.minConfidence})`);
  void logFile(`smart-router ready (backend=${cfg.classifier.backend}, minConfidence=${cfg.minConfidence})`);
}

export function selectRoute(decision, hasAttachments = false, config) {
  const cfg = mergeConfig(config);
  const base = cfg.routes[decision.task_type];
  if (hasAttachments) {
    return decision.complexity >= 2 ? cfg.depthRoutes.vision : { ...cfg.depthRoutes.vision, reasoningEffort: 'high' };
  }
  if (base === null && decision.complexity < 2) return null;
  if (decision.complexity >= 2 && ['coding', 'reply_advice'].includes(decision.task_type)) {
    return decision.complexity === 3 ? cfg.depthRoutes.technicalMax : cfg.depthRoutes.technical;
  }
  if (decision.complexity === 3 || decision.task_type === 'research') return cfg.depthRoutes.max;
  if (decision.complexity >= 2) return cfg.depthRoutes.high;
  return base;
}

function messageKey(message) {
  return message.source?.kind === 'user' && message.source.rpcId
    ? `rpc:${message.source.rpcId}` : `message:${message.id}`;
}

function sameSelection(a, b) {
  return a?.provider === b?.provider && a?.model === b?.model && a?.reasoningEffort === b?.reasoningEffort;
}

// ---------- 分类后端 ----------

async function classify(text, cfg, ctx, parentSignal) {
  const timeout = AbortSignal.timeout(cfg.classifierTimeoutMs);
  const signal = parentSignal ? AbortSignal.any([parentSignal, timeout]) : timeout;
  if (cfg.classifier.backend === 'harness') {
    const llm = ctx.get?.('llm');
    if (!llm) throw new Error('classification provider is unavailable');
    let output = '';
    let finished = false;
    for await (const chunk of llm.stream({ provider: cfg.classifier.provider, model: cfg.classifier.model,
      reasoningEffort: cfg.classifier.reasoningEffort ?? 'low', maxTokens: 2048,
      system: CLASSIFY_SYSTEM_PROMPT, messages: [{ role: 'user', content: [{ type: 'text', text: text.slice(0, 6500) }] }],
      signal,
    })) {
      if (chunk.type === 'text-delta') { output += chunk.text; if (output.length > 4000) throw new Error('classifier output too long'); }
      if (chunk.type === 'finish') { if (chunk.reason?.kind !== 'stop') throw new Error('classifier output incomplete'); finished = true; }
    }
    if (!finished) return null;
    return normalizeDecision(JSON.parse(output.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')));
  }
  return cfg.classifier.backend === 'jev' ? classifyJev(text, cfg, signal) : classifyDeepSeek(text, cfg, signal);
}

async function classifyDeepSeek(text, cfg, signal) {
  const key = process.env[cfg.classifier.apiKeyEnv];
  if (!key) throw new Error(`env ${cfg.classifier.apiKeyEnv} is not set`);
  const url = trimSlash(cfg.classifier.baseURL) + '/chat/completions';
  const base = {
    model: cfg.classifier.model,
    // deepseek-flash 会先消耗推理 token（实测 low effort ~170-200），
    // 预算太小会把 JSON 输出截断，512 是实测安全值
    max_tokens: 512,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: CLASSIFY_SYSTEM_PROMPT },
      { role: 'user', content: text.slice(0, 6500) },
    ],
  };
  let res = await postJson(url, key, { ...base, reasoning_effort: 'low' }, signal);
  if (res.status === 400) {
    // 端点不认识 reasoning_effort 参数时降级重试
    res = await postJson(url, key, base, signal);
  }
  if (!res.ok) throw new Error(`deepseek HTTP ${res.status}`);
  const choice = res.json?.choices?.[0];
  if (choice?.finish_reason === 'length') throw new Error('classifier output truncated (finish_reason=length)');
  const content = choice?.message?.content ?? '{}';
  return normalizeDecision(JSON.parse(content));
}

// Jev (TypeSafe AI) System One 决策 API：choice 出分类，score 出复杂度
async function classifyJev(text, cfg, signal) {
  const key = process.env[cfg.classifier.jevApiKeyEnv];
  if (!key) throw new Error(`env ${cfg.classifier.jevApiKeyEnv} is not set`);
  const url = trimSlash(cfg.classifier.jevBaseURL) + '/v1/systemone';
  const res = await postJson(url, key, {
    model: cfg.classifier.jevModel,
    state: text.slice(0, 8000),
    questions: {
      task_type: {
        type: 'choice',
        instructions: '这条发给 AI 助手的消息属于哪类任务',
        criteria: {
          chat: '日常闲聊、问候、简单问答、翻译、改写等轻量对话',
          quick_task: '明确、单步的工具型任务（查天气、查服务器状态、设置提醒、简单查询）',
          coding: '编程、调试、脚本、技术配置相关',
          doc_writing: '写文章、写报告、长文案、正式文书',
          research: '复杂分析、多角度调研、方案比较、决策支持',
          reply_advice: '转发的聊天记录或群聊截图，请求总结、代拟回复或给回复建议',
        },
      },
      complexity: {
        type: 'score',
        instructions: '任务复杂程度',
        criteria: ['极简单，一步直答', '简单，需要少量工具或检索', '较复杂，多步骤或需要分析', '非常复杂，需要深度推理或长文产出'],
      },
    },
  }, signal);
  if (!res.ok) throw new Error(`jev HTTP ${res.status}`);
  const answers = res.json?.answers ?? {};
  return normalizeDecision({
    task_type: answers.task_type?.choice,
    complexity: answers.complexity?.score,
    confidence: answers.task_type?.confidence,
  });
}

// ---------- 工具函数 ----------

async function postJson(url, key, body, signal) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
    signal,
  });
  const bodyText = await res.text().catch(() => '');
  let json = null;
  try { json = JSON.parse(bodyText); } catch { /* 保持 null */ }
  return { status: res.status, ok: res.ok, bodyText, json };
}

function normalizeDecision(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  const task_type = TASK_TYPES.includes(parsed.task_type) ? parsed.task_type : null;
  if (!task_type) return null;
  const complexity = Math.min(3, Math.max(0, Number.parseInt(parsed.complexity ?? 1, 10) || 0));
  const confidence = Math.min(1, Math.max(0, Number(parsed.confidence ?? 0) || 0));
  return { task_type, complexity, confidence };
}

function extractContent(message) {
  const content = message?.content ?? message?.text ?? message?.parts;
  const parts = Array.isArray(content) ? content : typeof content === 'string' ? [content] : [];
  let text = '';
  let attachments = 0;
  for (const part of parts) {
    if (typeof part === 'string') { text += part; continue; }
    if (!part || typeof part !== 'object') continue;
    if (part.type === 'text' && typeof part.text === 'string') {
      text += part.text;
    } else if (typeof part.text === 'string' && (part.type === undefined || part.type === null)) {
      text += part.text;
    } else if (part.type && part.type !== 'text') {
      attachments++;
    }
  }
  return { text: text.trim(), attachments };
}

function withTimeout(promise, ms, fallback) {
  let timer;
  return Promise.race([promise, new Promise(resolve => { timer = setTimeout(() => resolve(fallback), ms); })])
    .finally(() => clearTimeout(timer));
}

function trimSlash(s) {
  return String(s ?? '').replace(/\/+$/, '');
}

function mergeConfig(overrides) {
  const cfg = structuredClone(DEFAULTS);
  if (!overrides || typeof overrides !== 'object') return cfg;
  for (const [key, value] of Object.entries(overrides)) {
    if (key === 'classifier' && value && typeof value === 'object') Object.assign(cfg.classifier, value);
    else if (['routes', 'depthRoutes'].includes(key) && value && typeof value === 'object') Object.assign(cfg[key], value);
    else cfg[key] = value;
  }
  return cfg;
}

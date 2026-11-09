import { createHash } from 'node:crypto';
import { formatBeijing } from './time.js';

const DAY = 86_400_000;
const OFFICIAL_DOMAINS = ['openai.com', 'anthropic.com', 'deepseek.com', 'minimaxi.com', 'minimax.io',
  'ai.google.dev', 'blog.google', 'developers.googleblog.com', 'microsoft.com', 'huggingface.co',
  'qwen.ai', 'qwenlm.github.io', 'modelscope.cn', 'vllm.ai', 'pytorch.org', 'kubernetes.io'];
const GITHUB_ORGS = ['openai', 'anthropics', 'deepseek-ai', 'microsoft', 'google', 'google-deepmind',
  'huggingface', 'qwenlm', 'vllm-project', 'tencent', 'langchain-ai', 'kubernetes'];
const QUERY_SOURCES = '(site:openai.com OR site:anthropic.com OR site:deepseek.com OR site:minimax.io OR site:github.com OR site:huggingface.co/blog)';

export function officialUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return undefined;
    const host = url.hostname.toLowerCase();
    if (host === 'huggingface.co' && !url.pathname.startsWith('/blog/')) return undefined;
    if (host === 'github.com') {
      if (!GITHUB_ORGS.includes(url.pathname.split('/')[1]?.toLowerCase())) return undefined;
    } else if (!OFFICIAL_DOMAINS.some(domain => host === domain || host.endsWith('.' + domain))) return undefined;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key);
    return url.href;
  } catch { return undefined; }
}

function publishedAt(content, url, now) {
  const patterns = [
    /<meta\b(?=[^>]*(?:property|name)=["'](?:article:published_time|datePublished)["'])(?=[^>]*content=["']([^"']+)["'])[^>]*>/gi,
    /["']datePublished["']\s*:\s*["']([^"']+)["']/gi,
    /<time\b(?=[^>]*itemprop=["']datePublished["'])(?=[^>]*datetime=["']([^"']+)["'])[^>]*>/gi,
    ...(url.includes('github.com/') && url.includes('/releases/tag/') ? [/<relative-time\b[^>]*datetime=["']([^"']+)["']/gi] : []),
  ];
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      if (!/^\d{4}-\d{2}-\d{2}(?:T.*(?:Z|[+-]\d{2}:\d{2}))?$/.test(match[1])) continue;
      const stamp = Date.parse(match[1].length === 10 ? match[1] + 'T00:00:00+08:00' : match[1]);
      if (stamp <= now && stamp >= now - DAY) return new Date(stamp).toISOString();
    }
  }
  return undefined;
}

function plainText(content) {
  return content.replace(/<(script|style|nav|header|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
}

export async function collectBriefingSources(web, topics, now, signal, seen = []) {
  const candidates = new Map();
  let failures = 0;
  for (const topic of topics.slice(0, 3)) {
    signal?.throwIfAborted();
    try {
      const result = await web.search({ query: `${topic} (发布 OR release OR announcement) ${new Date(now).toISOString().slice(0, 7)} ${QUERY_SOURCES}`, maxResults: 5 }, signal);
      for (const source of (Array.isArray(result?.sources) ? result.sources : [])) {
        const url = officialUrl(source?.url);
        if (url && !seen.includes(url)) candidates.set(url, typeof source.title === 'string' ? source.title.slice(0, 120) : url);
      }
    } catch { signal?.throwIfAborted(); failures++; }
  }
  const sources = [];
  for (const [url, title] of [...candidates].slice(0, 10)) {
    signal?.throwIfAborted();
    try {
      const page = await web.fetch({ url }, signal);
      const finalUrl = officialUrl(page?.url);
      const content = page?.body?.content;
      if (!finalUrl || seen.includes(finalUrl) || page.statusCode < 200 || page.statusCode >= 300 || typeof content !== 'string' || page.truncated) continue;
      const date = publishedAt(content, finalUrl, now);
      const text = plainText(content);
      if (!date || text.length < 100 || sources.some(source => source.url === finalUrl)) continue;
      sources.push({ id: createHash('sha256').update(finalUrl).digest('hex').slice(0, 16),
        url: finalUrl, title, publishedAt: date, text: text.slice(0, 6000) });
    } catch { signal?.throwIfAborted(); failures++; }
    if (sources.length >= 6) break;
  }
  return { sources, failures, checkedAt: now };
}

export function todoSnapshot(items, now) {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const pending = items.filter(item => !item.done && !item.archived);
  const day = stamp => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(stamp);
  const today = pending.filter(item => !item.paused && item.dueAt && day(item.dueAt) === date)
    .sort((a, b) => a.dueAt - b.dueAt || a.createdAt - b.createdAt);
  const ordered = [...today, ...pending.filter(item => !today.includes(item)).sort((a, b) => a.createdAt - b.createdAt)];
  return { asOf: now, count: pending.length, today: today.length, items: ordered.slice(0, 5).map(item => ({
    id: item.id.slice(0, 8), title: item.title.slice(0, 80),
    ...(item.dueAt && !item.paused ? { reminderAt: item.dueAt } : {}),
  })) };
}

function field(value, limit) {
  if (typeof value !== 'string' || !value.trim() || value.length > limit || /https?:\/\/|[\u0000-\u0008]/i.test(value)) throw new Error('简报字段无效或超过长度限制。');
  return value.trim();
}

export function validateBriefingNews(input, sources) {
  if (!Array.isArray(input) || input.length > 3) throw new Error('简报最多包含 3 条资讯。');
  const used = new Set();
  return input.map(item => {
    const source = sources.find(source => source.id === item?.sourceId);
    if (!source || used.has(source.id)) throw new Error('资讯来源未读取或重复。');
    used.add(source.id);
    return { sourceId: source.id, summary: field(item.summary, 240), relevance: field(item.relevance, 180),
      action: field(item.action, 160), title: source.title, url: source.url, publishedAt: source.publishedAt };
  });
}

export function renderBriefing(date, snapshot, news = [], unavailable = false) {
  const lines = [`【每日早报】${date} 北京时间`, `待办：${snapshot.count} 项未完成；今天已设提醒 ${snapshot.today} 项。`];
  if (snapshot.asOf) lines.push(`待办截至 ${formatBeijing(snapshot.asOf)} 北京时间。`);
  if (snapshot.items.length) lines.push(snapshot.items.map(item => `○ ${item.id} ${item.title}${item.reminderAt ? ` · 提醒 ${formatBeijing(item.reminderAt)}` : ''}`).join('\n'));
  else lines.push('当前没有未完成待办。');
  lines.push('提醒时间用于通知，不代表任务截止时间。');
  if (!news.length) lines.push(unavailable ? '资讯暂不可用，本次先提供待办摘要。' : '过去 24 小时未找到已核验日期且值得推送的官方新消息。');
  for (const item of news) lines.push(`${item.title}\n${item.summary}\n影响：${item.relevance}\n建议：${item.action}\n发布：${item.publishedAt.slice(0, 10)}\n${item.url}`);
  lines.push('用 /todo done ID 完成事项；/brief status 查看记录，/brief off 暂停早报。');
  return lines.join('\n\n');
}

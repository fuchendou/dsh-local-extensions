const CHINA_OFFSET = 8 * 60 * 60_000;
const DAY = 24 * 60 * 60_000;
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export function formatBeijing(timestamp) {
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(timestamp).replaceAll('/', '-');
}

export function parseSchedule(input, now = Date.now()) {
  const parts = input.trim().split(/\s+/);
  const mode = parts.shift() ?? '';
  let dueAt;
  let repeat;
  const relative = /^\+(\d{1,6})(m|h|d)$/i.exec(mode);
  const absolute = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(mode);
  if (relative) {
    const count = Number(relative[1]);
    const unit = { m: 60_000, h: 60 * 60_000, d: DAY }[relative[2].toLowerCase()];
    if (!count || count * unit > 366 * DAY) throw new Error('相对时间必须在 1 分钟至 366 天之间。');
    dueAt = now + count * unit;
  } else if (absolute) {
    const [year, month, day, hour, minute] = absolute.slice(1).map(Number);
    const utc = Date.UTC(year, month - 1, day, hour, minute);
    const check = new Date(utc);
    if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day
        || hour > 23 || minute > 59) throw new Error('日期或时间无效。');
    dueAt = utc - CHINA_OFFSET;
  } else if (['daily', 'weekly', 'today', 'tomorrow'].includes(mode)) {
    const weekday = mode === 'weekly' ? WEEKDAYS.indexOf((parts.shift() ?? '').toLowerCase()) : undefined;
    if (weekday === -1) throw new Error('星期请使用 mon、tue、wed、thu、fri、sat 或 sun。');
    const time = /^(\d{2}):(\d{2})$/.exec(parts.shift() ?? '');
    if (!time || Number(time[1]) > 23 || Number(time[2]) > 59) throw new Error('时间请使用 HH:mm。');
    const china = new Date(now + CHINA_OFFSET);
    let start = Date.UTC(china.getUTCFullYear(), china.getUTCMonth(), china.getUTCDate(), Number(time[1]), Number(time[2])) - CHINA_OFFSET;
    if (weekday !== undefined) start += ((weekday - china.getUTCDay() + 7) % 7) * DAY;
    if (mode === 'tomorrow') start += DAY;
    else if (start <= now && (mode === 'daily' || mode === 'weekly')) start += (mode === 'daily' ? 1 : 7) * DAY;
    dueAt = start;
    if (mode === 'daily' || mode === 'weekly') repeat = mode;
  } else {
    throw new Error('用法：/remind +10m 内容、/remind 2026-11-05T09:00 内容、/remind daily 09:00 内容，或 /remind weekly fri 09:00 内容。');
  }
  const title = parts.join(' ').trim();
  if (!title) throw new Error('请填写提醒内容。');
  if (!Number.isSafeInteger(dueAt) || dueAt <= now) throw new Error('提醒时间必须晚于现在。');
  return { dueAt, title, ...(repeat ? { repeat } : {}) };
}

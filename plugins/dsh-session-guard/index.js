import Schema from '@deepseek-ai/schemastery';
import { protectedRoots, configuredProtectedPaths, deniedPath } from './paths.js';

export const name = 'channel-session-guard';
export const inject = ['tools'];
export const Config = Schema.object({
  protectedDataHomes: Schema.array(Schema.string()).default([]),
  protectedPaths: Schema.array(Schema.string()).default([]),
});

const pathKeys = new Set(['path', 'paths', 'pattern', 'file_path', 'filePath', 'directory', 'cwd', 'root', 'old_path', 'new_path']);
const historyTools = /(?:^|_)(?:read|search|list|get)_sessions?(?:$|_)/;
const processTools = new Set(['bash', 'bash_persistent', 'run_code', 'run_python', 'python', 'shell', 'powershell', 'pwsh']);

function pathsIn(value, key = '') {
  if (typeof value === 'string') return pathKeys.has(key) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(item => pathsIn(item, key));
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => pathsIn(v, k));
  return [];
}

export function apply(ctx, config = {}) {
  const assertReadable = (path, cwd) => {
    const sessions = ctx.get('channelSessions');
    const roots = protectedRoots([...(sessions?.getProtectedPaths?.() ?? []), ...configuredProtectedPaths(config.protectedPaths)], config.protectedDataHomes ?? []);
    if (deniedPath(path, cwd, roots)) throw new Error('不可读取受保护的数据。');
  };
  ctx.provide?.('channelHistoryGuard', { assertReadable });
  ctx.on('tools/pre-execute', async (execution, next) => {
    const id = execution.agent && String(execution.agent.id);
    const sessions = ctx.get('channelSessions');
    const entry = id && (sessions?.getSessionEntry?.(id) ?? sessions?.index.peek(id));
    if (!entry && !id?.startsWith('ch-')) return next();
    if (historyTools.test(execution.name)) return { kind: 'deny', reason: '聊天历史只通过 /history 或 /switch 访问。' };
    const args = execution.arguments;
    if (args && typeof args === 'object' && args.sandbox_permissions === 'danger-full-access') {
      return { kind: 'deny', reason: '渠道会话不能绕过会话存档读取边界。' };
    }
    if (processTools.has(execution.name) && !ctx.get('sandbox')?.historyIsolation) {
      return { kind: 'deny', reason: '会话存档保护执行器未就绪，已拒绝运行进程。' };
    }
    if (processTools.has(execution.name) && ctx.get('sandboxPolicy')?.resolve({ session: execution.agent.session }).mode === 'danger-full-access') {
      return { kind: 'deny', reason: '当前权限模式会绕过历史保护，请使用 Workspace Write 或只读模式。' };
    }
    const roots = protectedRoots([...(sessions?.getProtectedPaths?.() ?? []), ...configuredProtectedPaths(config.protectedPaths)], config.protectedDataHomes ?? []);
    const recursive = /glob|grep|search|list|directory/i.test(execution.name);
    const cwd = execution.agent?.session?.header.cwd || process.cwd();
    try {
      if (pathsIn(args).some(path => deniedPath(path, cwd, roots, recursive))) {
        return { kind: 'deny', reason: '不可直接读取、搜索或修改会话存档；历史记录请使用 /history。' };
      }
    } catch { return { kind: 'deny', reason: '路径无法安全解析。' }; }
    return next();
  });
}

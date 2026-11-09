import Schema from '@deepseek-ai/schemastery';
import { LocalSandboxProvider } from '@deepseek-ai/dsh-sandbox-local';
import { SandboxUnavailableError } from '@deepseek-ai/dsh-sandbox';
import { launcherPath, grantArgs, probe } from '@deepseek-ai/node-addon-system/landlock-run';
import { protectedRoots, configuredProtectedPaths, readableRoots } from './paths.js';

export default class SessionHistorySandbox extends LocalSandboxProvider {
  static Config = Schema.intersect([LocalSandboxProvider.Config,
    Schema.object({ protectedDataHomes: Schema.array(Schema.string()).default([]),
      protectedPaths: Schema.array(Schema.string()).default([]) })]);
  historyIsolation = true;
  _checked = false;
  _enforcement = 'unusable';
  _protectedDataHomes;
  _protectedPaths;

  constructor(ctx, config) {
    super(ctx, config);
    this._protectedDataHomes = config.protectedDataHomes ?? [];
    this._protectedPaths = configuredProtectedPaths(config.protectedPaths);
  }

  async confine(argv, policy, signal) {
    signal?.throwIfAborted();
    const sessions = this.ctx.get('channelSessions');
    const id = policy.sessionId && String(policy.sessionId);
    if (!id || (!id.startsWith('ch-') && !sessions?.getSessionEntry?.(id) && !sessions?.index?.peek(id))) return super.confine(argv, policy, signal);
    if (!this._checked) {
      this._enforcement = process.platform === 'linux' ? probe() : 'unusable';
      this._checked = true;
    }
    if (this._enforcement === 'unusable') throw new SandboxUnavailableError(policy.mode, '渠道会话历史读取保护需要可用的 Linux Landlock。');
    const roots = protectedRoots([...(sessions?.getProtectedPaths?.() ?? []), ...this._protectedPaths], this._protectedDataHomes);
    const guarded = [launcherPath(), ...grantArgs({ readWrite: readableRoots(roots) }), '--', ...argv];
    const result = await super.confine(guarded, policy, signal);
    return { ...result, enforcement: this._enforcement === 'partial' ? 'partial' : result.enforcement };
  }
}

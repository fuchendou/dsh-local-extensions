/**
 * The `/help` command (spec §13).
 *
 * Discovery is read LIVE from the official registry — never from a static
 * list: `deps.listCommands(agent)` returns the effective view after global +
 * agent-scope shadowing, so Harness plugins that register new commands
 * (e.g. /compact, /goal, /plan) appear on the channel side without a channel
 * upgrade. `/help <name>` resolves one command via `deps.findCommand`.
 * The registry is reached through deps (bridged from the plugin ctx) — never
 * through `invocation.agent.ctx`, which the agent-loop scope does not inject.
 */
import { type CommandDefinition } from '@deepseek-ai/dsh-commands';
import type { ChannelCommandDependencies } from './index.js';
import type { ChannelCommandLocale } from './locale.js';
import { managedCommandHelp, managedUsageFor, renderManagedHelp } from './managed-help.js';

const copy = {
  zh: {
    title: '可用指令',
    none: '当前没有可用指令。',
    unknown: '未知指令：',
    usage: '用法',
    descriptions: {
      stop: '立即停止当前任务',
      new: '开启全新会话',
      help: '列出可用指令或查看单个指令用法',
      status: '查看当前会话、Agent 与模型状态',
      version: '查看渠道 Bundle 版本、Harness 基线与更新提示',
      models: '列出已注册的模型 Provider 及模型',
      model: '查看或切换当前会话模型',
    },
  },
  en: {
    title: 'Available commands',
    none: 'No commands are currently available.',
    unknown: 'Unknown command: ',
    usage: 'Usage',
    descriptions: {
      stop: 'Stop the current task immediately',
      new: 'Start a new session',
      help: 'List available commands or show usage for one command',
      status: 'Show the current session, agent, and model status',
      version: 'Show the channel bundle version, Harness baseline, and update hint',
      models: 'List registered model providers and their models',
      model: 'Show or change the current session model',
    },
  },
} as const;

function descriptionFor(
  locale: ChannelCommandLocale,
  name: string,
  fallback?: string,
): string | undefined {
  const descriptions = copy[locale].descriptions as Readonly<Record<string, string>>;
  return descriptions[name] ?? fallback;
}

function usageFor(name: string, hint?: string): string {
  return '/' + name + (hint ? ' ' + hint : '');
}

export function createHelpCommand(deps: ChannelCommandDependencies): CommandDefinition {
  return {
    name: 'help',
    description: 'List available commands or show usage for one command',
    input: { hint: '[command]' },
    handler(invocation) {
      const locale = deps.locale();
      const strings = copy[locale];
      const name = invocation.rawInput.trim().replace(/^\//, '');
      if (name.length > 0) {
        const def = deps.findCommand(invocation.agent, name);
        if (!def) {
          return { kind: 'error', text: strings.unknown + '`/' + name + '`' };
        }
        if (deps.sessions) {
          const detailed = managedCommandHelp(locale, def.name);
          if (detailed) return { kind: 'success', text: detailed };
          const usage = managedUsageFor(def.name, def.input?.hint);
          const description = def.description ?? (locale === 'zh' ? '此扩展命令未提供说明。' : 'This extension command has no description.');
          return { kind: 'success', text: usage + '：' + description };
        }
        const lines = ['**/' + def.name + '**'];
        const description = descriptionFor(locale, def.name, def.description);
        if (description) lines.push('', description);
        if (def.input?.hint) {
          lines.push('', '**' + strings.usage + '**', '`' + usageFor(def.name, def.input.hint) + '`');
        }
        return { kind: 'success', text: lines.join('\n') };
      }
      const defs = deps.listCommands(invocation.agent);
      if (defs.length === 0) {
        return { kind: 'success', text: strings.none };
      }
      if (deps.sessions) {
        return { kind: 'success', text: renderManagedHelp(locale, defs) };
      }
      const lines = ['**' + strings.title + '**', ''];
      for (const def of defs) {
        const usage = usageFor(def.name, def.input?.hint);
        const description = descriptionFor(locale, def.name, def.description);
        lines.push('- `' + usage + '`' + (description ? ' - ' + description : ''));
      }
      return { kind: 'success', text: lines.join('\n') };
    },
  };
}

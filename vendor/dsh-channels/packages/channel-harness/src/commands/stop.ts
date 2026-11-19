/**
 * The `/stop` command (spec §10).
 *
 * The command SEMANTICS live here as a normal `CommandDefinition` —
 * discoverable by `/help` and recorded as `command/run` + `command/done` —
 * while the BRIDGE fast path executes this registered command ahead of the
 * serial conversation chain so an in-flight turn can be interrupted
 * immediately (spec §4/§5). The handler performs the official cooperative
 * cancellation `agent.cancel({ kind: 'user' })`: abort the active turn,
 * propagate the AbortSignal to model/tool execution, clear the inbox and
 * pending steering.
 */
import { type CommandDefinition } from '@deepseek-ai/dsh-commands';
import type { ChannelCommandDependencies } from './index.js';

export function createStopCommand(deps: ChannelCommandDependencies): CommandDefinition {
  return {
    name: 'stop',
    description: 'Stop the current task immediately',
    async handler(invocation) {
      if (invocation.rawInput.trim().length > 0) {
        return { kind: 'error', text: 'Usage: /stop' };
      }
      invocation.agent.cancel({ kind: 'user' });
      try {
        if (await deps.sessions?.stopSuperagent(invocation.agent)) return { kind: 'success', text: '已停止 Super-agent 的未完成任务。' };
      } catch (error) {
        return { kind: 'error', text: error instanceof Error ? error.message : '无法确认后台任务已停止。' };
      }
      return { kind: 'success', text: '已停止当前任务。' };
    },
  };
}

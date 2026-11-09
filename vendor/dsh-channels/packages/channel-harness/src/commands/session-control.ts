import type { CommandDefinition } from '@deepseek-ai/dsh-commands';
import type { ChannelSessionControl } from '../session-control.js';

const definitions = [
  ['new', '[名称]', '开启空白聊天，保留共享工作文件'],
  ['session', '', '查看当前会话'], ['sessions', '[页码]', '列出自己的历史会话'],
  ['switch', '<会话短ID>', '切换会话'], ['history', '[会话短ID] [页码]', '查看聊天记录'],
  ['bind', '<会话短ID>', '兼容指令：仅切换本人已登记会话'],
  ['rename', '<名称>', '重命名当前会话'], ['status', '', '查看会话、模型和目标状态'],
  ['model', '[auto|<provider> <model> [effort]]', '自动选模或仅锁定当前会话模型'],
  ['effort', '[auto|等级]', '查看或设置当前模型思考强度'],
  ['plan', '[off|需求]', '进入只读规划模式或仅退出'], ['execute', '', '执行当前计划'],
  ['goal', '[目标|status|pause|resume [会话短ID]]', '新建独立后台目标或控制已有目标'],
  ['compact', '', '压缩当前上下文并保留原始记录'],
  ['permission', '[预设]', '查看或切换当前会话权限'],
  ['export', '', '在 Web 下载会话记录'],
] as const;

export function sessionControlCommands(service: ChannelSessionControl): CommandDefinition[] {
  return definitions.map(([name, hint, description]) => ({
    name, description, ...(hint ? { input: { hint } } : {}),
    async handler(invocation) {
      try { return { kind: 'success', text: await service.execute(name, invocation) }; }
      catch (error) { return { kind: 'error', text: error instanceof Error ? error.message : '命令执行失败。' }; }
    },
  }));
}

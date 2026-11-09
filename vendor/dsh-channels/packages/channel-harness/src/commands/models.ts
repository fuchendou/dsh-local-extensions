/**
 * The `/models` command (spec §15–§17).
 *
 * Model DISCOVERY only: reads the Harness LLM adapter registry through the
 * official `deps.llm` catalog seam (listProviders / listModels) — the channel never
 * touches provider HTTP endpoints and never treats the catalog as
 * authoritative. Catalog membership is ADVISORY (spec §17): it is used for
 * display only; `/model` performs exact resolution separately. A provider
 * whose model listing fails must not fail the whole command (spec §15).
 */
import { type CommandDefinition } from '@deepseek-ai/dsh-commands';
import type { LlmProviderInfo } from '@deepseek-ai/dsh-llm';
import type { ChannelCommandDependencies, ChannelModelCatalog } from './index.js';

export function createModelsCommand(deps: ChannelCommandDependencies): CommandDefinition {
  return {
    name: 'models',
    description: 'List registered model providers and their models',
    input: { hint: '[provider]' },
    async handler(invocation) {
      const llm = deps.llm;
      const providers = llm.listProviders();
      const filter = invocation.rawInput.trim();

      if (filter.length > 0) {
        const provider = providers.find((p) => p.id === filter);
        if (!provider) {
          return {
            kind: 'error',
            text: '未找到 Provider: ' + filter + availableSuffix(providers),
          };
        }
        return { kind: 'success', text: (await buildProviderLines(llm, provider, Boolean(deps.sessions), invocation.signal)).join('\n') };
      }

      if (providers.length === 0) {
        return { kind: 'success', text: '当前没有已注册的模型 Provider。' };
      }

      const sections = await Promise.all(providers.map((p) => buildProviderLines(llm, p)));
      const lines: string[] = [];
      for (const section of sections) {
        if (lines.length > 0) lines.push('');
        lines.push(...section);
      }
      return { kind: 'success', text: lines.join('\n') };
    },
  };
}

function availableSuffix(providers: LlmProviderInfo[]): string {
  if (providers.length === 0) return '';
  return '\n\n可用：\n' + providers.map((p) => p.id).join('\n');
}

async function buildProviderLines(llm: ChannelModelCatalog, provider: LlmProviderInfo, detailed = false, signal?: AbortSignal): Promise<string[]> {
  const lines = [provider.name + ' (' + provider.id + ')'];
  try {
    const models = await llm.listModels(provider.id);
    if (models.length === 0) {
      lines.push('- (无模型)');
    } else {
      for (const model of models) {
        let suffix = '';
        if (detailed) {
          try {
            const info = await llm.resolveModelInfo(provider.id, model.id, signal);
            suffix = ` [思考：${info.reasoning?.efforts?.map(e => String(e.id)).join(', ') || '默认'}]`;
          } catch { suffix = ' [思考强度暂不可用]'; }
        }
        lines.push('- ' + model.id + suffix);
      }
    }
  } catch {
    lines.push('- 模型目录获取失败');
  }
  return lines;
}

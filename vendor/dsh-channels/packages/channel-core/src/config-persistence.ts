import type { Context } from '@deepseek-ai/cordis';

type ConfigRecord = Record<string, unknown>;

function mergeConfig(current: ConfigRecord, patch: ConfigRecord): ConfigRecord {
  const result = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    const previous = result[key];
    result[key] = value && typeof value === 'object' && !Array.isArray(value)
      && previous && typeof previous === 'object' && !Array.isArray(previous)
      ? mergeConfig(previous as ConfigRecord, value as ConfigRecord) : value;
  }
  return result;
}

export async function persistChannelConfig(ctx: Context, patch: ConfigRecord): Promise<void> {
  const editor = ctx.get('configEditor') as { edit(entry: unknown, change: (current: ConfigRecord) => ConfigRecord): Promise<void> } | undefined;
  const entry = (ctx.fiber as { entry?: unknown }).entry;
  if (!editor || !entry) throw new Error('Channel configuration editor is unavailable.');
  await editor.edit(entry, current => mergeConfig(current, patch));
}

export function registerChannelDefinition<T extends { id: string }>(ctx: Context,
  registry: { register(definition: T): unknown; get?(id: string): T | undefined; unregister?(id: string): unknown },
  definition: T): void {
  registry.register(definition);
  ctx.effect(() => () => {
    if (registry.get?.(definition.id) === definition) registry.unregister?.(definition.id);
  });
}

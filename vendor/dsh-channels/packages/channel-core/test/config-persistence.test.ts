import { describe, expect, it, vi } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import { persistChannelConfig, registerChannelDefinition } from '../src/config-persistence.js';

describe('channel configuration persistence', () => {
  it('preserves unrelated nested configuration while committing through the current entry', async () => {
    const entry = {};
    let stored: Record<string, unknown> = { enabled: true, upstream: { appId: 'old', secretRef: 'credential' } };
    const edit = vi.fn(async (_entry, change) => { stored = change(stored); });
    const ctx = { fiber: { entry }, get: () => ({ edit }) } as unknown as Context;
    await persistChannelConfig(ctx, { upstream: { appId: 'new' } });
    expect(edit).toHaveBeenCalledWith(entry, expect.any(Function));
    expect(stored).toEqual({ enabled: true, upstream: { appId: 'new', secretRef: 'credential' } });
  });

  it('reports unavailable persistence instead of claiming a durable change', async () => {
    const ctx = { fiber: {}, get: () => undefined } as unknown as Context;
    await expect(persistChannelConfig(ctx, { enabled: false })).rejects.toThrow('configuration editor is unavailable');
  });

  it('unregisters only the definition owned by the disposed plugin', () => {
    let current: { id: string } | undefined;
    let dispose = () => {};
    const registry = {
      register(definition: { id: string }) { current = definition; },
      get() { return current; },
      unregister() { current = undefined; },
    };
    const ctx = { effect(fn: () => () => void) { dispose = fn(); } } as unknown as Context;
    const first = { id: 'weixin' };
    registerChannelDefinition(ctx, registry, first);
    expect(current).toBe(first);
    dispose();
    expect(current).toBeUndefined();
    registerChannelDefinition(ctx, registry, first);
    const replacement = { id: 'weixin' };
    current = replacement;
    dispose();
    expect(current).toBe(replacement);
  });
});

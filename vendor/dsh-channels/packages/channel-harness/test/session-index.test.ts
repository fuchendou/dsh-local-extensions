import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChannelSessionIndex } from '../src/session-index.ts';
import type { SessionBinding } from '../src/session-router.ts';

const binding = (id: string, owner = 'alice'): SessionBinding => ({
  channelId: 'weixin', accountId: 'main', conversationId: owner, senderId: owner,
  conversationType: 'dm', sessionId: id, schemaVersion: 3, durability: 'durable',
  route: {}, createdAt: 1, updatedAt: 1,
});

describe('owned session index', () => {
  it('persists concurrent updates and never enumerates another owner', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'channel-index-')), 'sessions.json');
    const store = new ChannelSessionIndex(path);
    await Promise.all([store.track(binding('ch-aaaaaaaa-1')), store.track(binding('ch-bbbbbbbb-1', 'bob'))]);
    await store.update('ch-aaaaaaaa-1', { title: '调研', modelPolicy: { mode: 'manual', selection: { provider: 'test', model: 'deep' } } });
    const restored = new ChannelSessionIndex(path);
    expect((await restored.list(binding('current'))).map(e => e.title)).toEqual(['调研']);
    expect((await restored.resolve(binding('current'), 'aaaaaaaa')).modelPolicy.mode).toBe('manual');
    await expect(restored.resolve(binding('current'), 'bbbbbbbb')).rejects.toThrow('未找到');
    await expect(restored.track(binding('ch-aaaaaaaa-1', 'bob'))).rejects.toThrow('归属冲突');
    expect(JSON.parse(await readFile(path, 'utf8')).version).toBe(1);
  });

  it('fails closed on corrupt files and ambiguous short IDs', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'channel-index-')), 'sessions.json');
    await writeFile(path, '{"version":99,"entries":[]}');
    await expect(new ChannelSessionIndex(path).ready).rejects.toThrow('损坏');
    const store = new ChannelSessionIndex();
    await store.track(binding('ch-aaaaaaaa-1'));
    await store.track(binding('ch-aaaaaaaa-2'));
    await expect(store.resolve(binding('current'), 'aaaaaaaa')).rejects.toThrow('不唯一');
    expect((await store.resolve(binding('current'), 'ch-aaaaaaaa-1')).binding.sessionId).toBe('ch-aaaaaaaa-1');
  });
});

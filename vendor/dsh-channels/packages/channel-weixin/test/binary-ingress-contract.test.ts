/**
 * Multi-channel binary ingress contract for Weixin.
 *
 * Weixin's real inbound is polling-driven, so `deliver(raw)` runs the FULL
 * poll -> handle path exactly like `test/media-hydration-regression.test.ts`:
 * - a `FakeTransport` serves `notifystart` / `notifystop` and the
 *   `/ilink/bot/getupdates` long poll, returning the fixture's getUpdates
 *   RESPONSE payload (`{ ret, msgs, get_updates_buf }`) on the first round and
 *   then holding the poll open;
 * - a stubbed `globalThis.fetch` returns deterministic bytes for the CDN
 *   `full_url` (the adapter constructs its `SecureRemoteMediaFetcher` with the
 *   fetch at construction time);
 * - the seeded credential lets `WeixinAdapter.start(ctx)` reach
 *   `TencentWeixinUpstream.startMonitor`, whose `beforeEmit` hydration
 *   (`enrichInboundMedia`) downloads + (keyless) returns the bytes before the
 *   monitor emits `message.received`, which is captured and returned.
 *
 * Fixture-driven cases (existing fixtures only):
 * - image `getupdates-image` — item type 2 with a CDN `full_url` -> hydrated
 *   localData; weixin declares inbound image 'bytes'.
 * - audio `getupdates-voice` — item type 3 with a CDN `full_url` -> hydrated
 *   localData (no AES key in the fixture -> raw bytes, `audio/silk` fallback);
 *   weixin declares inbound audio 'bytes'.
 * - file / video: no `getupdates-file` / `getupdates-video` fixtures -> SKIPPED
 *   (plan: prefer documented skips); those hydration paths are pinned by
 *   `test/media-hydration-regression.test.ts`.
 */
import { vi, expect, afterEach } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import { ChannelService, type MessageReceived } from '@wsz987/channel-core';
import type { ChannelAdapterContext } from '@wsz987/channel-core';
import { createTestContext, runBinaryIngressContract } from '@wsz987/channel-testkit';
import { WeixinAdapter } from '../src/adapter.js';
import { Config } from '../src/config.js';
import type { WeixinConfig } from '../src/config.js';
import type { HttpTransport } from '../src/index.js';
import { AccountCredentialStore } from '../src/auth/account-store.js';

function makeConfig(overrides: Partial<WeixinConfig> = {}): WeixinConfig {
  return Config({
    enabled: true,
    accountId: 'main',
    ilink: { baseUrl: 'https://fake.ilink.test', cdnBaseUrl: 'https://fake.cdn.test', botAgent: 'DeepSeekHarness/0.8.1' },
    network: { timeoutMs: 1000, longPollTimeoutMs: 1000 },
    reconnect: { enabled: false, baseDelayMs: 1, maxDelayMs: 10 },
    ...overrides,
  } as unknown as WeixinConfig);
}

/** Deterministic bytes the CDN fetch stub returns for every full_url. */
const FIXTURE_BYTES = new Uint8Array([0x77, 0x78, 0x2d, 0x31, 0x32]);

interface FakeHandlerInit { body?: unknown; headers?: Record<string, string> }

class FakeTransport implements HttpTransport {
  routeByPath = new Map<string, (init?: FakeHandlerInit) => unknown>();

  route(path: string, handler: (init?: FakeHandlerInit) => unknown): this {
    this.routeByPath.set(path, handler);
    return this;
  }

  async request(url: string, init?: FakeHandlerInit): Promise<unknown> {
    const path = pathOf(url);
    const handler = this.routeByPath.get(path);
    if (!handler) throw new Error('no route for ' + path);
    return handler(init);
  }
}

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + (u.search ? u.search : '');
  } catch {
    return url;
  }
}

const credential = {
  token: 'bot-token-secret',
  ilinkBotId: 'bot-1',
  userId: 'wx-user',
  baseUrl: 'https://fake.ilink.test',
  savedAt: new Date(1700000000000).toISOString(),
};

async function seedCredential(ctx: ChannelAdapterContext): Promise<void> {
  const store = new AccountCredentialStore({
    secrets: ctx.secrets,
    storage: ctx.storage,
    accountId: 'main',
    now: () => 1700000000000,
  });
  await store.save(credential);
}

const OLD_FETCH = globalThis.fetch;
afterEach(() => {
  (globalThis as { fetch: typeof fetch }).fetch = OLD_FETCH;
});

runBinaryIngressContract({
  adapter: new WeixinAdapter(makeConfig()),
  cases: [
    // getupdates-image: item type 2 image_item.media.full_url -> fetched ->
    // localData before the monitor emits (image/jpeg).
    { kind: 'image', expected: 'bytes', fixture: 'getupdates-image', channel: 'weixin' },
    // getupdates-voice: item type 3 voice_item.media.full_url -> fetched ->
    // localData before the monitor emits (audio/silk raw fallback).
    { kind: 'audio', expected: 'bytes', fixture: 'getupdates-voice', channel: 'weixin' },
    // file / video: no getupdates-file / getupdates-video fixtures -> SKIPPED
    // (documented above; path pinned by media-hydration-regression.test.ts).
  ],
  deliver: async (raw): Promise<MessageReceived> => {
    const transport = new FakeTransport();
    let polls = 0;
    transport.route('/ilink/bot/msg/notifystart', () => ({ ret: 0 }));
    transport.route('/ilink/bot/msg/notifystop', () => ({ ret: 0 }));
    transport.route('/ilink/bot/getupdates', () => {
      polls += 1;
      // First long-poll round: the fixture's getUpdates response. Then hold
      // the poll open so the monitor stays idle while the test asserts.
      if (polls === 1) return raw;
      return new Promise(() => { /* hold long-poll open */ });
    });
    (globalThis as { fetch: typeof fetch }).fetch =
      (async () => new Response(FIXTURE_BYTES, { status: 200 })) as typeof fetch;

    const service = new ChannelService(new Context());
    const ctx = createTestContext(service);
    await seedCredential(ctx);

    let captured: MessageReceived | undefined;
    service.on((event) => {
      if (event.type === 'message.received') captured = event;
    });
    const adapter = new WeixinAdapter(makeConfig(), { transport, now: () => 1700000000000, rand: () => 0.5 });
    await adapter.start(ctx);
    await vi.waitFor(() => expect(captured).toBeDefined(), { timeout: 3000 });
    await ctx.dispose();
    await adapter.stop();
    return captured!;
  },
});
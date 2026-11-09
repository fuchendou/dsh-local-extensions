/**
 * Multi-channel binary ingress contract for QQ.
 *
 * Every case drives the REAL inbound entry: `QQAdapter.start(ctx)` wires the
 * SDK client's `onMessage` -> `InboundProcessor.handle` (mapper + media
 * hydration + `ctx.emit`), exactly like `test/adapter.test.ts` /
 * `test/media-hydration.test.ts`: a `FakeQQSdkClient` delivers the fixture's
 * QQBotInboundMessage through `emitMessage`, and an injected fake
 * `SecureRemoteMediaFetcher.fetchBounded` returns deterministic bytes for the
 * fixture's attachment URLs. The emitted `message.received` is captured from
 * a `ChannelService` listener and returned to the runner.
 *
 * Fixture-driven cases (existing fixtures only): image / file / audio / video
 * — all four `fixtures/qq/inbound-*.json` attachments carry genuine http(s)
 * URLs that the adapter hydrates to localData before emit; QQ declares
 * inbound bytes for all four kinds (see `test/media-hydration.test.ts`).
 */
import { Context } from '@deepseek-ai/cordis';
import { vi, expect } from 'vitest';
import { ChannelService, type MessageReceived } from '@wsz987/channel-core';
import type { SecureRemoteMediaFetcher } from '@wsz987/channel-core';
import { createTestContext, runBinaryIngressContract } from '@wsz987/channel-testkit';
import type { QQBotInboundMessage } from '@tencent-connect/qqbot-nodejs';
import type { QQConfig } from '../src/config.ts';
import { Config, QQAdapter } from '../src/index.ts';
import { FakeQQSdkClient } from '../src/sdk-client.ts';

function makeConfig(overrides: Partial<QQConfig> = {}): QQConfig {
  return Config({
    enabled: true,
    accountId: 'main',
    appId: 'APP_ID',
    appSecretRef: 'QQBOT_APP_SECRET',
    markdownSupport: false,
    streaming: { enabled: true, throttleMs: 500 },
    dedup: { enabled: false, windowMs: 5000 },
    startupTimeoutMs: 15000,
    ...overrides,
  });
}

/** Deterministic bytes the fake fetcher returns for every attachment URL. */
const FIXTURE_BYTES = new Uint8Array([0xca, 0xfe, 0xba, 0xbe, 0x2a]);

/** Fake SecureRemoteMediaFetcher: bounded bytes for any fixture URL. */
function fakeFetcher(): SecureRemoteMediaFetcher {
  return {
    fetchBounded: async () => ({
      data: FIXTURE_BYTES,
      mimeType: 'application/octet-stream',
      finalUrl: 'https://example.com/fixture',
    }),
  } as unknown as SecureRemoteMediaFetcher;
}

runBinaryIngressContract({
  adapter: new QQAdapter(makeConfig(), { sdkClient: new FakeQQSdkClient() }),
  cases: [
    // inbound-image / inbound-file / inbound-audio / inbound-video: genuine
    // http(s) attachment urls -> fetchBounded -> localData before emit; QQ
    // declares inbound bytes for all four kinds.
    { kind: 'image', expected: 'bytes', fixture: 'inbound-image', channel: 'qq' },
    { kind: 'file', expected: 'bytes', fixture: 'inbound-file', channel: 'qq' },
    { kind: 'audio', expected: 'bytes', fixture: 'inbound-audio', channel: 'qq' },
    { kind: 'video', expected: 'bytes', fixture: 'inbound-video', channel: 'qq' },
  ],
  deliver: async (raw): Promise<MessageReceived> => {
    const service = new ChannelService(new Context());
    const ctx = createTestContext(service);
    const fake = new FakeQQSdkClient();
    fake.autoReady = true;
    const adapter = new QQAdapter(makeConfig(), { sdkClient: fake, secureFetch: fakeFetcher() });
    let captured: MessageReceived | undefined;
    service.on((event) => {
      if (event.type === 'message.received') captured = event;
    });
    await adapter.start(ctx);
    // The SDK client is the wire entry; the fixture is the QQBotInboundMessage
    // the SDK would deliver. handleInbound is fire-and-forget (adapter.ts), so
    // we wait for the emitted event below.
    fake.emitMessage(raw as QQBotInboundMessage);
    await vi.waitFor(() => expect(captured).toBeDefined(), { timeout: 3000 });
    await adapter.stop();
    return captured!;
  },
});
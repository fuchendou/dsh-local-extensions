/**
 * Multi-channel binary ingress contract for DingTalk.
 *
 * Every case drives the REAL inbound entry — `InboundProcessor.handle(raw)` —
 * mirroring `test/image-hydration.test.ts` / `test/media-hydration.test.ts`:
 * an injected fake secure fetcher (`RemoteMediaFetchLike.fetchBounded`)
 * returns deterministic bytes for the fixture's genuine http(s) media URLs
 * (image `picUrl`, audio/video `mediaUrl`), failures would stamp a stable
 * `ingressFailure`, and the emitted `message.received` is captured from a
 * `ChannelService` listener and returned to the runner.
 *
 * Fixture-driven byte claim: image. Audio/video hydration remains covered by
 * `test/media-hydration.test.ts`, but those synthetic URL/downloadCode tests
 * are not platform evidence, so the adapter conservatively declares locator
 * support until the official API plus live gate are verified.
 * - file: no fixtures/dingtalk/inbound-file.json -> SKIPPED (plan: prefer
 *   documented skips over invented fixtures).
 */
import { Context } from '@deepseek-ai/cordis';
import { ChannelService, type MessageReceived } from '@wsz987/channel-core';
import { createTestContext, runBinaryIngressContract } from '@wsz987/channel-testkit';
import {
  Config,
  DingTalkAdapter,
  InboundProcessor,
  type MediaResolverLike,
  type RemoteMediaFetchLike,
} from '../src/index.ts';
import type { DingTalkConfig } from '../src/config.ts';

function makeConfig(overrides: Partial<DingTalkConfig> = {}): DingTalkConfig {
  return Config({
    enabled: true,
    accountId: 'main',
    baseUrl: 'http://fake',
    timeoutMs: 1000,
    longPollTimeoutMs: 1000,
    reconnect: { enabled: false, baseDelayMs: 1, maxDelayMs: 10, maxRetries: 2 },
    dedup: { enabled: false, windowMs: 5000 },
    card: { createOnFirstDelta: true },
    upstream: { mode: 'gateway' },
    ...overrides,
  });
}

const meta = { channel: 'dingtalk' as never, accountId: 'main' as never };

/** Deterministic bytes the fake fetcher returns for every fixture URL. */
const FIXTURE_BYTES = new Uint8Array([0x31, 0x41, 0x59, 0x26, 0x53]);

/** Fake secure fetcher: bounded bytes for any http(s) fixture URL. */
function fakeFetcher(): RemoteMediaFetchLike {
  return {
    fetchBounded: async (url: string) => ({
      data: FIXTURE_BYTES,
      mimeType: 'application/octet-stream',
      finalUrl: url,
    }),
  };
}

runBinaryIngressContract({
  adapter: new DingTalkAdapter(makeConfig()),
  cases: [
    // inbound-image: picUrl http(s) -> fetched -> localData before emit.
    { kind: 'image', expected: 'bytes', fixture: 'inbound-image', channel: 'dingtalk' },
    // file: no fixtures/dingtalk/inbound-file.json -> SKIPPED (documented
    // above); the file hydration path is covered by test/media-hydration.
  ],
  deliver: async (raw): Promise<MessageReceived> => {
    const service = new ChannelService(new Context());
    const ctx = createTestContext(service);
    // resolveMedia is unused by these fixtures (all URL carriers) but stays
    // injected — an opaque downloadCode fixture would take that seam.
    const resolver: MediaResolverLike = {
      resolveMedia: async () => ({ data: FIXTURE_BYTES, mimeType: 'audio/amr', size: FIXTURE_BYTES.byteLength }),
    };
    const processor = new InboundProcessor({
      ctx,
      meta,
      dedupEnabled: false,
      dedupWindowMs: 5000,
      secureFetch: fakeFetcher(),
      resolveMedia: resolver,
    });
    let captured: MessageReceived | undefined;
    service.on((event) => {
      if (event.type === 'message.received') captured = event;
    });
    await processor.handle(raw);
    if (!captured) throw new Error('no message.received emitted for dingtalk fixture');
    return captured;
  },
});

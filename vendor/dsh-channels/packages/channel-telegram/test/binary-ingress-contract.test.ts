/**
 * Multi-channel binary ingress contract for Telegram.
 *
 * Every case drives the REAL inbound entry — `InboundProcessor.handle(raw)`
 * which runs mapper + hydration + `ctx.emit` — mirroring
 * `test/media-hydration.test.ts` / `test/adapter.test.ts`: a fake `files`
 * resolver (`downloadFile`) returns deterministic bytes for the fixture's
 * platform locators (Bot API `file_id`s), the emitted `message.received` is
 * captured from a `ChannelService` listener and returned to the runner.
 *
 * Fixture-driven cases (existing fixtures only):
 * - audio `inbound-audio` — voice `file_id` carrier, hydrated to bytes.
 * - image `inbound-image` — photo `file_id` carrier (largest size), hydrated
 *   to bytes.
 * - file / video: SKIPPED — no `fixtures/telegram/inbound-file.json` /
 *   `inbound-video.json` exist; the plan forbids inventing fixtures absent a
 *   real SDK raw shape.
 *
 * `assertCapabilityConsistency` stays at its default `true`: a `bytes` case
 * must be backed by `capabilities.media.inbound[kind] === 'bytes'` (plan
 * §7.2), which `TelegramAdapter` declares for all four kinds (see
 * `test/media-hydration.test.ts`).
 */
import { Context } from '@deepseek-ai/cordis';
import { ChannelService, type MessageReceived } from '@wsz987/channel-core';
import { createTestContext, runBinaryIngressContract } from '@wsz987/channel-testkit';
import {
  Config,
  InboundProcessor,
  TelegramAdapter,
  type TelegramFileResolver,
} from '../src/index.ts';
import type { TelegramConfig } from '../src/config.ts';

function makeConfig(overrides: Partial<TelegramConfig> = {}): TelegramConfig {
  return Config({
    enabled: true,
    accountId: 'main',
    baseUrl: 'http://fake',
    tokenRef: 'TELEGRAM_BOT_TOKEN',
    token: undefined,
    timeoutMs: 1000,
    longPollTimeoutMs: 1000,
    reconnect: { enabled: false, baseDelayMs: 1, maxDelayMs: 10, maxRetries: 2 },
    dedup: { enabled: false, windowMs: 5000 },
    streaming: { enabled: true, placeholder: '…' },
    typing: { enabled: true, refreshMs: 4000 },
    maxDownloadBytes: 20 * 1024 * 1024,
    ...overrides,
  });
}

/** Deterministic bytes for any Bot API file_id referenced by a fixture. */
const FIXTURE_BYTES = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x42]);

/** Fake `files` resolver: returns the same trusted bytes for every file_id. */
function fakeFiles(): TelegramFileResolver {
  return {
    downloadFile: async () => ({
      data: FIXTURE_BYTES,
      mimeType: 'image/jpeg',
      name: 'fixture.bin',
    }),
  };
}

runBinaryIngressContract({
  adapter: new TelegramAdapter(makeConfig()),
  cases: [
    // inbound-audio: platform `voice.file_id` -> resourceRef -> downloadFile
    // -> localData. Map to AudioPart; telegram declares inbound audio 'bytes'.
    { kind: 'audio', expected: 'bytes', fixture: 'inbound-audio', channel: 'telegram' },
    // inbound-image: platform `photo[]` (largest) -> resourceRef -> downloadFile
    // -> localData. Map to ImagePart; telegram declares inbound image 'bytes'.
    { kind: 'image', expected: 'bytes', fixture: 'inbound-image', channel: 'telegram' },
    // file / video: no fixtures exist (fixtures/telegram has only
    // inbound-audio / inbound-image for binary kinds) -> SKIPPED here.
    // The file hydration path is covered by test/media-hydration.test.ts.
  ],
  deliver: async (raw): Promise<MessageReceived> => {
    const service = new ChannelService(new Context());
    const ctx = createTestContext(service);
    const processor = new InboundProcessor({
      ctx,
      meta: { channel: 'telegram' as never, accountId: 'main' as never },
      dedupEnabled: false,
      dedupWindowMs: 5000,
      files: fakeFiles(),
    });
    let captured: MessageReceived | undefined;
    service.on((event) => {
      if (event.type === 'message.received') captured = event;
    });
    await processor.handle(raw);
    if (!captured) throw new Error('no message.received emitted for telegram fixture');
    return captured;
  },
});

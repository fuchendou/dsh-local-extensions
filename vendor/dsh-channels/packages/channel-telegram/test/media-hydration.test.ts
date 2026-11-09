/**
 * Telegram inbound media hydration.
 *
 * Covers `hydrateTelegramParts` at the resolver level (photo/document/voice/
 * audio/video all reach `localData` with authoritative size, hint merge rules,
 * download failure -> stable `ingressFailure`, oversize -> 'too-large'), the
 * full InboundProcessor -> upstream downloadFile path over a FakeTransport
 * (getFile route + binary download), and the adapter's directional
 * `capabilities.media` declaration validated against the shared
 * `mediaCapabilitiesSchema`.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import {
  ChannelService,
  mediaCapabilitiesSchema,
  type MessageReceived,
} from '@wsz987/channel-core';
import { createTestContext } from '@wsz987/channel-testkit';
import {
  Config,
  HttpTelegramUpstream,
  InboundProcessor,
  TelegramAdapter,
  hydrateTelegramParts,
} from '../src/index.ts';
import type { HttpTransport, HttpRequestInit } from '../src/index.ts';
import type { TelegramConfig } from '../src/config.ts';

/** Anonymous placeholder token — never a real credential (fixture rule). */
const TOKEN = 'TEST_BOT_TOKEN_123';
/** Bot API paths embed the token: /bot<token>/<endpoint>. */
const tgPath = (endpoint: string): string => `/bot${TOKEN}/${endpoint}`;

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

/** Deterministic fake transport: routes keyed by path, records calls. */
class FakeTransport implements HttpTransport {
  routes = new Map<string, (init?: HttpRequestInit, signal?: AbortSignal) => unknown>();
  calls: { path: string; init?: HttpRequestInit }[] = [];
  requestBinary?: (path: string, init?: HttpRequestInit, signal?: AbortSignal) => Promise<unknown>;

  route(path: string, handler: (init?: HttpRequestInit, signal?: AbortSignal) => unknown): this {
    this.routes.set(path, handler);
    return this;
  }

  request(path: string, init: HttpRequestInit = {}, signal?: AbortSignal): Promise<unknown> {
    this.calls.push({ path, init });
    if (signal?.aborted) {
      return Promise.reject(new DOMException('Aborted', 'AbortError'));
    }
    const handler = this.routes.get(path);
    if (!handler) return Promise.reject(new Error(`no route for ${path}`));
    try {
      return Promise.resolve(handler(init, signal));
    } catch (error) {
      return Promise.reject(error);
    }
  }
}

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

describe('hydrateTelegramParts (resolver level)', () => {
  it('hydrates photo, document, voice, audio and video parts into localData with authoritative size', async () => {
    const photoBytes = enc('photo-bytes');
    const docBytes = enc('doc-bytes');
    const voiceBytes = enc('voice-bytes');
    const audioBytes = enc('audio-bytes');
    const videoBytes = enc('video-bytes');
    const downloadFile = vi.fn(async (fileId: string) => {
      switch (fileId) {
        case 'ANON_PHOTO':
          return { data: photoBytes, mimeType: 'image/jpeg', name: 'file_42.jpg' };
        case 'ANON_DOCUMENT':
          return { data: docBytes, mimeType: 'application/octet-stream', name: 'generated.bin' };
        case 'ANON_VOICE':
          return { data: voiceBytes, mimeType: 'audio/ogg', name: 'voice.ogg' };
        case 'ANON_AUDIO':
          return { data: audioBytes, mimeType: 'audio/mpeg', name: 'track.mp3' };
        case 'ANON_VIDEO':
          return { data: videoBytes, mimeType: 'video/mp4', name: 'clip.mp4' };
        default:
          throw new Error(`unexpected file_id ${fileId}`);
      }
    });

    const parts = await hydrateTelegramParts(
      [
        // A prior failure marker is cleared by a successful hydration.
        { type: 'image', resourceRef: 'ANON_PHOTO', ingressFailure: 'download-failed' },
        // Message metadata (name/mime) outranks resolver/stream hints.
        {
          type: 'file',
          resourceRef: 'ANON_DOCUMENT',
          name: 'report.pdf',
          mimeType: 'application/pdf',
        },
        { type: 'audio', resourceRef: 'ANON_VOICE', durationMs: 12000, mimeType: 'audio/ogg' },
        { type: 'audio', resourceRef: 'ANON_AUDIO', durationMs: 60000 },
        { type: 'video', resourceRef: 'ANON_VIDEO', durationMs: 5000 },
      ],
      { downloadFile },
      { maxBytes: 20 * 1024 * 1024 },
    );

    expect(downloadFile).toHaveBeenCalledTimes(5);
    expect(parts).toEqual([
      {
        type: 'image',
        resourceRef: 'ANON_PHOTO',
        localData: photoBytes,
        mimeType: 'image/jpeg',
        size: photoBytes.byteLength,
      },
      {
        type: 'file',
        resourceRef: 'ANON_DOCUMENT',
        name: 'report.pdf',
        mimeType: 'application/pdf',
        localData: docBytes,
        size: docBytes.byteLength,
      },
      {
        type: 'audio',
        resourceRef: 'ANON_VOICE',
        durationMs: 12000,
        mimeType: 'audio/ogg',
        name: 'voice.ogg',
        localData: voiceBytes,
        size: voiceBytes.byteLength,
      },
      {
        type: 'audio',
        resourceRef: 'ANON_AUDIO',
        durationMs: 60000,
        mimeType: 'audio/mpeg',
        name: 'track.mp3',
        localData: audioBytes,
        size: audioBytes.byteLength,
      },
      {
        type: 'video',
        resourceRef: 'ANON_VIDEO',
        durationMs: 5000,
        mimeType: 'video/mp4',
        name: 'clip.mp4',
        localData: videoBytes,
        size: videoBytes.byteLength,
      },
    ]);
  });

  it('skips non-binary parts and parts with bytes already in hand', async () => {
    const downloadFile = vi.fn(async () => ({ data: enc('x'), mimeType: 'image/png' }));
    const already = { type: 'image', resourceRef: 'ANON_SKIP', localData: enc('existing') };
    const parts = await hydrateTelegramParts(
      [
        { type: 'text', text: 'hello' },
        { type: 'image', resourceRef: 'ANON_SKIP', dataUri: 'data:image/png;base64,aGk=' },
        already,
        { type: 'image' }, // no resourceRef
        { type: 'unsupported', reason: 'nope' },
      ],
      { downloadFile },
      { maxBytes: 10 },
    );

    expect(downloadFile).not.toHaveBeenCalled();
    expect(parts).toEqual([
      { type: 'text', text: 'hello' },
      { type: 'image', resourceRef: 'ANON_SKIP', dataUri: 'data:image/png;base64,aGk=' },
      { type: 'image', resourceRef: 'ANON_SKIP', localData: enc('existing') },
      { type: 'image' },
      { type: 'unsupported', reason: 'nope' },
    ]);
  });

  it('records download-failed, keeps the locator, and never blocks text delivery', async () => {
    const logger = { warn: vi.fn() };
    const downloadFile = vi.fn(async () => {
      throw new Error('network exploded');
    });
    const parts = await hydrateTelegramParts(
      [
        { type: 'text', text: 'still delivered' },
        { type: 'file', resourceRef: 'ANON_GONE' },
      ],
      { downloadFile },
      { maxBytes: 10, logger },
    );

    expect(parts).toEqual([
      { type: 'text', text: 'still delivered' },
      { type: 'file', resourceRef: 'ANON_GONE', ingressFailure: 'download-failed' },
    ]);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      '[channel-telegram] media hydration failed',
      expect.objectContaining({ type: 'file', failure: 'download-failed' }),
    );
  });

  it('marks an oversized download too-large without merging bytes or metadata', async () => {
    const logger = { warn: vi.fn() };
    const downloadFile = vi.fn(async () => ({
      data: enc('12345'),
      mimeType: 'application/pdf',
      name: 'oversized.pdf',
    }));
    const parts = await hydrateTelegramParts(
      [
        // Only `ingressFailure` is written: locator and any previously-known
        // hints stay, `size` is never derived from the rejected bytes.
        { type: 'file', resourceRef: 'ANON_BIG', name: 'report.pdf', mimeType: 'application/pdf' },
      ],
      { downloadFile },
      { maxBytes: 4, logger },
    );

    expect(parts).toEqual([
      {
        type: 'file',
        resourceRef: 'ANON_BIG',
        name: 'report.pdf',
        mimeType: 'application/pdf',
        ingressFailure: 'too-large',
      },
    ]);
    expect(logger.warn).toHaveBeenCalledWith(
      '[channel-telegram] media hydration failed',
      expect.objectContaining({ failure: 'too-large' }),
    );
  });
});

describe('InboundProcessor over FakeTransport (getFile + binary download)', () => {
  let transport: FakeTransport;
  let service: ChannelService;
  let received: MessageReceived[];
  let upstream: HttpTelegramUpstream;

  beforeEach(() => {
    transport = new FakeTransport();
    service = new ChannelService(new Context());
    received = [];
    service.on((event) => {
      if (event.type === 'message.received') received.push(event);
    });
    upstream = new HttpTelegramUpstream({ transport, token: TOKEN, longPollTimeoutMs: 500 });
  });

  function processor(maxDownloadBytes?: number): InboundProcessor {
    const ctx = createTestContext(service);
    return new InboundProcessor({
      ctx,
      meta: { channel: 'telegram' as never, accountId: 'main' as never },
      dedupEnabled: false,
      dedupWindowMs: 5000,
      files: upstream,
      maxDownloadBytes,
    });
  }

  function routeFile(fileId: string, result: Record<string, unknown>): void {
    transport.route(tgPath('getFile'), () => ({
      ok: true,
      result: { file_id: fileId, file_unique_id: `anon-${fileId}`, ...result },
    }));
  }

  it('hydrates photo -> ImagePart.localData with size and resolver mime', async () => {
    const bytes = enc('photo-bytes');
    routeFile('ANON_PHOTO', { file_path: 'photos/file_42.jpg' });
    transport.requestBinary = vi.fn(async () => ({ data: bytes, contentType: 'image/jpeg' }));

    await processor().handle({
      update_id: 1,
      message: {
        message_id: 101,
        chat: { id: 1, type: 'private' },
        from: { id: 2 },
        photo: [{ file_id: 'ANON_PHOTO', width: 100, height: 100 }],
      },
    });

    expect(received).toHaveLength(1);
    expect(received[0]?.message.content).toEqual([
      {
        type: 'image',
        resourceRef: 'ANON_PHOTO',
        localData: bytes,
        mimeType: 'image/jpeg',
        size: bytes.byteLength,
      },
    ]);
  });

  it('hydrates document -> FilePart.localData while message metadata outranks resolver hints', async () => {
    const bytes = enc('doc-bytes');
    routeFile('ANON_DOCUMENT', { file_path: 'docs/generated.bin' });
    transport.requestBinary = vi.fn(async () => ({
      data: bytes,
      contentType: 'application/octet-stream',
      contentDisposition: 'attachment; filename="generated.bin"',
    }));

    await processor().handle({
      update_id: 2,
      message: {
        message_id: 102,
        chat: { id: 1, type: 'private' },
        from: { id: 2 },
        document: {
          file_id: 'ANON_DOCUMENT',
          file_name: 'report.pdf',
          mime_type: 'application/pdf',
        },
      },
    });

    expect(received[0]?.message.content).toEqual([
      {
        type: 'file',
        resourceRef: 'ANON_DOCUMENT',
        name: 'report.pdf',
        mimeType: 'application/pdf',
        localData: bytes,
        size: bytes.byteLength,
      },
    ]);
  });

  it('hydrates voice -> AudioPart.localData', async () => {
    const bytes = enc('voice-bytes');
    routeFile('ANON_VOICE', { file_path: 'voice/file_12.oga' });
    transport.requestBinary = vi.fn(async () => ({ data: bytes, contentType: 'audio/ogg' }));

    await processor().handle({
      update_id: 3,
      message: {
        message_id: 103,
        chat: { id: 1, type: 'private' },
        from: { id: 2 },
        voice: { file_id: 'ANON_VOICE', duration: 12, mime_type: 'audio/ogg' },
      },
    });

    expect(received[0]?.message.content).toEqual([
      {
        type: 'audio',
        resourceRef: 'ANON_VOICE',
        durationMs: 12000,
        mimeType: 'audio/ogg',
        name: 'file_12.oga',
        localData: bytes,
        size: bytes.byteLength,
      },
    ]);
  });

  it('hydrates audio message -> AudioPart.localData', async () => {
    const bytes = enc('audio-bytes');
    routeFile('ANON_AUDIO', { file_path: 'music/track.mp3' });
    transport.requestBinary = vi.fn(async () => ({ data: bytes, contentType: 'audio/mpeg' }));

    await processor().handle({
      update_id: 4,
      message: {
        message_id: 104,
        chat: { id: 1, type: 'private' },
        from: { id: 2 },
        audio: { file_id: 'ANON_AUDIO', duration: 60, mime_type: 'audio/mpeg' },
      },
    });

    expect(received[0]?.message.content).toEqual([
      {
        type: 'audio',
        resourceRef: 'ANON_AUDIO',
        durationMs: 60000,
        mimeType: 'audio/mpeg',
        name: 'track.mp3',
        localData: bytes,
        size: bytes.byteLength,
      },
    ]);
  });

  it('hydrates video -> VideoPart.localData', async () => {
    const bytes = enc('video-bytes');
    routeFile('ANON_VIDEO', { file_path: 'video/clip.mp4' });
    transport.requestBinary = vi.fn(async () => ({ data: bytes, contentType: 'video/mp4' }));

    await processor().handle({
      update_id: 5,
      message: {
        message_id: 105,
        chat: { id: 1, type: 'private' },
        from: { id: 2 },
        video: { file_id: 'ANON_VIDEO', duration: 5, mime_type: 'video/mp4' },
      },
    });

    expect(received[0]?.message.content).toEqual([
      {
        type: 'video',
        resourceRef: 'ANON_VIDEO',
        durationMs: 5000,
        mimeType: 'video/mp4',
        name: 'clip.mp4',
        localData: bytes,
        size: bytes.byteLength,
      },
    ]);
  });

  it('download failure: ingressFailure set, locator retained, no localData, text still emitted', async () => {
    transport.route(tgPath('getFile'), () => ({
      ok: false,
      error_code: 400,
      description: 'Bad Request: file not found',
    }));

    await processor().handle({
      update_id: 6,
      message: {
        message_id: 106,
        chat: { id: 1, type: 'private' },
        from: { id: 2 },
        document: { file_id: 'ANON_GONE', file_name: 'report.pdf', mime_type: 'application/pdf' },
        caption: 'quarterly report',
      },
    });

    expect(received).toHaveLength(1);
    expect(received[0]?.message.content).toEqual([
      { type: 'text', text: 'quarterly report' },
      {
        type: 'file',
        resourceRef: 'ANON_GONE',
        name: 'report.pdf',
        mimeType: 'application/pdf',
        ingressFailure: 'download-failed',
      },
    ]);
  });

  it('oversize download respects maxDownloadBytes as too-large', async () => {
    const bytes = enc('12345');
    routeFile('ANON_BIG', { file_path: 'files/big.bin' });
    transport.requestBinary = vi.fn(async () => ({ data: bytes, contentType: 'application/octet-stream' }));

    await processor(4).handle({
      update_id: 7,
      message: {
        message_id: 107,
        chat: { id: 1, type: 'private' },
        from: { id: 2 },
        document: { file_id: 'ANON_BIG', file_name: 'big.bin' },
      },
    });

    expect(received[0]?.message.content).toEqual([
      {
        type: 'file',
        resourceRef: 'ANON_BIG',
        name: 'big.bin',
        ingressFailure: 'too-large',
      },
    ]);
    expect(transport.requestBinary).toHaveBeenCalledTimes(1);
  });
});

describe('capabilities.media (directional declaration)', () => {
  it('parses against mediaCapabilitiesSchema with all four kinds as inbound+outbound bytes', () => {
    const adapter = new TelegramAdapter(makeConfig());
    const parsed = mediaCapabilitiesSchema.safeParse(adapter.capabilities.media);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual({
        inbound: { image: 'bytes', file: 'bytes', audio: 'bytes', video: 'bytes' },
        outbound: { image: 'bytes', file: 'bytes', audio: 'bytes', video: 'bytes' },
      });
    }
  });

  it('keeps the legacy capability booleans unchanged', () => {
    const adapter = new TelegramAdapter(makeConfig());
    expect(adapter.capabilities.text).toBe(true);
    expect(adapter.capabilities.image).toBe(true);
    expect(adapter.capabilities.file).toBe(true);
    expect(adapter.capabilities.audio).toBe(true);
    expect(adapter.capabilities.video).toBe(true);
    expect(adapter.capabilities.streaming).toBe('edit');
  });
});

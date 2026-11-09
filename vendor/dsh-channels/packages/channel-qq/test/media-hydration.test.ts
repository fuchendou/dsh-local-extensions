/**
 * Media hydration tests (fully offline):
 *
 * - `hydrateMediaParts` unit suite: fake fetcher injected, asserts
 *   localData/size/mime for all four binary kinds (image / file / audio /
 *   video), the URL + abort signal forwarded to the fetcher, failure-code
 *   mapping, the byte-cap 'too-large' path, and that resourceRef-only /
 *   dataUri-only parts are untouched.
 * - InboundProcessor integration: a faked secureFetch proves audio/video
 *   reach the emitted event with localData (+size), and that a failed
 *   download still emits the part with its url + an ingressFailure code
 *   (text delivery never blocked).
 * - capabilities.media: the directional per-kind media map parses via
 *   `mediaCapabilitiesSchema` and legacy booleans stay unchanged.
 */
import { describe, expect, it, vi } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import { ChannelService, SecureRemoteMediaFetcher, mediaCapabilitiesSchema } from '@wsz987/channel-core';
import {
  BodyTooLargeError,
  RemoteMediaError,
  UnsafeHostError,
} from '@wsz987/channel-core';
import { createTestContext } from '@wsz987/channel-testkit';
import type { QQBotInboundMessage } from '@tencent-connect/qqbot-nodejs';
import { InboundProcessor } from '../src/inbound.ts';
import { hydrateMediaParts } from '../src/media-hydrator.ts';
import { mapInbound } from '../src/mapper.ts';
import { QQAdapter, FakeQQSdkClient } from '../src/index.ts';
import { Config } from '../src/config.ts';
import type { AudioPart, FilePart, ImagePart, MessagePart, VideoPart } from '@wsz987/channel-core';

const meta = { channel: 'qq' as never, accountId: 'main' as never };

function makeConfig() {
  return Config({
    enabled: true,
    accountId: 'main',
    appId: 'APP_ID',
    appSecretRef: 'QQBOT_APP_SECRET',
    markdownSupport: false,
    streaming: { enabled: true, throttleMs: 500 },
    dedup: { enabled: true, windowMs: 5000 },
    startupTimeoutMs: 15000,
  });
}

function inbound(overrides: Partial<QQBotInboundMessage> = {}): QQBotInboundMessage {
  return {
    rawEventType: 'C2C_MESSAGE_CREATE',
    kind: 'c2c',
    senderId: 'user_123',
    senderName: 'alice',
    content: 'look',
    messageId: 'msg_1',
    timestamp: '2026-08-14T10:00:00+08:00',
    replyTarget: { scope: 'c2c', targetId: 'user_123', msgId: 'msg_1' },
    raw: {},
    attachments: [],
    ...overrides,
  } as QQBotInboundMessage;
}

/** A fake SecureRemoteMediaFetcher whose fetchBounded is a controllable stub. */
function fakeFetcher() {
  const fetchBounded = vi.fn<(url: string, opts: unknown) => Promise<{ data: Uint8Array; mimeType?: string; finalUrl: string }>>();
  return { fetchBounded, object: { fetchBounded } as unknown as SecureRemoteMediaFetcher };
}

describe('hydrateMediaParts (unit)', () => {
  const bytes = new Uint8Array([1, 2, 3]);

  it('injects localData + mimeType (fetcher wins) for an image with an http(s) url, no size', async () => {
    const fetcher = fakeFetcher();
    fetcher.fetchBounded.mockResolvedValue({ data: bytes, mimeType: 'image/png', finalUrl: 'https://e/p.png' });
    const parts: MessagePart[] = [{ type: 'image', url: 'https://e/p.png', alt: 'p.png' }];

    await hydrateMediaParts(parts, fetcher.object);

    expect(parts[0]).toEqual({
      type: 'image',
      url: 'https://e/p.png',
      alt: 'p.png',
      localData: bytes,
      mimeType: 'image/png',
    });
    expect('size' in parts[0]).toBe(false);
    expect(fetcher.fetchBounded).toHaveBeenCalledTimes(1);
    expect(fetcher.fetchBounded.mock.calls[0]?.[0]).toBe('https://e/p.png');
  });

  it('forwards the abort signal + default byte cap to the fetcher', async () => {
    const fetcher = fakeFetcher();
    fetcher.fetchBounded.mockResolvedValue({ data: bytes, finalUrl: 'https://e/p.png' });
    const controller = new AbortController();
    await hydrateMediaParts(
      [{ type: 'image', url: 'https://e/p.png' }],
      fetcher.object,
      { signal: controller.signal },
    );
    const opts = fetcher.fetchBounded.mock.calls[0]?.[1] as { signal?: AbortSignal; maxBytes?: number };
    expect(opts?.signal).toBe(controller.signal);
    expect(opts?.maxBytes).toBe(20 * 1024 * 1024);
  });

  it('prefers the fetcher mimeType over the platform hint (image)', async () => {
    const fetcher = fakeFetcher();
    fetcher.fetchBounded.mockResolvedValue({ data: bytes, mimeType: 'image/webp', finalUrl: 'https://e/p' });
    const parts: MessagePart[] = [{ type: 'image', url: 'https://e/p', mimeType: 'image/jpeg' }];
    await hydrateMediaParts(parts, fetcher.object);
    expect((parts[0] as ImagePart).mimeType).toBe('image/webp');
  });

  it('keeps the platform mimeType when the fetcher returns none (image)', async () => {
    const fetcher = fakeFetcher();
    fetcher.fetchBounded.mockResolvedValue({ data: bytes, finalUrl: 'https://e/p' });
    const parts: MessagePart[] = [{ type: 'image', url: 'https://e/p', mimeType: 'image/png' }];
    await hydrateMediaParts(parts, fetcher.object);
    expect((parts[0] as ImagePart).mimeType).toBe('image/png');
    expect((parts[0] as ImagePart).localData).toBe(bytes);
  });

  it('is skipped for parts without a url (resourceRef-only parts untouched)', async () => {
    const fetcher = fakeFetcher();
    const parts: MessagePart[] = [{ type: 'image', resourceRef: 'img_123' }];
    await hydrateMediaParts(parts, fetcher.object);
    expect(fetcher.fetchBounded).not.toHaveBeenCalled();
    expect(parts[0]).toEqual({ type: 'image', resourceRef: 'img_123' });
  });

  it('is skipped for parts already carrying localData or dataUri', async () => {
    const fetcher = fakeFetcher();
    const local = new Uint8Array([9]);
    const parts: MessagePart[] = [
      { type: 'image', url: 'https://e/p', localData: local },
      { type: 'image', url: 'https://e/q', dataUri: 'data:image/png;base64,AAA=' },
    ];
    await hydrateMediaParts(parts, fetcher.object);
    expect(fetcher.fetchBounded).not.toHaveBeenCalled();
    expect((parts[0] as ImagePart).localData).toBe(local);
  });

  it('maps body too large to ingressFailure too-large', async () => {
    const fetcher = fakeFetcher();
    fetcher.fetchBounded.mockRejectedValue(new BodyTooLargeError(20));
    const parts: MessagePart[] = [{ type: 'image', url: 'https://e/p' }];
    await hydrateMediaParts(parts, fetcher.object);
    expect(parts[0]).toEqual({ type: 'image', url: 'https://e/p', ingressFailure: 'too-large' });
  });

  it('maps unsafe host to ingressFailure resource-unavailable', async () => {
    const fetcher = fakeFetcher();
    fetcher.fetchBounded.mockRejectedValue(new UnsafeHostError('https://169.254.1.1/p', 'link-local'));
    const parts: MessagePart[] = [{ type: 'image', url: 'https://e/p' }];
    await hydrateMediaParts(parts, fetcher.object);
    expect((parts[0] as ImagePart).ingressFailure).toBe('resource-unavailable');
  });

  it('maps too many redirects to ingressFailure resource-unavailable', async () => {
    const fetcher = fakeFetcher();
    fetcher.fetchBounded.mockRejectedValue(new RemoteMediaError('TOO_MANY_REDIRECTS', 'loop'));
    const parts: MessagePart[] = [{ type: 'image', url: 'https://e/p' }];
    await hydrateMediaParts(parts, fetcher.object);
    expect((parts[0] as ImagePart).ingressFailure).toBe('resource-unavailable');
  });

  it('maps a generic network error to ingressFailure download-failed and keeps url', async () => {
    const fetcher = fakeFetcher();
    fetcher.fetchBounded.mockRejectedValue(new Error('net down'));
    const parts: MessagePart[] = [{ type: 'image', url: 'https://e/p' }];
    await hydrateMediaParts(parts, fetcher.object);
    expect(parts[0]).toEqual({ type: 'image', url: 'https://e/p', ingressFailure: 'download-failed' });
  });

  it('maps non-http url to resource-unavailable without calling the fetcher', async () => {
    const fetcher = fakeFetcher();
    const parts: MessagePart[] = [{ type: 'image', url: 'ftp://e/p' }];
    await hydrateMediaParts(parts, fetcher.object);
    expect(fetcher.fetchBounded).not.toHaveBeenCalled();
    expect(parts[0]).toEqual({ type: 'image', url: 'ftp://e/p', ingressFailure: 'resource-unavailable' });
  });

  it('continues hydrating the next part when one fails', async () => {
    const fetcher = fakeFetcher();
    fetcher.fetchBounded.mockRejectedValueOnce(new Error('boom'));
    fetcher.fetchBounded.mockResolvedValueOnce({ data: bytes, mimeType: 'image/jpeg', finalUrl: 'https://e/q' });
    const parts: MessagePart[] = [
      { type: 'image', url: 'https://e/one' },
      { type: 'image', url: 'https://e/two' },
    ];
    await hydrateMediaParts(parts, fetcher.object);
    expect((parts[0] as ImagePart).ingressFailure).toBe('download-failed');
    expect((parts[1] as ImagePart).localData).toBe(bytes);
  });

  it('inflates a file part with localData + mimeType + size', async () => {
    const fetcher = fakeFetcher();
    fetcher.fetchBounded.mockResolvedValue({
      data: bytes,
      mimeType: 'application/pdf',
      finalUrl: 'https://e/r.pdf',
    });
    const parts: MessagePart[] = [{ type: 'file', url: 'https://e/r.pdf', name: 'r.pdf', size: 4096 }];

    await hydrateMediaParts(parts, fetcher.object);

    expect(parts[0]).toEqual({
      type: 'file',
      url: 'https://e/r.pdf',
      name: 'r.pdf',
      localData: bytes,
      mimeType: 'application/pdf',
      size: 3,
    });
    expect(fetcher.fetchBounded).toHaveBeenCalledTimes(1);
  });

  it('file: uses the hydrated byte length as size and falls back to a sniffed mime', async () => {
    const fetcher = fakeFetcher();
    fetcher.fetchBounded.mockResolvedValue({ data: new Uint8Array(5), finalUrl: 'https://e/d.docx' });
    const parts: MessagePart[] = [{ type: 'file', url: 'https://e/d.docx', name: 'report.docx' }];

    await hydrateMediaParts(parts, fetcher.object);

    expect((parts[0] as FilePart).size).toBe(5);
    expect((parts[0] as FilePart).mimeType).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
  });

  it('file: keeps url + a stable ingressFailure code when the download fails', async () => {
    const fetcher = fakeFetcher();
    fetcher.fetchBounded.mockRejectedValue(new Error('file fetch down'));
    const parts: MessagePart[] = [{ type: 'file', url: 'https://e/r.bin', name: 'r.bin' }];

    await hydrateMediaParts(parts, fetcher.object);

    expect(parts[0]).toEqual({
      type: 'file',
      url: 'https://e/r.bin',
      name: 'r.bin',
      ingressFailure: 'download-failed',
    });
    expect((parts[0] as FilePart).localData).toBeUndefined();
  });

  it('audio: hydrates a voice/audio url into localData + size + mimeType', async () => {
    const fetcher = fakeFetcher();
    fetcher.fetchBounded.mockResolvedValue({ data: bytes, mimeType: 'audio/wav', finalUrl: 'https://e/a.wav' });
    const parts: MessagePart[] = [{ type: 'audio', url: 'https://e/a.wav' }];

    await hydrateMediaParts(parts, fetcher.object);

    expect(parts[0]).toEqual({
      type: 'audio',
      url: 'https://e/a.wav',
      localData: bytes,
      size: 3,
      mimeType: 'audio/wav',
    });
    expect(fetcher.fetchBounded).toHaveBeenCalledTimes(1);
  });

  it('video: hydrates a video url into localData + size + mimeType', async () => {
    const fetcher = fakeFetcher();
    fetcher.fetchBounded.mockResolvedValue({ data: bytes, mimeType: 'video/mp4', finalUrl: 'https://e/c.mp4' });
    const parts: MessagePart[] = [{ type: 'video', url: 'https://e/c.mp4' }];

    await hydrateMediaParts(parts, fetcher.object);

    expect(parts[0]).toEqual({
      type: 'video',
      url: 'https://e/c.mp4',
      localData: bytes,
      size: 3,
      mimeType: 'video/mp4',
    });
    expect(fetcher.fetchBounded).toHaveBeenCalledTimes(1);
  });

  it('audio: keeps url + ingressFailure (no localData) when the download fails', async () => {
    const fetcher = fakeFetcher();
    fetcher.fetchBounded.mockRejectedValue(new Error('voice fetch refused'));
    const parts: MessagePart[] = [{ type: 'audio', url: 'https://e/a.wav' }];

    await hydrateMediaParts(parts, fetcher.object);

    expect(parts[0]).toEqual({
      type: 'audio',
      url: 'https://e/a.wav',
      ingressFailure: 'download-failed',
    });
    expect((parts[0] as AudioPart).localData).toBeUndefined();
  });

  it('drops an oversized result with only ingressFailure too-large (no merge)', async () => {
    const fetcher = fakeFetcher();
    // The fake doesn't enforce the cap itself; applyHydrationResult does.
    fetcher.fetchBounded.mockResolvedValue({ data: new Uint8Array(6), mimeType: 'video/mp4', finalUrl: 'https://e/big.mp4' });
    const parts: MessagePart[] = [{ type: 'video', url: 'https://e/big.mp4' }];

    await hydrateMediaParts(parts, fetcher.object, { maxBytes: 4 });

    expect(parts[0]).toEqual({ type: 'video', url: 'https://e/big.mp4', ingressFailure: 'too-large' });
    expect((parts[0] as VideoPart).localData).toBeUndefined();
    expect((parts[0] as VideoPart).size).toBeUndefined();
    expect((parts[0] as VideoPart).mimeType).toBeUndefined();
  });

  it('a pre-aborted signal fails fast with download-failed and never fetches', async () => {
    const fetcher = fakeFetcher();
    const controller = new AbortController();
    controller.abort();
    const parts: MessagePart[] = [{ type: 'video', url: 'https://e/c.mp4' }];

    await hydrateMediaParts(parts, fetcher.object, { signal: controller.signal });

    expect(fetcher.fetchBounded).not.toHaveBeenCalled();
    expect(parts[0]).toEqual({ type: 'video', url: 'https://e/c.mp4', ingressFailure: 'download-failed' });
  });
});

describe('InboundProcessor media hydration (integration)', () => {
  function makeProcessor(fetcher: SecureRemoteMediaFetcher, captured: (e: unknown) => void) {
    const service = new ChannelService(new Context());
    const ctx = createTestContext(service);
    const off = service.on((e) => captured(e));
    const processor = new InboundProcessor({
      ctx,
      meta,
      dedupEnabled: false,
      dedupWindowMs: 0,
      secureFetch: fetcher,
    });
    return { processor, ctx, off };
  }

  it('accepts legacy imageHydration and gives mediaHydration precedence', async () => {
    const fetcher = fakeFetcher();
    fetcher.fetchBounded.mockResolvedValue({
      data: new Uint8Array([1]),
      mimeType: 'image/png',
      finalUrl: 'https://e/p.png',
    });
    const service = new ChannelService(new Context());
    const ctx = createTestContext(service);
    const shared = {
      ctx,
      meta,
      dedupEnabled: false,
      dedupWindowMs: 0,
      secureFetch: fetcher.object,
    };

    const legacyProcessor = new InboundProcessor({
      ...shared,
      imageHydration: { maxBytes: 101 },
    });
    await legacyProcessor.handle(inbound({
      attachments: [{ content_type: 'image/png', url: 'https://e/p.png', filename: 'p.png' }],
    }));
    expect(fetcher.fetchBounded.mock.calls[0]?.[1]).toMatchObject({ maxBytes: 101 });

    const preferredProcessor = new InboundProcessor({
      ...shared,
      imageHydration: { maxBytes: 202 },
      mediaHydration: { maxBytes: 303 },
    });
    await preferredProcessor.handle(inbound({
      messageId: 'msg_2',
      attachments: [{ content_type: 'image/png', url: 'https://e/p.png', filename: 'p.png' }],
    }));
    expect(fetcher.fetchBounded.mock.calls[1]?.[1]).toMatchObject({ maxBytes: 303 });
  });

  it('emits an event whose audio part carries localData + size + mimeType', async () => {
    const fetcher = fakeFetcher();
    fetcher.fetchBounded.mockResolvedValue({
      data: new Uint8Array([7, 8, 9]),
      mimeType: 'audio/wav',
      finalUrl: 'https://e/a.wav',
    });
    const captured: unknown[] = [];
    const { processor, ctx, off } = makeProcessor(fetcher.object, (e) => captured.push(e));
    try {
      const ev = mapInbound(
        inbound({
          content: '',
          attachments: [
            { content_type: 'voice', url: 'https://e/a.silk', filename: 'a.silk', voice_wav_url: 'https://e/a.wav' },
          ],
        }),
        meta,
      );
      const aud = ev.message.content.find((p): p is AudioPart => p.type === 'audio')!;
      expect(aud.url).toBe('https://e/a.wav');
      expect(aud.localData).toBeUndefined();

      await processor.handle(
        inbound({
          content: '',
          attachments: [
            { content_type: 'voice', url: 'https://e/a.silk', filename: 'a.silk', voice_wav_url: 'https://e/a.wav' },
          ],
        }),
      );

      const received = captured.find((e) => (e as { type: string }).type === 'message.received') as
        | { message: { content: MessagePart[] } }
        | undefined;
      const emittedAudio = received?.message.content.find((p): p is AudioPart => p.type === 'audio');
      expect(emittedAudio).toBeDefined();
      expect(emittedAudio?.url).toBe('https://e/a.wav');
      expect(emittedAudio?.localData).toEqual(new Uint8Array([7, 8, 9]));
      expect(emittedAudio?.size).toBe(3);
      expect(emittedAudio?.mimeType).toBe('audio/wav');

      // The abort signal handed to the processor context was forwarded.
      const opts = fetcher.fetchBounded.mock.calls[0]?.[1] as { signal?: AbortSignal };
      expect(opts?.signal).toBe(ctx.signal);
    } finally {
      off();
    }
  });

  it('emits an event whose video part carries localData + size', async () => {
    const fetcher = fakeFetcher();
    fetcher.fetchBounded.mockResolvedValue({
      data: new Uint8Array([4, 5, 6, 7]),
      mimeType: 'video/mp4',
      finalUrl: 'https://e/clip.mp4',
    });
    const captured: unknown[] = [];
    const { processor, off } = makeProcessor(fetcher.object, (e) => captured.push(e));
    try {
      await processor.handle(
        inbound({
          content: 'see clip',
          attachments: [{ content_type: 'video/mp4', url: 'https://e/clip.mp4', filename: 'clip.mp4' }],
        }),
      );
      const received = captured.find((e) => (e as { type: string }).type === 'message.received') as {
        message: { content: MessagePart[] };
      } | undefined;
      const text = received?.message.content.find((p) => p.type === 'text') as { text?: string } | undefined;
      const video = received?.message.content.find((p): p is VideoPart => p.type === 'video');
      expect(text?.text).toBe('see clip');
      expect(video).toBeDefined();
      expect(video?.url).toBe('https://e/clip.mp4');
      expect(video?.localData).toEqual(new Uint8Array([4, 5, 6, 7]));
      expect(video?.size).toBe(4);
      expect(video?.mimeType).toBe('video/mp4');
    } finally {
      off();
    }
  });

  it('still emits (audio url retained + ingressFailure) when the download fails', async () => {
    const fetcher = fakeFetcher();
    fetcher.fetchBounded.mockRejectedValue(new Error('connection refused'));
    const captured: unknown[] = [];
    const { processor, off } = makeProcessor(fetcher.object, (e) => captured.push(e));
    try {
      await processor.handle(
        inbound({
          content: 'keep me',
          attachments: [
            { content_type: 'voice', url: 'https://e/a.silk', filename: 'a.silk', voice_wav_url: 'https://e/a.wav' },
          ],
        }),
      );
      const received = captured.find((e) => (e as { type: string }).type === 'message.received') as {
        message: { content: MessagePart[] };
      } | undefined;
      const text = received?.message.content.find((p) => p.type === 'text') as { text?: string } | undefined;
      const audio = received?.message.content.find((p): p is AudioPart => p.type === 'audio');
      // Text delivery is never blocked.
      expect(text?.text).toBe('keep me');
      // The audio part is retained with its locator + a stable failure code.
      expect(audio?.url).toBe('https://e/a.wav');
      expect(audio?.ingressFailure).toBe('download-failed');
      expect(audio?.localData).toBeUndefined();
    } finally {
      off();
    }
  });
});

describe('capabilities.media', () => {
  it('declares directional per-kind media capabilities (schema-valid)', () => {
    const adapter = new QQAdapter(makeConfig(), { sdkClient: new FakeQQSdkClient() });
    const media = mediaCapabilitiesSchema.parse(adapter.capabilities.media);
    expect(media.inbound).toEqual({
      image: 'bytes',
      file: 'bytes',
      audio: 'bytes',
      video: 'bytes',
    });
    expect(media.outbound).toEqual({
      image: 'bytes',
      file: 'bytes',
      audio: 'bytes',
      video: 'bytes',
    });
  });

  it('keeps the legacy capability booleans unchanged', () => {
    const adapter = new QQAdapter(makeConfig(), { sdkClient: new FakeQQSdkClient() });
    const caps = adapter.capabilities;
    expect(caps.text).toBe(true);
    expect(caps.image).toBe(true);
    expect(caps.file).toBe(true);
    expect(caps.audio).toBe(true);
    expect(caps.video).toBe(true);
    expect(caps.streaming).toBe('buffered');
  });
});

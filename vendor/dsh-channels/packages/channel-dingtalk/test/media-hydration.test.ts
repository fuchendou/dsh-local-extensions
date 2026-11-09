/**
 * DingTalk audio/video inbound hydration.
 *
 * Audio/video parts follow the SAME URL-or-opaque resolution as image/file:
 *   - genuine http(s) url -> SecureRemoteMediaFetcher -> localData + mimeType + size
 *   - opaque handle (downloadCode / mediaUrl) -> moved to resourceRef ->
 *     DingTalk OpenAPI media resolver (official `messageFiles/download` seam)
 *     -> localData (the connector oracle downloads voice/video the same way)
 * Failures keep the locator and stamp a stable `ingressFailure`; the media
 * failure never blocks the message. Fully offline (fake fetcher + resolver).
 */
import { describe, expect, it, vi } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import { BodyTooLargeError, ChannelService, type MessageReceived } from '@wsz987/channel-core';
import { createTestContext } from '@wsz987/channel-testkit';
import { InboundProcessor, type MediaResolverLike, type RemoteMediaFetchLike } from '../src/index.ts';

/** A fake secure fetcher that records calls and returns one bounded result. */
function okFetcher(): { fetcher: RemoteMediaFetchLike; calls: string[] } {
  const calls: string[] = [];
  const fetcher: RemoteMediaFetchLike = {
    async fetchBounded(url) {
      calls.push(url);
      return { data: new Uint8Array([3, 1, 4, 1, 5]), mimeType: 'audio/mpeg', finalUrl: url };
    },
  };
  return { fetcher, calls };
}

/** A fake resolveMedia that turns an opaque handle into bytes. */
function okResolver(): {
  resolver: MediaResolverLike;
  calls: { ref: string; options?: { signal?: AbortSignal; name?: string; downloadCode?: string; robotCode?: string } }[];
} {
  const calls: { ref: string; options?: { signal?: AbortSignal; name?: string; downloadCode?: string; robotCode?: string } }[] = [];
  const resolver: MediaResolverLike = {
    async resolveMedia(ref, options) {
      calls.push({ ref, options });
      return { data: new Uint8Array([9, 9, 9]), mimeType: 'audio/amr', size: 3 };
    },
  };
  return { resolver, calls };
}

/** Build the inbound processor with injected fetcher + resolver. */
function makeProcessor(opts: { fetcher?: RemoteMediaFetchLike; resolver?: MediaResolverLike } = {}) {
  const service = new ChannelService(new Context());
  const ctx = createTestContext(service);
  const processor = new InboundProcessor({
    ctx,
    meta: { channel: 'dingtalk' as never, accountId: 'main' as never },
    dedupEnabled: false,
    dedupWindowMs: 5000,
    secureFetch: opts.fetcher,
    resolveMedia: opts.resolver,
  });
  return { processor, service, ctx };
}

async function handleMedia(
  raw: Record<string, unknown>,
  processor: InboundProcessor,
  service: ChannelService,
): Promise<MessageReceived[]> {
  const received: MessageReceived[] = [];
  service.on((event) => { if (event.type === 'message.received') received.push(event); });
  await processor.handle(raw);
  return received;
}

describe('InboundProcessor audio hydration', () => {
  it('audio with a genuine http(s) url -> fetched into localData + mimeType + size', async () => {
    const { fetcher, calls } = okFetcher();
    const { processor, service, ctx } = makeProcessor({ fetcher });
    const received = await handleMedia(
      { type: 'audio', msgId: 'a1', senderId: 'u1', conversationId: 'c1', mediaUrl: 'https://dingtalk.example/a.mp3', durationMs: 5200 },
      processor,
      service,
    );
    expect(received).toHaveLength(1);
    const part = received[0]?.message.content[0] as Record<string, unknown>;
    expect(part).toMatchObject({ type: 'audio', url: 'https://dingtalk.example/a.mp3', mimeType: 'audio/mpeg', durationMs: 5200 });
    expect(Array.from(part.localData as Uint8Array)).toEqual([3, 1, 4, 1, 5]);
    expect(part.size).toBe(5);
    expect(calls).toEqual(['https://dingtalk.example/a.mp3']);
    await ctx.dispose();
  });

  it('audio with an opaque downloadCode -> resolveMedia (downloadCode seam) into localData', async () => {
    const { resolver, calls } = okResolver();
    const { processor, service, ctx } = makeProcessor({ resolver });
    const received = await handleMedia(
      { type: 'audio', msgId: 'a2', senderId: 'u1', conversationId: 'c1', downloadCode: 'dl-audio-1', robotCode: 'rb-1', durationMs: 3300 },
      processor,
      service,
    );
    expect(received).toHaveLength(1);
    const part = received[0]?.message.content[0] as Record<string, unknown>;
    // Opaque handle moved to resourceRef; url removed; resolved via the port.
    expect(part).toMatchObject({ type: 'audio', resourceRef: 'dl-audio-1', durationMs: 3300 });
    expect(part.url).toBeUndefined();
    expect(Array.from(part.localData as Uint8Array)).toEqual([9, 9, 9]);
    expect(part.mimeType).toBe('audio/amr');
    expect(part.size).toBe(3);
    expect(calls.map((c) => c.ref)).toEqual(['dl-audio-1']);
    expect(calls[0]?.options).toMatchObject({ downloadCode: 'dl-audio-1', robotCode: 'rb-1' });
    await ctx.dispose();
  });

  it('audio resolution failure -> keeps resourceRef + stable ingressFailure', async () => {
    const failResolver: MediaResolverLike = {
      async resolveMedia() {
        throw new Error('unresolvable');
      },
    };
    const { processor, service, ctx } = makeProcessor({ resolver: failResolver });
    const received = await handleMedia(
      { type: 'audio', msgId: 'a3', senderId: 'u1', conversationId: 'c1', downloadCode: 'dl-bad' },
      processor,
      service,
    );
    expect(received).toHaveLength(1);
    const part = received[0]?.message.content[0] as Record<string, unknown>;
    expect(part).toMatchObject({ type: 'audio', resourceRef: 'dl-bad' });
    expect(part.localData).toBeUndefined();
    expect(part.ingressFailure).toBe('download-failed');
    await ctx.dispose();
  });

  it('audio URL oversize -> too-large, locator retained, no localData, text still emitted', async () => {
    const throwFetcher: RemoteMediaFetchLike = {
      async fetchBounded() {
        throw new BodyTooLargeError(100 * 1024 * 1024, 'exceeds cap');
      },
    };
    const { processor, service, ctx } = makeProcessor({ fetcher: throwFetcher });
    const received = await handleMedia(
      { type: 'audio', msgId: 'a4', senderId: 'u1', conversationId: 'c1', mediaUrl: 'https://dingtalk.example/big.mp3' },
      processor,
      service,
    );
    expect(received).toHaveLength(1);
    const part = received[0]?.message.content[0] as Record<string, unknown>;
    expect(part).toMatchObject({ type: 'audio', url: 'https://dingtalk.example/big.mp3', ingressFailure: 'too-large' });
    expect(part.localData).toBeUndefined();
    await ctx.dispose();
  });
});

describe('InboundProcessor video hydration', () => {
  it('video with a genuine http(s) url -> fetched into localData + mimeType + size', async () => {
    const { fetcher, calls } = okFetcher();
    const { processor, service, ctx } = makeProcessor({ fetcher });
    const received = await handleMedia(
      { type: 'video', msgId: 'v1', senderId: 'u1', conversationId: 'c1', mediaUrl: 'https://dingtalk.example/v.mp4', durationMs: 12345 },
      processor,
      service,
    );
    expect(received).toHaveLength(1);
    const part = received[0]?.message.content[0] as Record<string, unknown>;
    expect(part).toMatchObject({ type: 'video', url: 'https://dingtalk.example/v.mp4', durationMs: 12345 });
    expect(Array.from(part.localData as Uint8Array)).toEqual([3, 1, 4, 1, 5]);
    expect(part.mimeType).toBe('audio/mpeg');
    expect(part.size).toBe(5);
    expect(calls).toEqual(['https://dingtalk.example/v.mp4']);
    await ctx.dispose();
  });

  it('video with an opaque downloadCode -> resolveMedia (downloadCode seam) into localData', async () => {
    const { resolver, calls } = okResolver();
    const { processor, service, ctx } = makeProcessor({ resolver });
    const received = await handleMedia(
      { type: 'video', msgId: 'v2', senderId: 'u1', conversationId: 'c1', downloadCode: 'dl-video-1', robotCode: 'rb-1', durationMs: 9000 },
      processor,
      service,
    );
    expect(received).toHaveLength(1);
    const part = received[0]?.message.content[0] as Record<string, unknown>;
    expect(part).toMatchObject({ type: 'video', resourceRef: 'dl-video-1', durationMs: 9000 });
    expect(part.url).toBeUndefined();
    expect(Array.from(part.localData as Uint8Array)).toEqual([9, 9, 9]);
    expect(calls.map((c) => c.ref)).toEqual(['dl-video-1']);
    expect(calls[0]?.options).toMatchObject({ downloadCode: 'dl-video-1', robotCode: 'rb-1' });
    await ctx.dispose();
  });

  it('video resolution failure -> keeps resourceRef + stable ingressFailure', async () => {
    const failResolver: MediaResolverLike = {
      async resolveMedia() {
        throw new Error('video unresolved');
      },
    };
    const { processor, service, ctx } = makeProcessor({ resolver: failResolver });
    const received = await handleMedia(
      { type: 'video', msgId: 'v3', senderId: 'u1', conversationId: 'c1', downloadCode: 'dl-vbad' },
      processor,
      service,
    );
    expect(received).toHaveLength(1);
    const part = received[0]?.message.content[0] as Record<string, unknown>;
    expect(part).toMatchObject({ type: 'video', resourceRef: 'dl-vbad', ingressFailure: 'download-failed' });
    expect(part.localData).toBeUndefined();
    await ctx.dispose();
  });

  it('video URL oversize -> too-large, locator retained, no localData', async () => {
    const throwFetcher: RemoteMediaFetchLike = {
      async fetchBounded() {
        throw new BodyTooLargeError(100 * 1024 * 1024, 'exceeds cap');
      },
    };
    const { processor, service, ctx } = makeProcessor({ fetcher: throwFetcher });
    const received = await handleMedia(
      { type: 'video', msgId: 'v4', senderId: 'u1', conversationId: 'c1', mediaUrl: 'https://dingtalk.example/big.mp4' },
      processor,
      service,
    );
    expect(received).toHaveLength(1);
    const part = received[0]?.message.content[0] as Record<string, unknown>;
    expect(part).toMatchObject({ type: 'video', url: 'https://dingtalk.example/big.mp4', ingressFailure: 'too-large' });
    expect(part.localData).toBeUndefined();
    await ctx.dispose();
  });

  it('media failure never blocks a sibling text part (text still emitted)', async () => {
    const throwFetcher: RemoteMediaFetchLike = {
      async fetchBounded() {
        throw new Error('network down');
      },
    };
    const { processor, service, ctx } = makeProcessor({ fetcher: throwFetcher });
    const received: MessageReceived[] = [];
    service.on((event) => { if (event.type === 'message.received') received.push(event); });
    // richText audio/video aren't produced by the mapper; a video alone still
    // emits (the processor does not gate emission on hydration success).
    await processor.handle({ type: 'video', msgId: 'v5', senderId: 'u1', conversationId: 'c1', mediaUrl: 'https://dingtalk.example/v.mp4' });
    expect(received).toHaveLength(1);
    const part = received[0]?.message.content[0] as Record<string, unknown>;
    expect(part).toMatchObject({ type: 'video', ingressFailure: 'download-failed' });
    await ctx.dispose();
  });

  it('opaque media without a resolver stays on resourceRef (delivered, unresolved)', async () => {
    const { processor, service, ctx } = makeProcessor();
    const received = await handleMedia(
      { type: 'video', msgId: 'v6', senderId: 'u1', conversationId: 'c1', downloadCode: 'dl-unresolved' },
      processor,
      service,
    );
    expect(received).toHaveLength(1);
    const part = received[0]?.message.content[0] as Record<string, unknown>;
    expect(part).toMatchObject({ type: 'video', resourceRef: 'dl-unresolved' });
    expect(part.localData).toBeUndefined();
    await ctx.dispose();
  });

  it('never writes platform media locators to adapter logs', async () => {
    const { processor, service, ctx } = makeProcessor();
    const debug = vi.fn();
    const info = vi.fn();
    const warn = vi.fn();
    const error = vi.fn();
    Object.assign(ctx.logger, { debug, info, warn, error });

    await handleMedia(
      {
        type: 'video',
        msgId: 'v-log',
        senderId: 'u1',
        conversationId: 'c1',
        downloadCode: 'secret-download-code',
        robotCode: 'secret-robot-code',
      },
      processor,
      service,
    );
    await handleMedia(
      {
        type: 'picture',
        msgId: 'image-log',
        senderId: 'u1',
        conversationId: 'c1',
        picMediaId: 'secret-media-id',
        picDownloadCode: 'secret-image-code',
      },
      processor,
      service,
    );

    const serializedLogs = JSON.stringify([
      ...debug.mock.calls,
      ...info.mock.calls,
      ...warn.mock.calls,
      ...error.mock.calls,
    ]);
    expect(serializedLogs).not.toContain('secret-download-code');
    expect(serializedLogs).not.toContain('secret-robot-code');
    expect(serializedLogs).not.toContain('secret-media-id');
    expect(serializedLogs).not.toContain('secret-image-code');
    await ctx.dispose();
  });
});

/**
 * media-hydration-regression.test.ts — Weixin binary media path regression.
 *
 * Weixin is the ONLY channel that already hydrates all four binary kinds —
 * image / file / voice (audio) / video — to `localData` before the monitor
 * emits. This file pins that behavior as regression:
 *
 *   1. all four inbound kinds reach the emitted event with decrypted
 *      (+ transcoded) localData bytes (the decrypt/transcode pipeline itself is
 *      byte-identity-tested in upstream-facade.test.ts §B — here we assert the
 *      contract-level facts: localData present, `size`/`name`/`mimeType` set);
 *   2. a failed download keeps the locator part, sets `ingressFailure` and
 *      never fabricates bytes (the missing `ingressFailure` assertion that
 *      upstream-facade.test.ts 'keeps the URL-only part' currently skips);
 *   3. `capabilities.media` parses via the channel-core
 *      `mediaCapabilitiesSchema` and declares per-kind inbound 'bytes' and
 *      outbound image/file/video 'bytes' / audio 'unsupported'.
 *
 * This file intentionally does not re-test byte-identity of AES decrypt /
 * Silk transcode end-to-end (covered by upstream-facade.test.ts §B and
 * silk-transcode.test.ts); it stays focused and fast.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import {
  ChannelService,
  BINARY_KINDS,
  mediaCapabilitiesSchema,
  capabilitiesSchema,
} from '@wsz987/channel-core';
import type { ChannelAdapterContext } from '@wsz987/channel-core';
import { createTestContext } from '@wsz987/channel-testkit';
import { WeixinAdapter } from '../src/adapter.js';
import { Config } from '../src/config.js';
import type { WeixinConfig } from '../src/config.js';
import type { HttpTransport } from '../src/index.js';
import { aes128Encrypt } from '../src/index.js';
import { AccountCredentialStore } from '../src/auth/account-store.js';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

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
  try { const u = new URL(url); return u.pathname + (u.search ? u.search : ''); } catch { return url; }
}

const HEX_KEY = '00112233445566778899aabbccddeeff';
const KEY_BUF = Buffer.from(HEX_KEY, 'hex');

const credential = {
  token: 'bot-token-secret', ilinkBotId: 'bot-1', userId: 'wx-user',
  baseUrl: 'https://fake.ilink.test', savedAt: new Date(1700000000000).toISOString(),
};

async function seedCredential(ctx: ChannelAdapterContext) {
  const store = new AccountCredentialStore({ secrets: ctx.secrets, storage: ctx.storage, accountId: 'main', now: () => 1700000000000 });
  await store.save(credential);
}

/** One long-poll getUpdates round serving `msg`, then a pending long-poll. */
function routeGetUpdates(transport: FakeTransport, msg: unknown): void {
  let calls = 0;
  transport.route('/ilink/bot/msg/notifystart', () => ({ ret: 0 }));
  transport.route('/ilink/bot/msg/notifystop', () => ({ ret: 0 }));
  transport.route('/ilink/bot/getupdates', () => {
    calls += 1;
    if (calls === 1) return { ret: 0, msgs: [msg], get_updates_buf: 'reg-buf-next' };
    return new Promise(() => { /* hold long-poll open */ });
  });
}

async function receiveInbound(msg: unknown, fetchImpl: typeof fetch): Promise<any[]> {
  const transport = new FakeTransport();
  routeGetUpdates(transport, msg);
  (globalThis as any).fetch = fetchImpl;

  const service = new ChannelService(new Context());
  const ctx = createTestContext(service);
  await seedCredential(ctx);

  const events: any[] = [];
  service.on((...args: any[]) => events.push(args[0]));
  const adapter = new WeixinAdapter(makeConfig(), { transport, now: () => 1700000000000, rand: () => 0.5 });
  await adapter.start(ctx);
  await vi.waitFor(
    () => expect(events.some((e) => e?.type === 'message.received')).toBe(true),
    { timeout: 3000 },
  );
  await ctx.dispose();
  await adapter.stop();
  return events;
}

const OLD_FETCH = globalThis.fetch;
afterEach(() => { (globalThis as any).fetch = OLD_FETCH; });

/* ------------------------------------------------------------------ */
/* 1. All four inbound kinds hydrate to localData before emit           */
/* ------------------------------------------------------------------ */

describe('weixin inbound media hydration regression (plan A6)', () => {
  it('hydrates image/file/voice/video in one message to localData > 0 before emit', async () => {
    const plains = {
      image: Buffer.from('image plaintext bytes'),
      file: Buffer.from('%PDF-1.7 regression report'),
      voice: Buffer.from('silk voice regression bytes'),
      video: Buffer.from('mp4 video regression bytes'),
    };
    const encrypted = [
      aes128Encrypt(plains.image, KEY_BUF),
      aes128Encrypt(plains.file, KEY_BUF),
      aes128Encrypt(plains.voice, KEY_BUF),
      aes128Encrypt(plains.video, KEY_BUF),
    ];
    let fetchIndex = 0;
    const events = await receiveInbound({
      message_id: 200,
      from_user_id: 'user_1',
      create_time_ms: 1700000000000,
      context_token: 'ctx-reg',
      item_list: [
        { type: 2, image_item: { url: 'https://c/i', aeskey: HEX_KEY, media: { full_url: 'https://c/i?enc=1', encrypt_query_param: 'x', aes_key: '' } } },
        { type: 4, file_item: { file_name: 'report.pdf', media: { full_url: 'https://c/report?enc=1', aes_key: Buffer.from(HEX_KEY, 'ascii').toString('base64') } } },
        { type: 3, voice_item: { encode_type: 6, sample_rate: 16000, media: { full_url: 'https://c/voice', aes_key: KEY_BUF.toString('base64') } } },
        { type: 5, video_item: { media: { full_url: 'https://c/video', aes_key: KEY_BUF.toString('base64') } } },
      ],
    }, async () => new Response(new Uint8Array(encrypted[fetchIndex++]!), { status: 200 }) as unknown as Response);

    const parts = events.find((e) => e?.type === 'message.received').message.content as any[];
    expect(fetchIndex).toBe(4); // every kind downloaded exactly once

    const image = parts.find((p) => p.type === 'image');
    const file = parts.find((p) => p.type === 'file');
    const audio = parts.find((p) => p.type === 'audio');
    const video = parts.find((p) => p.type === 'video');
    expect(image).toBeDefined();
    expect(file).toBeDefined();
    expect(audio).toBeDefined();
    expect(video).toBeDefined();

    // Decrypted bytes present for every kind (hydrated, not URL-only).
    expect(Buffer.from(image.localData as Uint8Array)).toEqual(plains.image);
    expect(Buffer.from(file.localData as Uint8Array)).toEqual(plains.file);
    expect(Buffer.from(audio.localData as Uint8Array)).toEqual(plains.voice);
    expect(Buffer.from(video.localData as Uint8Array)).toEqual(plains.video);
    for (const part of [image, file, audio, video]) {
      expect(part.localData.byteLength).toBeGreaterThan(0);
      expect(part.ingressFailure).toBeUndefined();
    }

    // Kind hints survive hydration.
    expect(image.mimeType).toBe('image/jpeg');
    expect(file).toMatchObject({ name: 'report.pdf', mimeType: 'application/pdf', size: plains.file.byteLength });
    // Voice keeps the raw-SILK fallback mime when the optional codec cannot
    // decode (mirrors upstream-facade.test.ts §B assertion).
    expect(audio.mimeType).toBe('audio/silk');
    expect(video.mimeType).toBe('video/mp4');
  });

  it('retains a part with ingressFailure and no localData when the download fails', async () => {
    const events = await receiveInbound({
      message_id: 201,
      from_user_id: 'user_1',
      create_time_ms: 1700000000000,
      item_list: [{
        type: 2,
        image_item: { url: 'https://c/i', aeskey: HEX_KEY, media: { full_url: 'https://c/i?enc=1', encrypt_query_param: 'x', aes_key: '' } },
      }],
    }, async () => { throw new Error('network down'); });

    const parts = events.find((e) => e?.type === 'message.received').message.content as any[];
    const image = parts.find((p) => p.type === 'image');
    expect(image).toBeDefined();
    // The locator part survives; no bytes were fabricated.
    expect(image.localData).toBeUndefined();
    expect(image.url).toBe('https://c/i?enc=1');
    expect(image.ingressFailure).toBe('download-failed');
  });
});

/* ------------------------------------------------------------------ */
/* 2. capabilities.media contract                              */
/* ------------------------------------------------------------------ */

describe('weixin capabilities.media contract', () => {
  it('parses via mediaCapabilitiesSchema with inbound bytes for all four kinds', () => {
    const adapter = new WeixinAdapter(makeConfig());
    expect(adapter.capabilities.media).toBeDefined();

    const media = mediaCapabilitiesSchema.parse(adapter.capabilities.media);
    expect(media.inbound).toMatchObject({ image: 'bytes', file: 'bytes', audio: 'bytes', video: 'bytes' });
    for (const kind of BINARY_KINDS) {
      expect(media.inbound[kind], `inbound.${kind}`).toBeDefined();
    }
  });

  it('declares outbound bytes for image/file/video and unsupported for audio', () => {
    const adapter = new WeixinAdapter(makeConfig());
    const media = mediaCapabilitiesSchema.parse(adapter.capabilities.media!);
    expect(media.outbound).toMatchObject({
      image: 'bytes',
      file: 'bytes',
      video: 'bytes',
      audio: 'unsupported',
    });
  });

  it('keeps the legacy coarse flags unchanged and the full capabilities parse', () => {
    const adapter = new WeixinAdapter(makeConfig());
    const caps = capabilitiesSchema.parse(adapter.capabilities);
    expect(caps).toMatchObject({
      text: true,
      image: true,
      file: true,
      audio: false,
      video: true,
      streaming: 'buffered',
    });
  });
});
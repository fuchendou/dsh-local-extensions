/**
 * Protocol-neutral binary hydration helper + directional media capabilities.
 *
 * Covers `applyHydrationResult` (incl. the too-large / size edge), the
 * `isHydratableBinaryPart` type guard, `mediaCapabilitiesSchema`, and the
 * `capabilities.media` extension — including the public package surface via
 * `src/index.js`.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  BodyTooLargeError,
  RemoteMediaError,
} from '../src/media/bounded-response.js';
import {
  applyHydrationResult,
  BINARY_KINDS,
  isHydratableBinaryPart,
  type BinaryHydrationResult,
} from '../src/media/hydration.js';
import type { MessagePart } from '../src/messages.js';
import {
  capabilitiesSchema,
  mediaCapabilitiesSchema,
} from '../src/schema.js';
import * as core from '../src/index.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const decode = (b: Uint8Array | undefined): string | undefined =>
  b === undefined ? undefined : new TextDecoder().decode(b);

describe('applyHydrationResult', () => {
  it('skips resolve() when part.localData is already present (no double download)', async () => {
    const part = {
      type: 'image',
      localData: new Uint8Array([1, 2, 3]),
      mimeType: 'image/png',
      size: 3,
    } as const;
    const resolve = vi.fn<() => Promise<BinaryHydrationResult>>();

    await applyHydrationResult(part, resolve, {
      maxBytes: 2,
      signal: new AbortController().signal,
    });

    expect(resolve).not.toHaveBeenCalled();
    expect(decode(part.localData)).toBe('\u0001\u0002\u0003');
    expect(part.localData?.byteLength).toBe(3);
    expect(part.mimeType).toBe('image/png');
    expect(part.size).toBe(3);
    // An already-hydrated part wins even over a failing policy.
    expect(part.ingressFailure).toBeUndefined();
  });

  it('applies a successful resolve: localData, size, mime/name merge, cleared failure', async () => {
    const part = {
      type: 'file',
      ingressFailure: 'download-failed',
      mimeType: 'application/old',
    } as const;
    const resolve = vi.fn<() => Promise<BinaryHydrationResult>>(async () => ({
      data: enc('abc'),
      mimeType: 'application/pdf',
      name: 'doc.pdf',
    }));

    await applyHydrationResult(part, resolve);

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(part.localData).toBeInstanceOf(Uint8Array);
    expect(decode(part.localData)).toBe('abc');
    expect(part.localData?.byteLength).toBe(3);
    expect(part.size).toBe(3);
    expect(part.mimeType).toBe('application/pdf');
    expect(part.name).toBe('doc.pdf');
    expect(part.ingressFailure).toBeUndefined();
  });

  it('keeps previously-known hints when resolve() omits them (merge semantics)', async () => {
    const part = {
      type: 'audio',
      mimeType: 'audio/ogg',
      name: 'voice.ogg',
      size: 99,
    } as const;
    const resolve = vi.fn<() => Promise<BinaryHydrationResult>>(async () => ({
      data: enc('dddd'),
    }));

    await applyHydrationResult(part, resolve);

    // Hints are merged (kept), but actual bytes are authoritative for size.
    expect(part.mimeType).toBe('audio/ogg');
    expect(part.name).toBe('voice.ogg');
    expect(decode(part.localData)).toBe('dddd');
    expect(part.size).toBe(4);
  });

  it('marks too-large without storing oversized bytes or deriving size', async () => {
    const part = {
      type: 'image',
      url: 'https://cdn.example.com/big.png',
      resourceRef: 'ref-1',
      size: 4,
      mimeType: 'image/jpeg',
    } as const;
    const resolve = vi.fn<() => Promise<BinaryHydrationResult>>(async () => ({
      data: new Uint8Array(100),
      mimeType: 'image/png',
      name: 'big.png',
    }));

    await applyHydrationResult(part, resolve, { maxBytes: 10 });

    // Failure path writes ONLY ingressFailure: locator + prior metadata kept,
    // size NOT derived from the oversized data, bytes never stored.
    expect(part.ingressFailure).toBe('too-large');
    expect(part.url).toBe('https://cdn.example.com/big.png');
    expect(part.resourceRef).toBe('ref-1');
    expect(part.size).toBe(4);
    expect(part.mimeType).toBe('image/jpeg');
    expect(part.name).toBeUndefined();
    expect(part.localData).toBeUndefined();
  });

  it('accepts data exactly at maxBytes (cap is strictly greater)', async () => {
    const part = { type: 'file' } as const;
    await applyHydrationResult(
      part,
      async () => ({ data: new Uint8Array(10) }),
      { maxBytes: 10 },
    );
    expect(part.localData?.byteLength).toBe(10);
    expect(part.size).toBe(10);
    expect(part.ingressFailure).toBeUndefined();
  });

  it('maps a generic resolve() throw to download-failed', async () => {
    const part = { type: 'file' } as const;
    const resolve = vi.fn<() => Promise<BinaryHydrationResult>>(async () => {
      throw new Error('net');
    });
    await applyHydrationResult(part, resolve);
    expect(part.ingressFailure).toBe('download-failed');
    expect(part.localData).toBeUndefined();
  });

  it('maps BodyTooLargeError from resolve() to too-large', async () => {
    const part = { type: 'audio' } as const;
    await applyHydrationResult(part, async () => {
      throw new BodyTooLargeError(5);
    });
    expect(part.ingressFailure).toBe('too-large');
  });

  it('maps RemoteMediaError(UNSAFE_HOST) from resolve() to resource-unavailable', async () => {
    const part = { type: 'video', resourceRef: 'ref-x' } as const;
    await applyHydrationResult(part, async () => {
      throw new RemoteMediaError('UNSAFE_HOST', 'x');
    });
    expect(part.ingressFailure).toBe('resource-unavailable');
    expect(part.resourceRef).toBe('ref-x');
  });

  it('never throws for hydration failures', async () => {
    await expect(
      applyHydrationResult(
        { type: 'image' },
        async () => {
          throw new Error('boom');
        },
        { maxBytes: 1 },
      ),
    ).resolves.toBeUndefined();
  });

  it('fails fast with download-failed on a pre-aborted signal without calling resolve()', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const part = { type: 'image' } as const;
    const resolve = vi.fn<() => Promise<BinaryHydrationResult>>();

    await applyHydrationResult(part, resolve, { signal: ctrl.signal });

    expect(resolve).not.toHaveBeenCalled();
    expect(part.ingressFailure).toBe('download-failed');
    expect(part.localData).toBeUndefined();
  });

  it('discards an in-flight resolve() result when the signal aborts meanwhile', async () => {
    const ctrl = new AbortController();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const part = { type: 'image' } as const;
    const resolve = vi.fn<() => Promise<BinaryHydrationResult>>(async () => {
      await gate;
      return { data: enc('yyy') };
    });

    const pending = applyHydrationResult(part, resolve, { signal: ctrl.signal });
    // Abort while the resolve is still in flight, then deliver the stale result.
    ctrl.abort();
    release();

    await pending;

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(part.ingressFailure).toBe('download-failed');
    expect(part.localData).toBeUndefined();
    expect(part.size).toBeUndefined();
  });
});

describe('isHydratableBinaryPart', () => {
  it('returns true for the four binary kinds', () => {
    const parts: MessagePart[] = [
      { type: 'image', url: 'https://x/a.png' },
      { type: 'file', name: 'f.bin' },
      { type: 'audio', mimeType: 'audio/ogg' },
      { type: 'video', size: 10 },
    ];
    expect(parts.every((p) => isHydratableBinaryPart(p))).toBe(true);
  });

  it('returns false for non-binary kinds', () => {
    const parts: MessagePart[] = [
      { type: 'text', text: 'hi' },
      { type: 'location', latitude: 1, longitude: 2 },
      { type: 'card', kind: 'rich' },
      { type: 'unsupported', reason: 'nope' },
    ];
    expect(parts.every((p) => !isHydratableBinaryPart(p))).toBe(true);
  });
});

describe('mediaCapabilitiesSchema', () => {
  const full = {
    inbound: {
      image: 'bytes',
      file: 'locator',
      audio: 'unsupported',
      video: 'bytes',
    },
    outbound: {
      image: 'bytes',
      file: 'bytes',
      audio: 'unsupported',
      video: 'unsupported',
    },
  } as const;

  it('accepts a full directional record', () => {
    const parsed = mediaCapabilitiesSchema.safeParse(full);
    expect(parsed.success).toBe(true);
  });

  it('accepts a partial record (missing kinds are allowed)', () => {
    const parsed = mediaCapabilitiesSchema.safeParse({
      inbound: { image: 'bytes' },
      outbound: {},
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects an invalid inbound value', () => {
    const parsed = mediaCapabilitiesSchema.safeParse({
      inbound: { image: 'nope' },
      outbound: {},
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects 'locator' as an outbound value", () => {
    const parsed = mediaCapabilitiesSchema.safeParse({
      inbound: {},
      outbound: { image: 'locator' },
    });
    expect(parsed.success).toBe(false);
  });

  it('tolerates extra capability object keys (loose)', () => {
    const parsed = mediaCapabilitiesSchema.safeParse({
      inbound: { image: 'bytes' },
      outbound: { image: 'bytes' },
      futureFlag: true,
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects unknown binary kinds', () => {
    const parsed = mediaCapabilitiesSchema.safeParse({
      inbound: { image: 'bytes', sticker: 'bytes' },
      outbound: { image: 'bytes' },
    });
    expect(parsed.success).toBe(false);
  });
});

describe('capabilities.media (compat extension)', () => {
  const baseFlags = {
    text: true,
    image: false,
    file: false,
    audio: false,
    video: false,
    markdown: false,
    cards: false,
    reactions: false,
    threads: false,
    streaming: 'buffered',
  } as const;

  it('capabilitiesSchema accepts a valid media map', () => {
    const parsed = capabilitiesSchema.safeParse({
      ...baseFlags,
      media: {
        inbound: { image: 'locator' },
        outbound: { image: 'unsupported' },
      },
    });
    expect(parsed.success).toBe(true);
  });

  it('capabilitiesSchema rejects an invalid media map', () => {
    const parsed = capabilitiesSchema.safeParse({
      ...baseFlags,
      media: { inbound: { image: 'nope' }, outbound: {} },
    });
    expect(parsed.success).toBe(false);
  });

  it('media remains optional — omitting it keeps the parsed shape unchanged', () => {
    const parsed = capabilitiesSchema.safeParse(baseFlags);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).not.toHaveProperty('media');
    }
  });
});

describe('public package surface (@wsz987/channel-core)', () => {
  it('re-exports the hydration helper and directional media types', () => {
    expect(typeof core.applyHydrationResult).toBe('function');
    expect(typeof core.isHydratableBinaryPart).toBe('function');
    expect(core.BINARY_KINDS).toEqual(BINARY_KINDS);
    expect(typeof core.mediaCapabilitiesSchema.safeParse).toBe('function');
    // Directional capability types ride on the ChannelCapabilities interface.
    const media: core.ChannelMediaCapabilities = {
      inbound: { image: 'bytes' },
      outbound: { file: 'unsupported' },
    };
    expect(media.inbound.image).toBe('bytes');
  });
});

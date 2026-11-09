/**
 * Compatibility shim coverage.
 *
 * `src/image-hydrator.ts` was renamed to `src/media-hydrator.ts`; the old
 * entry now re-exports the new implementation under the legacy names
 * (`hydrateImageParts` / `ImageHydratorOptions`) for one version. This file
 * proves the alias is real and still hydrates; the full media-hydration
 * suite (image/file/audio/video, failures, caps, capabilities) lives in
 * `test/media-hydration.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest';
import type { SecureRemoteMediaFetcher } from '@wsz987/channel-core';
import { hydrateImageParts, type ImageHydratorOptions } from '../src/image-hydrator.ts';
import { hydrateMediaParts, type MediaHydratorOptions } from '../src/media-hydrator.ts';
import type { MessagePart } from '@wsz987/channel-core';

describe('image-hydrator compat shim', () => {
  it('aliases the renamed media hydrator (same function object)', () => {
    expect(hydrateImageParts).toBe(hydrateMediaParts);
  });

  it('still hydrates an image part through the legacy entry point', async () => {
    const fetchBounded = vi
      .fn<(url: string, opts: unknown) => Promise<{ data: Uint8Array; mimeType?: string; finalUrl: string }>>()
      .mockResolvedValue({ data: new Uint8Array([1, 2, 3]), mimeType: 'image/png', finalUrl: 'https://e/p.png' });
    const parts: MessagePart[] = [{ type: 'image', url: 'https://e/p.png', alt: 'p.png' }];

    await hydrateImageParts(parts, { fetchBounded } as unknown as SecureRemoteMediaFetcher);

    expect(parts[0]).toEqual({
      type: 'image',
      url: 'https://e/p.png',
      alt: 'p.png',
      localData: new Uint8Array([1, 2, 3]),
      mimeType: 'image/png',
    });
  });

  it('exposes ImageHydratorOptions as the MediaHydratorOptions alias', () => {
    // Type-level alias check: both names describe the same options surface.
    const legacy: ImageHydratorOptions = { maxBytes: 1024, signal: new AbortController().signal };
    const current: MediaHydratorOptions = legacy;
    expect(current.maxBytes).toBe(1024);
  });
});
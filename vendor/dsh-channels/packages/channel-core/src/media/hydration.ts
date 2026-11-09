/**
 * Pure, protocol-agnostic binary hydration helper.
 *
 * This module owns the *protocol-neutral* part of hydration only: applying a
 * platform resolver result onto a binary `MessagePart` under a byte cap and an
 * AbortSignal, merging name/mime/size, and mapping failures to the stable
 * `BinaryIngressFailureCode`. It performs NO network I/O and persists nothing.
 *
 * The resolution *how* stays in the adapters: `resourceRef` handles (Telegram
 * file_id, Lark image_key/file_key, DingTalk mediaId, Weixin encrypted CDN
 * ref) are resolved exclusively by the platform upstream resolvers
 * (TelegramFileResolver, LarkMediaPort, DingTalk resolveMedia, QQ secure
 * fetch, Weixin upstream). Core never resolves a locator and never branches on
 * the channel — this file has no `if (channel === ...)` anywhere.
 */
import type {
  AudioPart,
  FilePart,
  ImagePart,
  MessagePart,
  VideoPart,
} from '../messages.js';
import { toIngressFailureCode } from './bounded-response.js';

/** The four transportable binary part kinds (single source of truth). */
export const BINARY_KINDS = ['image', 'file', 'audio', 'video'] as const;

/** One of the binary part kinds. */
export type BinaryKind = (typeof BINARY_KINDS)[number];

/** Binary `MessagePart` variants carrying `BinaryPartBase` bytes. */
export type HydratableBinaryPart = ImagePart | FilePart | AudioPart | VideoPart;

/** Trusted bytes + hints produced by a platform resolver, ready to apply. */
export interface BinaryHydrationResult {
  /** Trusted bytes already downloaded/decrypted by the platform upstream. */
  data: Uint8Array;
  /** Verified/normalized MIME hint (see `mime-hint.ts`). */
  mimeType?: string;
  /** Sanitized filename hint. */
  name?: string;
}

/** Policy knobs for one `applyHydrationResult` call. */
export interface BinaryHydrationPolicy {
  /**
   * Hard byte cap; a result larger than this is dropped with
   * `'too-large'`. Absent/undefined means no cap.
   */
  maxBytes?: number;
  /**
   * External cancellation signal. When aborted before the result is applied,
   * the hydration is marked `'download-failed'` and the result is discarded.
   */
  signal?: AbortSignal;
}

/**
 * Protocol-agnostic application of a platform resolver result onto one binary
 * `MessagePart` (mutates `part` in place, returns nothing).
 *
 * Behavior contract:
 * 1. `part.localData` already present → `resolve()` is NOT called and the part
 *    is returned untouched (no double download) — even when the policy would
 *    fail, an already-hydrated part wins.
 * 2. `policy.signal` aborted before `resolve()` starts → never start the
 *    download; `part.ingressFailure = 'download-failed'`. (Choice: a
 *    pre-aborted signal reads as a cancelled download, matching the bounded
 *    reader's ABORTED → 'download-failed' mapping in
 *    `toIngressFailureCode`.)
 * 3. `resolve()` throws → `part.ingressFailure` is set via
 *    `toIngressFailureCode(error)` (BodyTooLargeError → 'too-large',
 *    UnsafeHostError / remote policy codes → 'resource-unavailable', anything
 *    else → 'download-failed'). This function never throws for hydration
 *    failures.
 * 4. `policy.signal` aborted while `resolve()` was in flight → the delivered
 *    bytes are discarded and `part.ingressFailure = 'download-failed'`
 *    (cancellation wins over a result that arrived after the abort).
 * 5. `result.data.byteLength > policy.maxBytes` → `part.ingressFailure =
 *    'too-large'`. The locator fields (`url` / `resourceRef`) and any
 *    previously-known `size` are retained; the oversized bytes are never
 *    stored and `size` is never derived from them.
 * 6. Success → `part.localData = result.data`, `part.size =
 *    result.data.byteLength` (actual bytes are authoritative over any
 *    previously-known size), `result.mimeType` / `result.name` are merged in
 *    when provided (existing hints are kept otherwise), and
 *    `part.ingressFailure` is cleared — a hydrated part is a healthy part.
 *
 * Failure paths write ONLY `part.ingressFailure`; the `url` / `resourceRef` /
 * `dataUri` fields are never touched, and no other field is mutated on error.
 */
export async function applyHydrationResult(
  part: HydratableBinaryPart,
  resolve: () => Promise<BinaryHydrationResult>,
  policy: BinaryHydrationPolicy = {},
): Promise<void> {
  // Already hydrated — never start a second download, never overwrite the
  // healthy state with a policy failure.
  if (part.localData !== undefined) return;

  const { maxBytes, signal } = policy;

  // Aborted before the resolve even started: fail fast without starting the
  // platform download. Choice: a pre-aborted signal maps to 'download-failed'
  // (the caller abandoned the hydration, so no bytes were ever requested)
  // rather than 'too-large'.
  if (signal?.aborted) {
    part.ingressFailure = 'download-failed';
    return;
  }

  let result: BinaryHydrationResult;
  try {
    result = await resolve();
  } catch (error) {
    // resolve() failed (network, platform, decrypt, integrity, …): map to the
    // stable code and keep whatever locator was already on the part.
    part.ingressFailure = toIngressFailureCode(error);
    return;
  }

  // The signal fired while resolve() was in flight: the operation was
  // cancelled before its result could be applied. The resolve() promise
  // completed (possibly via a side that never observed the abort) but its
  // bytes are discarded — cancellation wins over the delivered result.
  if (signal?.aborted) {
    part.ingressFailure = 'download-failed';
    return;
  }

  // Hard byte cap. On a breach ONLY `ingressFailure` is written: the
  // oversized bytes are never stored and `size` is never derived from them,
  // so the part keeps its locator fields and any previously-known metadata.
  if (maxBytes !== undefined && result.data.byteLength > maxBytes) {
    part.ingressFailure = 'too-large';
    return;
  }

  // Success: trusted bytes + authoritative size, hints merged in, failure
  // cleared.
  part.localData = result.data;
  part.size = result.data.byteLength;
  if (result.mimeType !== undefined) part.mimeType = result.mimeType;
  if (result.name !== undefined) part.name = result.name;
  part.ingressFailure = undefined;
}

/** Type guard: is this part one of the four binary (hydratable) kinds? */
export function isHydratableBinaryPart(part: MessagePart): part is HydratableBinaryPart {
  return (
    part.type === 'image' ||
    part.type === 'file' ||
    part.type === 'audio' ||
    part.type === 'video'
  );
}
/**
 * Channel capability negotiation.
 *
 * Core and the Harness bridge must negotiate against `adapter.capabilities`
 * instead of branching on `channel === '...'`.
 *
 * ## Two-layer semantics (doc §6)
 *
 * The `text/image/file/audio/video` flags describe the *platform side* of the
 * contract only: whether an ADAPTER can receive and send that kind of media on
 * the messaging platform. They are the channel's inbound/outbound transport
 * capability, NOT a statement that the Harness model already understands the
 * media as a real attachment.
 *
 * Today the Harness projection of an inbound media item is a plain-text
 * placeholder (`[image: …]` / `[audio: …]` / `[file: …]` / `[video: …]`,
 * see `message-converter`). So when `image === true`, that means the adapter
 * can carry images, NOT that a Harness agent has received a real image
 * attachment. A real attachment projection is a later milestone (doc WX5) and
 * must not be inferred from these flags.
 *
 * Capability negotiation for a *reply* uses `streaming` (statically, or
 * target-aware via `adapter.resolveStreamingMode`).
 *
 * ## Directional media
 *
 * The legacy `image/file/audio/video` booleans cannot express directionality
 * (e.g. Weixin: audio inbound yes / outbound no) or byte precision (locator
 * vs real bytes). The optional `media` map adds that per-kind precision.
 * Legacy consumers keep reading the coarse booleans; new consumers (attachment
 * gateway, `channel-verify`) should read `capabilities.media`.
 */

import type { BinaryKind } from './media/hydration.js';

export type StreamingMode = 'native' | 'edit' | 'buffered';

/**
 * Per-kind inbound media precision.
 */
export type InboundBinaryCapability = 'bytes' | 'locator' | 'unsupported';

/**
 * Per-kind outbound media precision.
 */
export type OutboundBinaryCapability = 'bytes' | 'unsupported';

/**
 * Directional, per-kind binary media capability breakdown.
 *
 * Missing keys mean "not declared" — treat them as not guaranteed rather than
 * as `'unsupported'`.
 */
export interface ChannelMediaCapabilities {
  /**
   * Inbound precision per binary kind. `'bytes'` means the adapter reliably
   * produces `localData` for that kind before emitting; `'locator'` means it
   * can map the locator (e.g. download on demand) but does not guarantee
   * immediate bytes; `'unsupported'` means no inbound transport at all.
   */
  inbound: Partial<Record<BinaryKind, InboundBinaryCapability>>;
  /**
   * Outbound precision per binary kind: `'bytes'` (can upload real bytes for
   * that kind) or `'unsupported'`.
   */
  outbound: Partial<Record<BinaryKind, OutboundBinaryCapability>>;
}

export interface ChannelCapabilities {
  /**
   * Whether the platform can carry plain text both inbound and outbound.
   */
  text: boolean;
  /**
   * Whether the platform/adapter can transport images. Platform transport
   * capability only — does NOT mean Harness has a real image attachment (see
   * two-layer semantics above).
   */
  image: boolean;
  /**
   * Whether the platform/adapter can transport files. Platform transport
   * capability only — not an Harness attachment projection.
   */
  file: boolean;
  /**
   * Whether the platform/adapter can transport audio. Platform transport
   * capability only — not an Harness attachment projection.
   */
  audio: boolean;
  /**
   * Whether the platform/adapter can transport video. Platform transport
   * capability only — not an Harness attachment projection.
   */
  video: boolean;

  /**
   * Directional, per-kind media capability breakdown (the "7.1 precursor"). The legacy
   * `image/file/audio/video` booleans above are coarse transport flags kept
   * for backwards compatibility; new consumers should read this map when they
   * need per-kind direction or byte precision
   * (`inbound[kind] === 'bytes'` guarantees `localData`, `outbound[kind] ===
   * 'bytes'` guarantees byte upload).
   */
  media?: ChannelMediaCapabilities;

  /** Whether reply markdown is rendered by the platform. */
  markdown: boolean;
  /** Whether interactive cards are supported. */
  cards: boolean;
  /** Whether reaction support exists. */
  reactions: boolean;
  /** Whether thread support exists. */
  threads: boolean;

  /**
   * Whether the adapter can attach interactive buttons (`OutboundMessage.actions`)
   * and receive the matching `interaction.received` presses back. Adapters that
   * only render plain messages leave this undefined.
   */
  interactiveActions?: boolean;

  /**
   * How incremental assistant output is delivered:
   * - `native`   — the platform streams chunks natively (e.g. DingTalk AI Card)
   * - `edit`     — an existing message/card can be updated in place
   * - `buffered` — accumulate chunks and send once (e.g. Weixin)
   */
  streaming: StreamingMode;

  /** Optional hard cap for a single outbound message. */
  maxTextLength?: number;
  /** Optional upload size cap. */
  maxFileSize?: number;
}

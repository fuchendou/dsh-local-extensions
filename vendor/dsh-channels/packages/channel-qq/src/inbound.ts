/**
 * Inbound processing: dedup window + structured mapping + media hydration +
 * emit.
 *
 * Input is the Tencent SDK's `QQBotInboundMessage`. Dedup keys on `messageId`
 * (DSH keeps its own dedup policy; the SDK middleware chain is unused). Only
 * `kind === 'c2c'` and `kind === 'group'` are accepted in V1 — anything else
 * (guild/dm) is logged and dropped.
 *
 * Binary hydration runs AFTER mapping and dedup,
 * BEFORE emit: every `image` (M2A), `file` (M7B), `audio` and `video` part
 * with a genuine `http(s)` `url` is downloaded through the injectable
 * `SecureRemoteMediaFetcher` and its bytes are placed on `localData`
 * (file/audio/video parts also carry the hydrated byte length in `size`).
 * A download failure never blocks text delivery — the part keeps its `url`
 * and records a stable `ingressFailure` code.
 */
import type { ChannelAdapterContext, MessagePart, MessageReceived } from '@wsz987/channel-core';
import { SecureRemoteMediaFetcher } from '@wsz987/channel-core';

/** Compact per-part summary for inbound message logs (debug diagnostics). */
function summarizeParts(parts: readonly MessagePart[]): unknown[] {
  return parts.map((part) => {
    switch (part.type) {
      case 'text':
        return { type: 'text', text: part.text.slice(0, 80) };
      case 'image':
        return {
          type: 'image',
          url: part.url,
          resourceRef: part.resourceRef,
          mimeType: part.mimeType,
          localDataBytes: part.localData?.byteLength,
          ingressFailure: part.ingressFailure,
        };
      case 'file':
        return {
          type: 'file',
          name: part.name,
          size: part.size,
          mimeType: part.mimeType,
          localDataBytes: part.localData?.byteLength,
          ingressFailure: part.ingressFailure,
        };
      case 'audio':
        return {
          type: 'audio',
          durationMs: part.durationMs,
          mimeType: part.mimeType,
          localDataBytes: part.localData?.byteLength,
          ingressFailure: part.ingressFailure,
        };
      case 'video':
        return {
          type: 'video',
          durationMs: part.durationMs,
          mimeType: part.mimeType,
          localDataBytes: part.localData?.byteLength,
          ingressFailure: part.ingressFailure,
        };
      default:
        return { type: part.type };
    }
  });
}
import type { QQBotInboundMessage } from '@tencent-connect/qqbot-nodejs';
import { mapInbound, type QQInboundMeta } from './mapper.js';
import { hydrateMediaParts, type MediaHydratorOptions } from './media-hydrator.js';

export interface InboundProcessorOptions {
  ctx: ChannelAdapterContext;
  meta: QQInboundMeta;
  dedupEnabled: boolean;
  dedupWindowMs: number;
  /** Optional secure remote media fetcher (tests inject a fake; defaults to real). */
  secureFetch?: SecureRemoteMediaFetcher;
  /** Media hydration tuning (image / file / audio / video). */
  mediaHydration?: MediaHydratorOptions;
  /** @deprecated use mediaHydration. */
  imageHydration?: MediaHydratorOptions;
  /** Injectable clock (tests). */
  now?: () => number;
}

export class InboundProcessor {
  private readonly now: () => number;
  private readonly secureFetch: SecureRemoteMediaFetcher;
  private readonly mediaHydration: MediaHydratorOptions;
  /** messageId -> last-seen timestamp, pruned on every handle. */
  private readonly seen = new Map<string, number>();

  constructor(private readonly options: InboundProcessorOptions) {
    this.now = options.now ?? Date.now;
    this.secureFetch = options.secureFetch ?? new SecureRemoteMediaFetcher();
    this.mediaHydration = options.mediaHydration ?? options.imageHydration ?? {};
  }

  /** Process one SDK inbound message; dedup, hydrate media, then emit. */
  async handle(raw: QQBotInboundMessage): Promise<void> {
    if (raw.kind !== 'c2c' && raw.kind !== 'group') {
      this.options.ctx.logger.debug(
        `[channel-qq] dropping unsupported inbound kind '${raw.kind}'`,
      );
      return;
    }

    const key = raw.messageId;
    if (this.options.dedupEnabled) {
      const now = this.now();
      const last = this.seen.get(key);
      if (last !== undefined && now - last < this.options.dedupWindowMs) {
        this.options.ctx.logger.debug(`[channel-qq] dropped duplicate message '${key}'`);
        return;
      }
      this.seen.set(key, now);
      this.prune(now);
    }

    const event: MessageReceived = mapInbound(raw, this.options.meta);
    // Hydrate media bytes before emit so the harness attachment paths receive
    // real bytes. Never throws; failures degrade the part.
    await hydrateMediaParts(event.message.content, this.secureFetch, {
      ...this.mediaHydration,
      signal: this.options.ctx.signal,
    });
    // Inbound message log (debug diagnostics): visible in web:debug with
    // DSH_CHANNELS_DEBUG=1, shows mapped parts incl. hydration result.
    this.options.ctx.logger.info(
      `[channel-qq] inbound message ${event.message.id} from ${event.sender.id} in ${event.conversation.id}`,
      { parts: summarizeParts(event.message.content) },
    );
    await this.options.ctx.emit(event);
  }

  private prune(now: number): void {
    for (const [key, ts] of this.seen) {
      if (now - ts >= this.options.dedupWindowMs) this.seen.delete(key);
    }
  }
}

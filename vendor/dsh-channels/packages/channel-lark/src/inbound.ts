/**
 * Inbound processing: dedup window + structured mapping + emit.
 *
 * Message payloads map to `message.received`; interaction callbacks (card
 * button presses) route to `interaction.received` (Task 12.3). Both paths
 * share the same dedup window so webhook retries cannot double-deliver.
 */
import type { ChannelAdapterContext, MessagePart, MessageReceived, InteractionReceived } from '@wsz987/channel-core';

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
import { dedupKey, mapInbound, mapInteraction, type LarkInboundMeta } from './mapper.js';
import { MediaHydrator } from './media-hydrator.js';
import type { LarkMediaPort } from './upstream/media-port.js';

export interface InboundProcessorOptions {
  ctx: ChannelAdapterContext;
  meta: LarkInboundMeta;
  dedupEnabled: boolean;
  dedupWindowMs: number;
  /** Injectable clock (tests). */
  now?: () => number;
  /**
   * Optional media port used to hydrate inbound binary resourceRefs into bytes
   * before emit (Milestone M2A). When absent, binary parts keep
   * their resourceRef untouched (no ingress).
   */
  mediaPort?: LarkMediaPort;
  /** Test/embedding override; production defaults to two concurrent downloads. */
  mediaHydrationConcurrency?: number;
  /** Test/embedding override; production defaults to the Lark 100 MiB cap. */
  maxMediaBytes?: number;
}

export class InboundProcessor {
  private readonly now: () => number;
  /** dedup key -> last-seen timestamp, pruned on every handle. */
  private readonly seen = new Map<string, number>();
  /** Resolves inbound binary resourceRefs into bytes before emit (M2A/§23-A4). */
  private readonly hydrator: MediaHydrator;

  constructor(private readonly options: InboundProcessorOptions) {
    this.now = options.now ?? Date.now;
    this.hydrator = new MediaHydrator({
      mediaPort: options.mediaPort,
      signal: options.ctx.signal,
      logger: options.ctx.logger,
      maxConcurrency: options.mediaHydrationConcurrency,
      maxBytes: options.maxMediaBytes,
    });
  }

  /** Process one raw payload from the upstream; dedup then emit. */
  async handle(raw: unknown): Promise<void> {
    const key = dedupKey(raw);
    if (this.options.dedupEnabled) {
      const now = this.now();
      const last = this.seen.get(key);
      if (last !== undefined && now - last < this.options.dedupWindowMs) {
        this.options.ctx.logger.debug(`[channel-lark] dropped duplicate payload '${key}'`);
        return;
      }
      this.seen.set(key, now);
      this.prune(now);
    }

    const kind = (raw as { type?: string } | null)?.type;
    if (kind === 'interaction') {
      const event: InteractionReceived = mapInteraction(raw, this.options.meta);
      await this.options.ctx.emit(event);
      return;
    }
    const event: MessageReceived = mapInbound(raw, this.options.meta);
    // Hydrate binary resourceRefs (image/file/audio/video) into bytes before
    // emit; failures mark the part (ingressFailure) and never block text
    // delivery.
    await this.hydrator.hydrateMedia(event);
    // Inbound message log (debug diagnostics): visible in web:debug with
    // DSH_CHANNELS_DEBUG=1, shows mapped parts incl. hydration result.
    this.options.ctx.logger.info(
      `[channel-lark] inbound message ${event.message.id} from ${event.sender.id} in ${event.conversation.id}`,
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

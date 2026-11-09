/**
 * Telegram inbound media hydration.
 *
 * The pure mapper maps Telegram file_id values to the contract's
 * `resourceRef` carrier (an opaque platform handle — never `url`). This module
 * resolves those handles through the platform upstream (`getFile` +
 * `/file/bot<token>/<file_path>`) and places the trusted bytes on
 * `localData`, exactly like the official adapters' hydrators do for their
 * platform URLs.
 *
 * Every transportable binary kind — `image`, `file`, `audio` and `video`
 * (voice notes and audio messages both map to AudioPart, video messages to
 * VideoPart) — is hydrated: Transport is transport, so a `resourceRef` is
 * resolved into real bytes before emit for whichever binary part carries one.
 * The download seam is generic for any supported file_id (photo / document /
 * voice / audio / video).
 *
 * Failure handling follows the shared contract: a download failure never
 * blocks text delivery. The part keeps its `resourceRef` and records a stable
 * de-identified `ingressFailure` code via `toIngressFailureCode` from
 * `@wsz987/channel-core` (shared `BodyTooLargeError` maps to 'too-large').
 */
import {
  BodyTooLargeError,
  isHydratableBinaryPart,
  toIngressFailureCode,
  type ChannelLogger,
  type MessagePart,
} from '@wsz987/channel-core';

/** Platform file resolution seam (implemented by the upstream driver). */
export interface TelegramFileResolver {
  downloadFile(
    fileId: string,
    signal?: AbortSignal,
  ): Promise<{ data: Uint8Array; mimeType?: string; name?: string }>;
}

export interface TelegramMediaHydratorOptions {
  /** Hard byte cap for one download. */
  maxBytes: number;
  /** External cancellation signal (from the adapter context). */
  signal?: AbortSignal;
  /** Optional logger for safe per-media failure diagnostics. */
  logger?: Pick<ChannelLogger, 'warn'>;
}

/**
 * Hydrate Telegram `resourceRef` bytes on `parts` in place. Returns the
 * mutated array. Never throws — every download failure is recorded as
 * `ingressFailure` on the part and the event still carries the text parts.
 */
export async function hydrateTelegramParts(
  parts: MessagePart[],
  resolver: TelegramFileResolver,
  options: TelegramMediaHydratorOptions,
): Promise<MessagePart[]> {
  const { maxBytes, signal, logger } = options;

  await Promise.allSettled(
    parts.map(async (part): Promise<void> => {
      // All four transportable binary kinds hydrate; anything else is ignored.
      if (!isHydratableBinaryPart(part)) return;
      const fileId = part.resourceRef;
      if (typeof fileId !== 'string' || fileId.length === 0) return;
      // Trusted bytes already in hand take precedence — never re-download.
      if (part.localData !== undefined || part.dataUri !== undefined) return;

      try {
        const result = await resolver.downloadFile(fileId, signal);
        if (result.data.byteLength > maxBytes) {
          throw new BodyTooLargeError(
            maxBytes,
            `Telegram file ${result.data.byteLength} bytes exceeds the ${maxBytes} byte cap`,
          );
        }
        part.localData = result.data;
        // Actual downloaded bytes are authoritative over any previously-known
        // size.
        part.size = result.data.byteLength;
        // Telegram's original message metadata is more authoritative than
        // metadata reconstructed from the download response/path. Only fill
        // missing hints so a generated file_path cannot replace a user name
        // (photos carry no user-facing name, so image is left untouched).
        if (part.mimeType === undefined && result.mimeType) part.mimeType = result.mimeType;
        if (part.type !== 'image' && part.name === undefined && result.name) part.name = result.name;
        // A successful hydration clears any previous failure marker.
        delete part.ingressFailure;
      } catch (error) {
        // Keep the resourceRef, record the stable de-identified failure code.
        part.ingressFailure = toIngressFailureCode(error);
        logger?.warn('[channel-telegram] media hydration failed', {
          type: part.type,
          failure: part.ingressFailure,
          error: safeErrorDetails(error),
        });
      }
    }),
  );

  return parts;
}

/** Keep diagnostics useful without allowing bearer paths or raw payloads into logs. */
function safeErrorDetails(error: unknown): Record<string, string> {
  if (!(error instanceof Error)) return { message: 'unknown error' };
  const value = error as Error & { code?: unknown };
  return {
    name: value.name,
    ...(typeof value.code === 'string' ? { code: value.code } : {}),
    message: value.message.replace(/\/file\/bot[^/?#]+/g, '/file/bot<redacted>')
      .replace(/\/bot[^/?#]+/g, '/bot<redacted>'),
  };
}

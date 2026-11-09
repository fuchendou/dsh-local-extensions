/**
 * Attachment Catalog v2.
 *
 * The catalog is a NEW logical-id -> backend-locator map kept SEPARATE from
 * the legacy `attachments/v1` tree, which is never rewritten in place. One
 * record is written per attachment at:
 *
 * \`\`\`
 * attachments/
 *   v1/                       # legacy tree — fully untouched
 *   catalog/
 *     v2/
 *       by-id/
 *         <attachmentId>.json # AttachmentCatalogRecordV2
 * \`\`\`
 *
 * The record deliberately carries NO transient platform state — no
 * `resourceRef`, no provider URL, no token, no `downloadCode` (same rule as
 * `StoredChannelAsset`). It exists so the resolve flow can later pick a
 * backend (Native-first + legacy fallback) without parsing v1 metadata, and
 * so lazy migration can record the channel-v1 -> harness-native transition
 * explicitly.
 *
 * `attachmentId` is the stable logical id (`att-<uuid>`) and is NEVER a path
 * or a Harness native id.
 */

/** Schema version of `AttachmentCatalogRecordV2` (mirrors the v2 directory). */
export const CATALOG_SCHEMA_VERSION = 2 as const;

/** Binary kinds a generic (non-image) attachment record may describe. */
export type CatalogFileKind = 'file' | 'audio' | 'video';

/** Storage backends a catalog record may point at. */
export type CatalogStorageBackend = 'channel-v1' | 'harness-native';

/**
 * One catalog v2 record. `storage` discriminates where the real bytes live;
 * `migration` (when present) records that a copy + verify transition happened
 * and that the legacy backend was retained.
 */
export interface AttachmentCatalogRecordV2 {
  schemaVersion: typeof CATALOG_SCHEMA_VERSION;
  /** Stable logical attachment id (`att-<uuid>`); never a path or native id. */
  attachmentId: string;
  /** Session ACL owner — the ONLY identity that gates read access. */
  owner: {
    sessionId: string;
  };
  /** De-identified platform provenance (debug / migration only). */
  provenance: {
    channelId: string;
    accountId: string;
    conversationId: string;
    conversationType?: 'dm' | 'group';
    threadId?: string;
    messageId: string;
  };
  file: {
    kind: CatalogFileKind;
    name: string;
    mimeType?: string;
    /** Final byte length (computed by the store that wrote the bytes). */
    bytes: number;
    sha256: string;
  };
  storage:
    | { backend: 'channel-v1' }
    | { backend: 'harness-native'; nativeId: string };
  /**
   * Lazy-migration state. Present once a legacy record has
   * been copied to the native backend, read back and hash-verified.
   * `legacyRetained` must stay `true` — migration is copy + verify,
   * never move/delete.
   */
  migration?: {
    sourceBackend?: 'channel-v1';
    migratedAt?: number;
    verifiedAt?: number;
    legacyRetained?: boolean;
  };
  createdAt: number;
}
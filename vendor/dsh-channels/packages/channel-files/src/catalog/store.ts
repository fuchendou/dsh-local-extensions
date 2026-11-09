/**
 * Attachment Catalog v2 store.
 *
 * Filesystem layout:
 *
 * \`\`\`
 * attachments/
 *   v1/                         # legacy tree — NEVER touched by this module
 *   catalog/
 *     v2/
 *       by-id/
 *         <attachmentId>.json   # one atomic JSON file per record
 * \`\`\`
 *
 * Every write uses Harness's public `writeFileAtomic`; read-modify-write
 * updates also use its cross-process writer lock. A reader never observes a
 * half-written record. `get` treats missing AND corrupt records the same way — it returns
 * `undefined` and never throws; corrupt JSON is logged and skipped. This is
 * deliberate: the catalog is an OPTIONAL index — "catalog miss MUST be a
 * non-fatal fallback", nothing may break if the catalog directory is absent.
 * The legacy `attachments/v1` tree remains the authoritative fallback for
 * reads.
 *
 * Records are validated with zod `safeParse` on BOTH write and read
 * (AGENTS.md 5.4 — trusted-boundary payloads must be parsed, never cast).
 * Unknown extra fields are tolerated on read (zod `z.object` strips them);
 * they never make a record corrupt.
 */
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write';
import { z } from 'zod';
import { resolveAttachmentsRoot } from '../paths.js';
import {
  CATALOG_SCHEMA_VERSION,
  type AttachmentCatalogRecordV2,
} from './types.js';

/** Errors raised for programmer misuse (an invalid record on write). */
export class CatalogStoreError extends Error {
  readonly code: 'CATALOG_INVALID_RECORD';
  constructor(message: string) {
    super(message);
    this.name = 'CatalogStoreError';
    this.code = 'CATALOG_INVALID_RECORD';
  }
}

/** Stable logical IDs are generated as `att-${randomUUID()}` by the pipeline. */
export const attachmentIdSchema = z.string().regex(
  /^att-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  'attachmentId must use the att-UUID format',
);

/** Zod schema for `AttachmentCatalogRecordV2` (read-time validation). */
export const attachmentCatalogRecordV2Schema = z.object({
  schemaVersion: z.literal(CATALOG_SCHEMA_VERSION),
  attachmentId: attachmentIdSchema,
  owner: z.object({
    sessionId: z.string().min(1),
  }),
  provenance: z.object({
    channelId: z.string().min(1),
    accountId: z.string().min(1),
    conversationId: z.string().min(1),
    conversationType: z.enum(['dm', 'group']).optional(),
    threadId: z.string().optional(),
    messageId: z.string().min(1),
  }),
  file: z.object({
    kind: z.enum(['file', 'audio', 'video']),
    name: z.string(),
    mimeType: z.string().optional(),
    bytes: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  }),
  storage: z.discriminatedUnion('backend', [
    z.object({ backend: z.literal('channel-v1') }),
    z.object({ backend: z.literal('harness-native'), nativeId: z.string().min(1) }),
  ]),
  migration: z
    .object({
      sourceBackend: z.literal('channel-v1').optional(),
      migratedAt: z.number().optional(),
      verifiedAt: z.number().optional(),
      legacyRetained: z.boolean().optional(),
    })
    .optional(),
  createdAt: z.number(),
});

/** Type guard over the zod schema (never trusts an unparsed object). */
export function isAttachmentCatalogRecordV2(
  value: unknown,
): value is AttachmentCatalogRecordV2 {
  return attachmentCatalogRecordV2Schema.safeParse(value).success;
}

/**
 * Catalog v2 root — a sibling of the v1 tree under the shared attachments
 * root (`<channelData>/attachments/catalog/v2`). Never collides with
 * `attachments/v1/sessions/...`.
 */
export function resolveCatalogRoot(): string {
  return join(resolveAttachmentsRoot(), '..', 'catalog', 'v2');
}

export interface CatalogStoreOptions {
  /**
   * Catalog v2 root; records live at `<root>/by-id/<attachmentId>.json`.
   * Defaults to `resolveCatalogRoot()`.
   */
  root?: string;
  /** Corrupt-record diagnostics; defaults to `console.warn`. */
  log?: (message: string) => void;
}

/**
 * Patch accepted by `CatalogStore.update` — deliberately limited to the
 * fields lazy migration transitions: the storage locator and the migration
 * state block.
 */
export interface CatalogRecordPatch {
  storage?: AttachmentCatalogRecordV2['storage'];
  migration?: AttachmentCatalogRecordV2['migration'];
}

/**
 * Filesystem-backed catalog v2 store. All methods are non-fatal on missing
 * data: `get`/`update` return `undefined`, `list` returns `[]`, and no catalog
 * method breaks the legacy fallback when the catalog is absent or corrupt.
 */
export class CatalogStore {
  private readonly root: string;
  private readonly byIdDir: string;
  private readonly log: (message: string) => void;

  constructor(options: CatalogStoreOptions = {}) {
    this.root = options.root ?? resolveCatalogRoot();
    this.byIdDir = join(this.root, 'by-id');
    this.log = options.log ?? ((message) => console.warn('[channel-files:catalog] ' + message));
  }

  /**
   * Atomically publish one record. The record is validated with zod
   * `safeParse` before anything is written; an invalid record raises
   * `CatalogStoreError` and leaves no file behind.
   */
  async put(record: AttachmentCatalogRecordV2): Promise<void> {
    const parsed = this.parseRecord(record);
    await mkdir(this.byIdDir, { recursive: true, mode: 0o700 });
    const file = this.recordFile(parsed.attachmentId);
    await withFileLock(file, () => this.writeRecord(file, parsed));
  }

  /**
   * Read one record. Returns `undefined` for a missing attachment id AND for
   * a corrupt record (invalid JSON or schema mismatch — logged, never thrown).
   */
  async get(attachmentId: string): Promise<AttachmentCatalogRecordV2 | undefined> {
    if (!attachmentIdSchema.safeParse(attachmentId).success) return undefined;
    return this.readRecord(attachmentId);
  }

  private async readRecord(
    attachmentId: string,
  ): Promise<AttachmentCatalogRecordV2 | undefined> {
    let text: string;
    try {
      text = await readFile(this.recordFile(attachmentId), 'utf8');
    } catch {
      // Missing record (or missing catalog dir) is a normal, non-fatal miss.
      return undefined;
    }
    return this.parseFileRecord(text, attachmentId);
  }

  /**
   * List all readable records, sorted by `attachmentId`. Corrupt and
   * transient (`.tmp`) files are skipped; a missing catalog dir returns `[]`.
   */
  async list(): Promise<AttachmentCatalogRecordV2[]> {
    let entries: string[];
    try {
      entries = await readdir(this.byIdDir);
    } catch {
      return [];
    }
    const records: AttachmentCatalogRecordV2[] = [];
    for (const name of entries) {
      if (!name.endsWith('.json')) continue; // ignore transient .tmp files
      const attachmentId = name.slice(0, -'.json'.length);
      const record = await this.get(attachmentId);
      if (record !== undefined) records.push(record);
    }
    return records.sort((a, b) => a.attachmentId.localeCompare(b.attachmentId));
  }

  /**
   * Apply a migration-state patch atomically: read current, merge `storage` /
   * `migration` onto it, write back under a writer lock.
   * Returns the merged record; `undefined` when the attachment id is missing
   * (non-fatal — nothing is written). A merged record that fails zod
   * validation raises `CatalogStoreError` (programmer misuse).
   */
  async update(
    attachmentId: string,
    patch: CatalogRecordPatch,
  ): Promise<AttachmentCatalogRecordV2 | undefined> {
    if (!attachmentIdSchema.safeParse(attachmentId).success) return undefined;
    await mkdir(this.byIdDir, { recursive: true, mode: 0o700 });
    const file = this.recordFile(attachmentId);
    return withFileLock(file, async () => {
      const current = await this.readRecord(attachmentId);
      if (current === undefined) return undefined;
      const merged = this.parseRecord({
        ...current,
        ...(patch.storage !== undefined ? { storage: patch.storage } : {}),
        ...(patch.migration !== undefined ? { migration: patch.migration } : {}),
      });
      await this.writeRecord(file, merged);
      return merged;
    });
  }

  private recordFile(attachmentId: string): string {
    return join(this.byIdDir, attachmentId + '.json');
  }

  private writeRecord(
    file: string,
    record: AttachmentCatalogRecordV2,
  ): Promise<void> {
    return writeFileAtomic(file, JSON.stringify(record, null, 2), {
      mode: 0o600,
      dirMode: 0o700,
    });
  }

  /** Validate a record before persisting; never writes an unparsed object. */
  private parseRecord(record: AttachmentCatalogRecordV2): AttachmentCatalogRecordV2 {
    const result = attachmentCatalogRecordV2Schema.safeParse(record);
    if (!result.success) {
      throw new CatalogStoreError(
        'invalid catalog record for \'' + (record?.attachmentId ?? '?') + '\': '
          + result.error.message,
      );
    }
    return result.data;
  }

  /** Parse + validate a record read back from disk (corrupt -> undefined). */
  private parseFileRecord(
    text: string,
    attachmentId: string,
  ): AttachmentCatalogRecordV2 | undefined {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      this.log('corrupt catalog record (invalid JSON) for ' + attachmentId);
      return undefined;
    }
    const result = attachmentCatalogRecordV2Schema.safeParse(value);
    if (!result.success) {
      this.log('corrupt catalog record (schema mismatch) for ' + attachmentId);
      return undefined;
    }
    if (result.data.attachmentId !== attachmentId) {
      this.log('corrupt catalog record (attachmentId mismatch) for ' + attachmentId);
      return undefined;
    }
    return result.data;
  }
}

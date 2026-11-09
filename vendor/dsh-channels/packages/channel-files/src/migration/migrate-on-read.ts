/**
 * Lazy migration ON READ.
 *
 * NOT YET WIRED into the resolve flow. This module is standalone, default-off
 * infrastructure: the first release ships with `migration.nativeOnRead =
 * false` and the resolver turn-on is a later wave. Only when `enabled` is true
 * AND the running Harness host reports a generic attachment capability does a
 * read of a legacy record trigger a copy.
 *
 * Contract:
 *
 * - never MOVE or DELETE legacy bytes — migration is copy + verify + retain
 *   (`legacyRetained: true`); deleting legacy bytes is GC's job, separate from
 *   the migration transaction;
 * - copy to native -> read back -> verify sha256 + bytes -> catalog switch;
 * - ANY failure (copy fail, read-back fail, hash mismatch, length mismatch,
 *   catalog get/update fail or throw, missing catalog record) ->
 *   `{ outcome: 'legacy-authoritative' }`: legacy remains authoritative and
 *   readable, the catalog is unchanged;
 * - a record already at `harness-native` is an idempotent no-op
 *   (`{ outcome: 'migrated' }`, nothing copied).
 */
import type { NativeGenericAttachmentCapability } from '../backends/harness-native.js';
import type { CatalogStore } from '../catalog/store.js';
import type { AttachmentCatalogRecordV2 } from '../catalog/types.js';
import { readBackVerified } from './verify.js';

export interface MigrationOptions {
  /**
   * Master switch; defaults to `false` in release ('migration.nativeOnRead'
   * policy). Migration never runs unless explicitly enabled.
   */
  enabled: boolean;
  /** Capability probe result of the running Harness host. */
  native: NativeGenericAttachmentCapability;
  /**
   * Copy the record's bytes into the native backend; resolves to the native
   * id. Must never move or delete the legacy bytes.
   */
  copyToNative: (record: AttachmentCatalogRecordV2) => Promise<string>;
  /** Read the copied bytes back from the native backend for verification. */
  readBackNative: (nativeId: string) => Promise<Uint8Array>;
  /** Catalog v2 used for the locator transition (get + update only). */
  catalog: Pick<CatalogStore, 'get' | 'update'>;
}

export type MigrateOnReadOutcome =
  | 'skipped-legacy'
  | 'migrated'
  | 'legacy-authoritative';

export interface MigrateOnReadResult {
  outcome: MigrateOnReadOutcome;
}

/**
 * Attempt a lazy copy+verify migration of one legacy catalog record.
 *
 * @returns
 * - `skipped-legacy` — migration disabled or native capability unavailable;
 *   the caller keeps serving from the legacy backend untouched.
 * - `migrated` — native copy verified (sha256 + bytes) and the catalog now
 *   points at `harness-native` with the migration block recorded; legacy
 *   bytes retained.
 * - `legacy-authoritative` — any failure; legacy backend stays authoritative
 *   and the catalog is unchanged.
 */
export async function migrateOnRead(
  options: MigrationOptions,
  record: AttachmentCatalogRecordV2,
): Promise<MigrateOnReadResult> {
  if (!options.enabled || !options.native.available) {
    return { outcome: 'skipped-legacy' };
  }
  try {
    // The catalog is the authoritative state: re-read it so the transition
    // cannot clobber a concurrent one, and so a missing catalog record fails
    // safe to legacy-authoritative (catalog miss is never fatal).
    const current = await options.catalog.get(record.attachmentId);
    if (current === undefined) return { outcome: 'legacy-authoritative' };
    if (current.storage.backend === 'harness-native') {
      // Already migrated — idempotent no-op, nothing copied.
      return { outcome: 'migrated' };
    }

    // 1) COPY (never move/delete the legacy bytes).
    const nativeId = await options.copyToNative(current);

    // 2) READ BACK + VERIFY sha256 and byte length.
    const verified = await readBackVerified({
      readBack: () => options.readBackNative(nativeId),
      expectedSha256: current.file.sha256,
      expectedBytes: current.file.bytes,
    });
    if (!verified) return { outcome: 'legacy-authoritative' };

    // 3) CATALOG SWITCH to harness-native + record the migration state
    //    (sourceBackend channel-v1, legacyRetained: true).
    const now = Date.now();
    const updated = await options.catalog.update(current.attachmentId, {
      storage: { backend: 'harness-native', nativeId },
      migration: {
        sourceBackend: 'channel-v1',
        migratedAt: now,
        verifiedAt: now,
        legacyRetained: true,
      },
    });
    if (updated === undefined) return { outcome: 'legacy-authoritative' };
    return { outcome: 'migrated' };
  } catch {
    // Copy fail, read-back fail, catalog get/update fail: legacy stays
    // authoritative, catalog unchanged, legacy bytes untouched.
    return { outcome: 'legacy-authoritative' };
  }
}
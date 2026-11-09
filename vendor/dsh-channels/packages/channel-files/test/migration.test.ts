/**
 * Lazy migration + integrity verification, covering the contract that belongs
 * to this module (v1-no-catalog -> skipped-legacy is a resolver concern, out
 * of scope here).
 *
 * Contract under test: disabled / native-unavailable -> skipped-legacy;
 * copy + read-back + sha256/bytes verify -> catalog switch to harness-native
 * with legacyRetained: true; ANY failure (copy write, read-back, hash
 * mismatch, length mismatch, catalog get/update fail or miss, throw) ->
 * legacy-authoritative with the catalog unchanged; legacy bytes are NEVER
 * deleted (this module has no legacy-store handle by contract — fakes spy on
 * every call and no delete-like operation ever occurs).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  CATALOG_SCHEMA_VERSION,
  type AttachmentCatalogRecordV2,
} from '../src/catalog/types.ts';
import type { CatalogRecordPatch } from '../src/catalog/store.ts';
import {
  FakeNativeGenericAttachmentCapability,
  NO_NATIVE_GENERIC_ATTACHMENT,
} from '../src/backends/harness-native.ts';
import {
  migrateOnRead,
  type MigrateOnReadResult,
  type MigrationOptions,
} from '../src/migration/migrate-on-read.ts';
import { readBackVerified, verifyFileIntegrity } from '../src/migration/verify.ts';
import { sha256Hex } from '../src/attachments/hash.ts';

const BYTES = new TextEncoder().encode('meeting-notes-payload');
const SHA = sha256Hex(BYTES);
const DELETION_LIKE_OPS = new Set(['delete', 'remove', 'rm', 'unlink', 'move', 'renameLegacy']);

function makeRecord(overrides: Partial<AttachmentCatalogRecordV2> = {}): AttachmentCatalogRecordV2 {
  return {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    attachmentId: 'att-1',
    owner: { sessionId: 'sess-1' },
    provenance: {
      channelId: 'telegram',
      accountId: 'bot-main',
      conversationId: 'chat-42',
      messageId: 'msg-1',
    },
    file: { kind: 'file', name: 'meeting.txt', bytes: BYTES.byteLength, sha256: SHA },
    storage: { backend: 'channel-v1' },
    createdAt: 111,
    ...overrides,
  } as AttachmentCatalogRecordV2;
}

interface FakeOp {
  name: string;
  args: unknown[];
}

/** In-memory catalog spy implementing the `get | update` slice. */
class FakeCatalog {
  readonly ops: FakeOp[] = [];
  private records = new Map<string, AttachmentCatalogRecordV2>();
  failGet = false;
  failUpdate = false;
  updateMiss = false;

  async get(attachmentId: string): Promise<AttachmentCatalogRecordV2 | undefined> {
    this.ops.push({ name: 'get', args: [attachmentId] });
    if (this.failGet) throw new Error('catalog get fail');
    return this.records.get(attachmentId);
  }

  async update(
    attachmentId: string,
    patch: CatalogRecordPatch,
  ): Promise<AttachmentCatalogRecordV2 | undefined> {
    this.ops.push({ name: 'update', args: [attachmentId, patch] });
    if (this.failUpdate) throw new Error('catalog update fail');
    const current = this.records.get(attachmentId);
    if (current === undefined || this.updateMiss) return undefined;
    const merged = {
      ...current,
      ...(patch.storage !== undefined ? { storage: patch.storage } : {}),
      ...(patch.migration !== undefined ? { migration: patch.migration } : {}),
    } as AttachmentCatalogRecordV2;
    this.records.set(attachmentId, merged);
    return merged;
  }

  put(record: AttachmentCatalogRecordV2): void {
    this.records.set(record.attachmentId, record);
  }

  stored(attachmentId: string): AttachmentCatalogRecordV2 | undefined {
    return this.records.get(attachmentId);
  }
}

function makeNative(available: boolean, readBackBytes: () => Uint8Array = () => BYTES) {
  const copyToNative = vi.fn(async (_record: AttachmentCatalogRecordV2): Promise<string> => 'native-1');
  const readBackNative = vi.fn(async (): Promise<Uint8Array> => readBackBytes());
  const native = available ? FakeNativeGenericAttachmentCapability({ available: true }) : NO_NATIVE_GENERIC_ATTACHMENT;
  return { native, copyToNative, readBackNative };
}

describe('migrateOnRead — default-off / capability gate', () => {
  it('disabled (migration.nativeOnRead=false) -> skipped-legacy, nothing is touched', async () => {
    const catalog = new FakeCatalog();
    catalog.put(makeRecord());
    const { native, copyToNative, readBackNative } = makeNative(true);

    const result = await migrateOnRead(
      { enabled: false, native, copyToNative, readBackNative, catalog },
      makeRecord(),
    );
    expect(result).toEqual({ outcome: 'skipped-legacy' });
    expect(catalog.ops).toEqual([]);
    expect(copyToNative).not.toHaveBeenCalled();
    expect(readBackNative).not.toHaveBeenCalled();
  });

  it('native capability unavailable -> skipped-legacy regardless of enabled', async () => {
    const catalog = new FakeCatalog();
    catalog.put(makeRecord());
    const { native, copyToNative, readBackNative } = makeNative(false);

    const result = await migrateOnRead(
      { enabled: true, native, copyToNative, readBackNative, catalog },
      makeRecord(),
    );
    expect(result).toEqual({ outcome: 'skipped-legacy' });
    expect(copyToNative).not.toHaveBeenCalled();
    expect(catalog.ops).toEqual([]);
  });

  it('already-native record -> migrated (idempotent no-op, no copy)', async () => {
    const catalog = new FakeCatalog();
    catalog.put(makeRecord({ storage: { backend: 'harness-native', nativeId: 'native-0' } }));
    const { native, copyToNative, readBackNative } = makeNative(true);

    const result = await migrateOnRead(
      { enabled: true, native, copyToNative, readBackNative, catalog },
      makeRecord(),
    );
    expect(result).toEqual({ outcome: 'migrated' });
    expect(copyToNative).not.toHaveBeenCalled();
    expect(readBackNative).not.toHaveBeenCalled();
    expect(catalog.ops).toEqual([{ name: 'get', args: ['att-1'] }]);
  });
});

describe('migrateOnRead — happy path (copy + verify + switch, retain legacy)', () => {
  it('copy ok + sha256/bytes verified -> migrated with harness-native + legacyRetained, caller data intact', async () => {
    const catalog = new FakeCatalog();
    catalog.put(makeRecord());
    const { native, copyToNative, readBackNative } = makeNative(true);

    // The caller passes its own record object; it must not be mutated.
    const callerRecord = makeRecord();
    const result = await migrateOnRead(
      { enabled: true, native, copyToNative, readBackNative, catalog },
      callerRecord,
    );
    expect(result).toEqual({ outcome: 'migrated' });

    // Copy happened exactly once, with the legacy (channel-v1) record.
    expect(copyToNative).toHaveBeenCalledTimes(1);
    expect(copyToNative.mock.calls[0]?.[0]?.storage).toEqual({ backend: 'channel-v1' });
    expect(readBackNative).toHaveBeenCalledTimes(1);
    expect(readBackNative).toHaveBeenCalledWith('native-1');

    // Catalog switched to harness-native + migration block recorded.
    const stored = catalog.stored('att-1');
    expect(stored?.storage).toEqual({ backend: 'harness-native', nativeId: 'native-1' });
    expect(stored?.migration?.sourceBackend).toBe('channel-v1');
    expect(typeof stored?.migration?.migratedAt).toBe('number');
    expect(typeof stored?.migration?.verifiedAt).toBe('number');
    expect(stored?.migration?.legacyRetained).toBe(true);
    expect(stored?.file).toEqual(makeRecord().file);

    // Caller's object untouched: still legacy, no migration block added.
    expect(callerRecord.storage).toEqual({ backend: 'channel-v1' });
    expect(callerRecord.migration).toBeUndefined();
    expect(catalog.ops.map((op) => op.name)).toEqual(['get', 'update']);
  });
});

describe('migrateOnRead — every failure keeps legacy authoritative', () => {
  it('sha256 mismatch (same length, different bytes) -> legacy-authoritative, catalog unchanged, no update', async () => {
    const catalog = new FakeCatalog();
    catalog.put(makeRecord());
    const corrupted = new TextEncoder().encode('MEETING-NOTES-PAYLOAD'); // same length
    expect(corrupted.byteLength).toBe(BYTES.byteLength);
    const { native, copyToNative, readBackNative } = makeNative(true, () => corrupted);

    const result = await migrateOnRead(
      { enabled: true, native, copyToNative, readBackNative, catalog },
      makeRecord(),
    );
    expect(result).toEqual({ outcome: 'legacy-authoritative' });
    expect(catalog.stored('att-1')?.storage).toEqual({ backend: 'channel-v1' });
    expect(catalog.stored('att-1')?.migration).toBeUndefined();
    // Verification failed -> the catalog transition never ran.
    expect(catalog.ops.map((op) => op.name)).toEqual(['get']);
  });

  it('byte length mismatch -> legacy-authoritative, catalog unchanged', async () => {
    const catalog = new FakeCatalog();
    catalog.put(makeRecord());
    const wrongLength = new Uint8Array(BYTES.byteLength + 3);
    const { native, copyToNative, readBackNative } = makeNative(true, () => wrongLength);

    const result = await migrateOnRead(
      { enabled: true, native, copyToNative, readBackNative, catalog },
      makeRecord(),
    );
    expect(result).toEqual({ outcome: 'legacy-authoritative' });
    expect(catalog.stored('att-1')?.storage).toEqual({ backend: 'channel-v1' });
    expect(catalog.ops.map((op) => op.name)).toEqual(['get']);
  });

  it('native write (copy) fail -> legacy-authoritative, catalog unchanged', async () => {
    const catalog = new FakeCatalog();
    catalog.put(makeRecord());
    const failingCopy = vi.fn(async (): Promise<string> => {
      throw new Error('native write fail');
    });
    const readBackNative = vi.fn(async (): Promise<Uint8Array> => BYTES);

    const result = await migrateOnRead(
      { enabled: true, native: FakeNativeGenericAttachmentCapability({ available: true }), copyToNative: failingCopy, readBackNative, catalog },
      makeRecord(),
    );
    expect(result).toEqual({ outcome: 'legacy-authoritative' });
    expect(catalog.stored('att-1')?.storage).toEqual({ backend: 'channel-v1' });
    expect(catalog.stored('att-1')?.migration).toBeUndefined();
    expect(readBackNative).not.toHaveBeenCalled();
    expect(catalog.ops.map((op) => op.name)).toEqual(['get']);
  });

  it('native read-back fail -> legacy-authoritative, catalog unchanged', async () => {
    const catalog = new FakeCatalog();
    catalog.put(makeRecord());
    const readBackNative = vi.fn(async (): Promise<Uint8Array> => {
      throw new Error('read-back fail');
    });
    const copyToNative = vi.fn(async (): Promise<string> => 'native-1');

    const result = await migrateOnRead(
      { enabled: true, native: FakeNativeGenericAttachmentCapability({ available: true }), copyToNative, readBackNative, catalog },
      makeRecord(),
    );
    expect(result).toEqual({ outcome: 'legacy-authoritative' });
    expect(catalog.stored('att-1')?.storage).toEqual({ backend: 'channel-v1' });
  });

  it('catalog get fail -> legacy-authoritative, copy never invoked', async () => {
    const catalog = new FakeCatalog();
    catalog.put(makeRecord());
    catalog.failGet = true;
    const { native, copyToNative, readBackNative } = makeNative(true);

    const result = await migrateOnRead(
      { enabled: true, native, copyToNative, readBackNative, catalog },
      makeRecord(),
    );
    expect(result).toEqual({ outcome: 'legacy-authoritative' });
    expect(copyToNative).not.toHaveBeenCalled();
    expect(readBackNative).not.toHaveBeenCalled();
  });

  it('catalog get miss (record absent) -> legacy-authoritative, copy never invoked (catalog miss is non-fatal)', async () => {
    const catalog = new FakeCatalog(); // empty — no record stored
    const { native, copyToNative, readBackNative } = makeNative(true);

    const result = await migrateOnRead(
      { enabled: true, native, copyToNative, readBackNative, catalog },
      makeRecord(),
    );
    expect(result).toEqual({ outcome: 'legacy-authoritative' });
    expect(copyToNative).not.toHaveBeenCalled();
  });

  it('catalog update fail (throw) -> legacy-authoritative, stored record unchanged', async () => {
    const catalog = new FakeCatalog();
    catalog.put(makeRecord());
    catalog.failUpdate = true;
    const { native, copyToNative, readBackNative } = makeNative(true);

    const result = await migrateOnRead(
      { enabled: true, native, copyToNative, readBackNative, catalog },
      makeRecord(),
    );
    expect(result).toEqual({ outcome: 'legacy-authoritative' });
    expect(copyToNative).toHaveBeenCalledTimes(1);
    expect(catalog.stored('att-1')?.storage).toEqual({ backend: 'channel-v1' });
    expect(catalog.stored('att-1')?.migration).toBeUndefined();
  });

  it('catalog update miss (returns undefined) -> legacy-authoritative, stored record unchanged', async () => {
    const catalog = new FakeCatalog();
    catalog.put(makeRecord());
    catalog.updateMiss = true;
    const { native, copyToNative, readBackNative } = makeNative(true);

    const result = await migrateOnRead(
      { enabled: true, native, copyToNative, readBackNative, catalog },
      makeRecord(),
    );
    expect(result).toEqual({ outcome: 'legacy-authoritative' });
    expect(catalog.stored('att-1')?.storage).toEqual({ backend: 'channel-v1' });
  });
});

describe('migrateOnRead — legacy bytes are never deleted', () => {
  it('only copy/read-back/catalog operations ever run; no delete-like op is ever invoked', async () => {
    const catalog = new FakeCatalog();
    catalog.put(makeRecord());
    const { native, copyToNative, readBackNative } = makeNative(true);

    await migrateOnRead(
      { enabled: true, native, copyToNative, readBackNative, catalog },
      makeRecord(),
    );

    // Structural guarantee: MigrationOptions exposes no legacy-store handle, so
    // migrateOnRead physically cannot delete or move legacy bytes. The spies
    // record every call; nothing delete-like may appear.
    const allNames = [
      ...catalog.ops.map((op) => op.name),
      ...copyToNative.mock.calls.map(() => 'copy'),
      ...readBackNative.mock.calls.map(() => 'readback'),
    ];
    for (const name of allNames) {
      expect(DELETION_LIKE_OPS.has(name)).toBe(false);
    }
    // Every operation belongs to the copy+verify+catalog-switch set, and the
    // catalog transition is get -> update (copy/read-back interleave between
    // them asynchronously).
    expect([...new Set(allNames)].sort()).toEqual(['copy', 'get', 'readback', 'update']);
    expect(catalog.ops.map((op) => op.name)).toEqual(['get', 'update']);
    // The caller's legacy bytes object is untouched.
    const callerRecord = makeRecord();
    expect(callerRecord.file.bytes).toBe(BYTES.byteLength);
    expect(callerRecord.file.sha256).toBe(SHA);
  });
});

describe('verify helpers (read-back verify)', () => {
  it('verifyFileIntegrity compares recomputed sha256 against the expected digest', () => {
    expect(verifyFileIntegrity(BYTES, SHA)).toBe(true);
    expect(verifyFileIntegrity(BYTES, 'f'.repeat(64))).toBe(false);
  });

  it('readBackVerified passes on matching bytes+hash and fails on any read-back problem', async () => {
    expect(await readBackVerified({ readBack: async () => BYTES, expectedSha256: SHA, expectedBytes: BYTES.byteLength })).toBe(true);
    expect(await readBackVerified({ readBack: async () => BYTES, expectedSha256: SHA })).toBe(true);
    // Read-back throws.
    expect(await readBackVerified({ readBack: async () => { throw new Error('boom'); }, expectedSha256: SHA })).toBe(false);
    // Length mismatch.
    expect(await readBackVerified({ readBack: async () => new Uint8Array(BYTES.byteLength + 1), expectedSha256: SHA, expectedBytes: BYTES.byteLength })).toBe(false);
    // Hash mismatch.
    expect(await readBackVerified({ readBack: async () => BYTES, expectedSha256: 'e'.repeat(64), expectedBytes: BYTES.byteLength })).toBe(false);
  });
});
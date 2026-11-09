/**
 * Attachment Catalog v2.
 *
 * Covers: per-record atomic JSON layout under `catalog/v2/by-id` (no partial
 * files, no `.tmp` leftovers), put/get round-trip, missing -> undefined,
 * corrupt Json/schema -> undefined (never thrown), list (sorted, corrupt and
 * transient files skipped, absent dir -> []), update of migration fields
 * (atomic), write-time zod validation, read-time tolerance of unknown extra
 * fields, the record guard/schema, and the pure legacy backfill builder.
 */
import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import {
  CatalogStore,
  CatalogStoreError,
  attachmentCatalogRecordV2Schema,
  isAttachmentCatalogRecordV2,
} from '../src/catalog/store.ts';
import {
  CATALOG_SCHEMA_VERSION,
  type AttachmentCatalogRecordV2,
} from '../src/catalog/types.ts';
import {
  buildCatalogRecordFromLegacy,
  isCatalogableLegacyKind,
} from '../src/catalog/legacy-backfill.ts';
import type { StoredChannelAsset } from '../src/attachments/types.ts';

async function mkdtempTmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'dsh-catalog-'));
}

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const ATT_1 = 'att-00000000-0000-4000-8000-000000000001';
const ATT_A = 'att-00000000-0000-4000-8000-00000000000a';
const ATT_B = 'att-00000000-0000-4000-8000-00000000000b';
const ATT_BAD = 'att-00000000-0000-4000-8000-000000000bad';
const ATT_FUTURE = 'att-00000000-0000-4000-8000-000000000f00';
const ATT_LEGACY = 'att-00000000-0000-4000-8000-000000000e01';
const ATT_X = 'att-00000000-0000-4000-8000-00000000000f';

function makeRecord(overrides: Partial<AttachmentCatalogRecordV2> = {}): AttachmentCatalogRecordV2 {
  return {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    attachmentId: ATT_1,
    owner: { sessionId: 'sess-1' },
    provenance: {
      channelId: 'weixin',
      accountId: 'main',
      conversationId: 'u1',
      conversationType: 'dm',
      messageId: 'msg-1',
    },
    file: { kind: 'file', name: 'note.txt', bytes: 11, sha256: HASH_A },
    storage: { backend: 'channel-v1' },
    createdAt: 1234567890,
    ...overrides,
  } as AttachmentCatalogRecordV2;
}

function makeLegacyAsset(overrides: Partial<StoredChannelAsset> = {}): StoredChannelAsset {
  return {
    schemaVersion: 1,
    attachmentId: ATT_LEGACY,
    sessionId: 'sess-9',
    channelId: 'telegram',
    accountId: 'bot-main',
    conversationId: 'chat-42',
    conversationType: 'group',
    threadId: 'thread-7',
    messageId: 'msg-99',
    kind: 'audio',
    name: 'voice.ogg',
    mimeType: 'audio/ogg',
    bytes: 1234,
    sha256: HASH_B,
    extraction: { status: 'not-needed' },
    createdAt: 987654321,
    ...overrides,
  } as StoredChannelAsset;
}

describe('catalog v2 disk layout + round-trip', () => {
  it('put writes one atomic JSON file under catalog/v2/by-id and get round-trips', async () => {
    const root = await mkdtempTmp();
    try {
      const store = new CatalogStore({ root: join(root, 'catalog', 'v2') });
      const record = makeRecord();
      await store.put(record);

      // Layout: <root>/catalog/v2/by-id/<att-UUID>.json
      const byId = join(root, 'catalog', 'v2', 'by-id');
      expect(existsSync(join(byId, ATT_1 + '.json'))).toBe(true);
      // Atomicity: no partial/tmp files are left behind.
      expect(await readdir(byId)).toEqual([ATT_1 + '.json']);

      const stored = JSON.parse(await readFile(join(byId, ATT_1 + '.json'), 'utf8'));
      expect(stored).toEqual(record);
      if (process.platform !== 'win32') {
        expect((await stat(join(byId, ATT_1 + '.json'))).mode & 0o777).toBe(0o600);
      }

      expect(await store.get(ATT_1)).toEqual(record);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('get returns undefined for a missing id (and a missing catalog dir) without throwing', async () => {
    const root = await mkdtempTmp();
    try {
      // Catalog directory never created: catalog miss MUST be non-fatal.
      const store = new CatalogStore({ root: join(root, 'catalog', 'v2') });
      await expect(store.get('nope')).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('get returns undefined for corrupt JSON (logged, never thrown)', async () => {
    const root = await mkdtempTmp();
    try {
      const log = vi.fn();
      const store = new CatalogStore({ root: join(root, 'catalog', 'v2'), log });
      await store.put(makeRecord());
      await writeFile(join(root, 'catalog', 'v2', 'by-id', ATT_BAD + '.json'), 'not json {{{', 'utf8');
      await expect(store.get(ATT_BAD)).resolves.toBeUndefined();
      // Healthy neighbor record unaffected.
      expect(await store.get(ATT_1)).toEqual(makeRecord());
      expect(log).toHaveBeenCalledWith(expect.stringContaining(ATT_BAD));
      expect(log).toHaveBeenCalledWith(expect.stringContaining('invalid JSON'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('get returns undefined for schema-mismatched JSON (logged, never thrown)', async () => {
    const root = await mkdtempTmp();
    try {
      const log = vi.fn();
      const store = new CatalogStore({ root: join(root, 'catalog', 'v2'), log });
      // Wrong schemaVersion + missing provenance.
      await mkdir(join(root, 'catalog', 'v2', 'by-id'), { recursive: true });
      await writeFile(
        join(root, 'catalog', 'v2', 'by-id', ATT_BAD + '.json'),
        JSON.stringify({ schemaVersion: 1, attachmentId: ATT_BAD }),
        'utf8',
      );
      await expect(store.get(ATT_BAD)).resolves.toBeUndefined();
      expect(log).toHaveBeenCalledWith(expect.stringContaining('schema mismatch'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('unknown extra fields on read are tolerated (never corrupt)', async () => {
    const root = await mkdtempTmp();
    try {
      const store = new CatalogStore({ root: join(root, 'catalog', 'v2') });
      // A future schema may write extra fields; they must not break reads.
      const withExtra = { ...makeRecord({ attachmentId: ATT_FUTURE }), futureField: 'whatever' };
      await store.put(withExtra as AttachmentCatalogRecordV2);
      const got = await store.get(ATT_FUTURE);
      expect(got?.attachmentId).toBe(ATT_FUTURE);
      expect(got).not.toHaveProperty('futureField');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('list returns all readable records sorted; corrupt and .tmp entries are skipped', async () => {
    const root = await mkdtempTmp();
    try {
      const store = new CatalogStore({ root: join(root, 'catalog', 'v2') });
      await store.put(makeRecord({ attachmentId: ATT_B }));
      await store.put(makeRecord({ attachmentId: ATT_A, file: { kind: 'video', name: 'v.mp4', bytes: 5, sha256: HASH_A } }));
      // Corrupt record + a crashed .tmp file must be skipped.
      await writeFile(join(root, 'catalog', 'v2', 'by-id', ATT_BAD + '.json'), 'garbage', 'utf8');
      await writeFile(join(root, 'catalog', 'v2', 'by-id', ATT_1 + '.json.abc.tmp'), 'partial', 'utf8');
      const ids = (await store.list()).map((r) => r.attachmentId);
      expect(ids).toEqual([ATT_A, ATT_B]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('list returns [] when the catalog dir is absent', async () => {
    const root = await mkdtempTmp();
    try {
      const store = new CatalogStore({ root: join(root, 'catalog', 'v2') });
      expect(await store.list()).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('catalog v2 update (migration state transitions)', () => {
  it('update applies storage + migration fields atomically', async () => {
    const root = await mkdtempTmp();
    try {
      const store = new CatalogStore({ root: join(root, 'catalog', 'v2') });
      await store.put(makeRecord());
      const updated = await store.update(ATT_1, {
        storage: { backend: 'harness-native', nativeId: 'native-1' },
        migration: {
          sourceBackend: 'channel-v1',
          migratedAt: 111,
          verifiedAt: 222,
          legacyRetained: true,
        },
      });
      expect(updated?.storage).toEqual({ backend: 'harness-native', nativeId: 'native-1' });
      expect(updated?.migration).toEqual({
        sourceBackend: 'channel-v1',
        migratedAt: 111,
        verifiedAt: 222,
        legacyRetained: true,
      });
      const reread = await store.get(ATT_1);
      expect(reread).toEqual(updated);
      // Atomic: no partial/tmp files after the transition.
      expect(await readdir(join(root, 'catalog', 'v2', 'by-id'))).toEqual([ATT_1 + '.json']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('update leaves unrelated fields untouched and returns undefined for missing ids', async () => {
    const root = await mkdtempTmp();
    try {
      const store = new CatalogStore({ root: join(root, 'catalog', 'v2') });
      const before = makeRecord({ attachmentId: ATT_X, provenance: { channelId: 'qq', accountId: 'a2', conversationId: 'c2', messageId: 'm2' } });
      await store.put(before);
      const updated = await store.update(ATT_X, { migration: { sourceBackend: 'channel-v1', legacyRetained: true } });
      expect(updated?.storage).toEqual({ backend: 'channel-v1' });
      expect(updated?.provenance).toEqual(before.provenance);
      expect(updated?.file).toEqual(before.file);

      await expect(store.update('nope', { storage: { backend: 'harness-native', nativeId: 'n1' } })).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('serializes concurrent read-modify-write updates without losing fields', async () => {
    const root = await mkdtempTmp();
    try {
      const store = new CatalogStore({ root: join(root, 'catalog', 'v2') });
      await store.put(makeRecord());
      await Promise.all([
        store.update(ATT_1, {
          storage: { backend: 'harness-native', nativeId: 'native-concurrent' },
        }),
        store.update(ATT_1, {
          migration: { sourceBackend: 'channel-v1', legacyRetained: true },
        }),
      ]);
      const record = await store.get(ATT_1);
      expect(record?.storage).toEqual({
        backend: 'harness-native',
        nativeId: 'native-concurrent',
      });
      expect(record?.migration).toEqual({
        sourceBackend: 'channel-v1',
        legacyRetained: true,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('catalog v2 write-time validation (zod, AGENTS.md 5.4)', () => {
  it('put rejects an invalid record with CatalogStoreError and leaves no file', async () => {
    const root = await mkdtempTmp();
    try {
      const store = new CatalogStore({ root: join(root, 'catalog', 'v2') });
      const bad = makeRecord();
      delete (bad as Partial<AttachmentCatalogRecordV2>).createdAt;
      await expect(store.put(bad)).rejects.toBeInstanceOf(CatalogStoreError);
      // Wrong storage variant (native without nativeId).
      await expect(
        store.put(makeRecord({ storage: { backend: 'harness-native' } as never })),
      ).rejects.toBeInstanceOf(CatalogStoreError);
      // Nothing was persisted for either attempt.
      expect(await store.get(ATT_1)).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('isAttachmentCatalogRecordV2 guard classifies valid/partial/garbage', () => {
    expect(isAttachmentCatalogRecordV2(makeRecord())).toBe(true);
    expect(isAttachmentCatalogRecordV2(null)).toBe(false);
    expect(isAttachmentCatalogRecordV2({ attachmentId: ATT_1 })).toBe(false);
    expect(isAttachmentCatalogRecordV2(makeRecord({ schemaVersion: 1 as never }))).toBe(false);
  });

  it('schema safeParse tolerates unknown extra fields and rejects bad sha256', () => {
    expect(attachmentCatalogRecordV2Schema.safeParse({ ...makeRecord(), extra: 1 }).success).toBe(true);
    expect(
      attachmentCatalogRecordV2Schema.safeParse(makeRecord({ file: { kind: 'file', name: 'x', bytes: 1, sha256: 'not-hex' } })).success,
    ).toBe(false);
  });

  it('rejects non UUID and traversal IDs before constructing a path', async () => {
    const root = await mkdtempTmp();
    try {
      const store = new CatalogStore({ root: join(root, 'catalog', 'v2') });
      await expect(
        store.put(makeRecord({ attachmentId: '../outside' })),
      ).rejects.toBeInstanceOf(CatalogStoreError);
      await expect(store.get('../outside')).resolves.toBeUndefined();
      await expect(store.update('att-1', {})).resolves.toBeUndefined();
      expect(existsSync(join(root, 'catalog'))).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects a valid file whose embedded attachmentId differs from the request', async () => {
    const root = await mkdtempTmp();
    try {
      const log = vi.fn();
      const byId = join(root, 'catalog', 'v2', 'by-id');
      await mkdir(byId, { recursive: true });
      await writeFile(join(byId, ATT_BAD + '.json'), JSON.stringify(makeRecord()), 'utf8');
      const store = new CatalogStore({ root: join(root, 'catalog', 'v2'), log });
      await expect(store.get(ATT_BAD)).resolves.toBeUndefined();
      expect(log).toHaveBeenCalledWith(expect.stringContaining('attachmentId mismatch'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('catalog v2 legacy backfill (pure builder)', () => {
  it('buildCatalogRecordFromLegacy maps every v1 field to v2', () => {
    const record = buildCatalogRecordFromLegacy(makeLegacyAsset());
    expect(record.schemaVersion).toBe(CATALOG_SCHEMA_VERSION);
    expect(record.attachmentId).toBe(ATT_LEGACY);
    expect(record.owner).toEqual({ sessionId: 'sess-9' });
    expect(record.provenance).toEqual({
      channelId: 'telegram',
      accountId: 'bot-main',
      conversationId: 'chat-42',
      conversationType: 'group',
      threadId: 'thread-7',
      messageId: 'msg-99',
    });
    expect(record.file).toEqual({ kind: 'audio', name: 'voice.ogg', mimeType: 'audio/ogg', bytes: 1234, sha256: HASH_B });
    expect(record.storage).toEqual({ backend: 'channel-v1' });
    expect(record.migration?.sourceBackend).toBe('channel-v1');
    expect(record.migration?.migratedAt).toBeUndefined();
    expect(record.createdAt).toBe(987654321);
  });

  it('omits optional provenance/file fields when absent in the legacy asset', () => {
    const minimal = makeLegacyAsset({
      conversationType: undefined,
      threadId: undefined,
      mimeType: undefined,
    } as Partial<StoredChannelAsset>);
    const record = buildCatalogRecordFromLegacy(minimal);
    expect(record.provenance).not.toHaveProperty('conversationType');
    expect(record.provenance).not.toHaveProperty('threadId');
    expect(record.file).not.toHaveProperty('mimeType');
  });

  it('keeps the logical attachment id unchanged', () => {
    const record = buildCatalogRecordFromLegacy(makeLegacyAsset());
    expect(record.attachmentId).toBe(makeLegacyAsset().attachmentId);
  });

  it('isCatalogableLegacyKind is true for file/audio/video only', () => {
    expect(isCatalogableLegacyKind(makeLegacyAsset({ kind: 'file' }))).toBe(true);
    expect(isCatalogableLegacyKind(makeLegacyAsset({ kind: 'audio' }))).toBe(true);
    expect(isCatalogableLegacyKind(makeLegacyAsset({ kind: 'video' }))).toBe(true);
  });

  it('buildCatalogRecordFromLegacy result round-trips through the store', async () => {
    const root = await mkdtempTmp();
    try {
      const store = new CatalogStore({ root: join(root, 'catalog', 'v2') });
      const record = buildCatalogRecordFromLegacy(makeLegacyAsset());
      await store.put(record);
      expect(await store.get(ATT_LEGACY)).toEqual(record);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

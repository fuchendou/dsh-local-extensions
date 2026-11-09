/**
 * Phase C — v1 permanent reader + schema evolution.
 *
 * C1 (v1 permanent reader): a legacy v1 tree hand-written on disk
 * (`sessions/<sessionId>/<messageId>/<attachmentId>/{meta.json, raw.bin,
 * extracted.md}` + the store-owned `index.json`, exactly the layout the store
 * has always published) must remain readable by the CURRENT package through
 * `get`, `readRaw`, `readExtracted`, `resolveAttachment` and the
 * `read_channel_attachment` tool.
 *
 * C2 (schema evolution): the reader must tolerate meta.json carrying extra
 * unknown fields (a future v2/vN writer) and absent optional fields, and must
 * NEVER rewrite on read — reads are strictly read-only (no `.staging`, no new
 * files, meta/index byte-identical), and a meta.json missing a REQUIRED field
 * is treated as missing (fail-closed) instead of being auto-repaired.
 *
 * End-to-end legacy path: a PDF-like file ingested today through
 * put -> extraction -> tool still returns extracted text (the "old
 * PDF/DOCX/XLSX extracted data still readable" regression). DOCX/XLSX
 * extraction correctness itself is covered by
 * pdf-docx-xlsx-extractors.test.ts; the pipeline path here is identical.
 */
import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileChannelInboundAssetStore } from '../src/attachments/store.ts';
import { DEFAULT_ATTACHMENT_POLICY } from '../src/attachments/policy.ts';
import { resolveAttachment } from '../src/attachment-resolver.ts';
import { registerReadChannelAttachmentTool } from '../src/attachments/tool-read.ts';
import { storeBinaryPart } from '../src/attachments/pipeline.ts';
import { createAttachmentExtractor } from '../src/attachments/pipeline-extractor.ts';
import { sha256Hex } from '../src/attachments/hash.ts';
import { OutboxError } from '@wsz987/channel-harness';

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'dsh-v1compat-'));
}

/** Fake tool exec carrying a session id (mirrors tool-read.test.ts). */
type Exec = any;
function execFor(sessionId: string, signal: AbortSignal = new AbortController().signal): Exec {
  return { signal, deferContext: () => {}, concludeTurn: () => {}, agent: { id: sessionId } };
}

/**
 * Hand-write one legacy v1 asset tree (meta.json + raw.bin [+ extracted.md])
 * and record it in the store-owned index.json — exactly what an older store
 * instance would have left on disk.
 */
async function writeLegacyAsset(
  root: string,
  opts: {
    sessionId: string;
    messageId: string;
    attachmentId: string;
    meta: Record<string, unknown>;
    raw: Uint8Array;
    extracted?: string;
  },
): Promise<void> {
  const dir = join(root, 'sessions', opts.sessionId, opts.messageId, opts.attachmentId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'meta.json'), JSON.stringify(opts.meta, null, 2), 'utf8');
  await writeFile(join(dir, 'raw.bin'), opts.raw);
  if (opts.extracted !== undefined) {
    await writeFile(join(dir, 'extracted.md'), opts.extracted, 'utf8');
  }
  // Record the lookup entry in the durable index (v1 layout).
  const indexPath = join(root, 'index.json');
  let index: Record<string, { sessionId: string; messageId: string }> = {};
  try {
    index = JSON.parse(await readFile(indexPath, 'utf8')) as typeof index;
  } catch {
    // first asset in this root
  }
  index[opts.attachmentId] = { sessionId: opts.sessionId, messageId: opts.messageId };
  await writeFile(indexPath, JSON.stringify(index, null, 2), 'utf8');
}

/** Recursive, sorted list of relative file paths under a root. */
async function listFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, rel: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const relPath = rel ? join(rel, entry.name) : entry.name;
      if (entry.isDirectory()) await walk(join(dir, entry.name), relPath);
      else out.push(relPath);
    }
  }
  await walk(root, '');
  return out.sort();
}

/** A fully-populated legacy v1 meta object (schemaVersion 1, all fields). */
function legacyMeta(opts: {
  attachmentId: string;
  sessionId: string;
  raw: Uint8Array;
  extracted?: string;
  extra?: Record<string, unknown>;
  omit?: ('conversationType' | 'threadId' | 'mimeType')[];
}): Record<string, unknown> {
  const meta: Record<string, unknown> = {
    schemaVersion: 1,
    attachmentId: opts.attachmentId,
    sessionId: opts.sessionId,
    channelId: 'weixin',
    accountId: 'main',
    conversationId: 'u1',
    messageId: 'm-9',
    kind: 'file',
    name: 'legacy.txt',
    bytes: opts.raw.byteLength,
    sha256: sha256Hex(opts.raw),
    createdAt: 1700000000000,
  };
  if (!opts.omit?.includes('conversationType')) meta.conversationType = 'dm';
  if (!opts.omit?.includes('threadId')) meta.threadId = 't-9';
  if (!opts.omit?.includes('mimeType')) meta.mimeType = 'text/plain';
  if (opts.extracted !== undefined) {
    meta.extraction = {
      status: 'ready',
      format: 'text',
      bytes: new TextEncoder().encode(opts.extracted).byteLength,
    };
  } else {
    meta.extraction = { status: 'not-needed' };
  }
  return { ...meta, ...(opts.extra ?? {}) };
}

describe('§25-C1 — v1 permanent reader on a hand-written legacy tree', () => {
  it('get() reads the legacy asset; readRaw/readExtracted return the exact stored bytes/text', async () => {
    const root = await tempRoot();
    try {
      const raw = new TextEncoder().encode('legacy raw payload');
      const meta = legacyMeta({ attachmentId: 'att-legacy', sessionId: 'S', raw, extracted: 'legacy extracted text' });
      await writeLegacyAsset(root, {
        sessionId: 'S',
        messageId: 'm-9',
        attachmentId: 'att-legacy',
        meta,
        raw,
        extracted: 'legacy extracted text',
      });

      const store = new FileChannelInboundAssetStore({ root });

      // get(): the CURRENT reader parses the legacy meta without migration.
      const asset = await store.get('att-legacy');
      expect(asset).toEqual(meta);
      expect(asset?.schemaVersion).toBe(1);
      expect(asset?.sessionId).toBe('S');

      // readRaw(): verbatim bytes, no transforms.
      const bytes = await store.readRaw('att-legacy', {
        maxBytes: DEFAULT_ATTACHMENT_POLICY.maxInboundBytes,
      });
      expect(Array.from(bytes)).toEqual(Array.from(raw));

      // readExtracted(): the legacy extracted.md text.
      const extracted = await store.readExtracted('att-legacy', {
        maxBytes: DEFAULT_ATTACHMENT_POLICY.extract.maxOutputBytes,
      });
      expect(extracted).toBe('legacy extracted text');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('resolveAttachment returns the legacy bytes for the owning session', async () => {
    const root = await tempRoot();
    try {
      const raw = new TextEncoder().encode('legacy raw payload');
      await writeLegacyAsset(root, {
        sessionId: 'S',
        messageId: 'm-9',
        attachmentId: 'att-legacy',
        meta: legacyMeta({ attachmentId: 'att-legacy', sessionId: 'S', raw, extracted: 'legacy extracted text' }),
        raw,
        extracted: 'legacy extracted text',
      });

      const store = new FileChannelInboundAssetStore({ root });
      const resolved = await resolveAttachment('att-legacy', 'S', store, {
        policy: DEFAULT_ATTACHMENT_POLICY,
      });
      expect(resolved.kind).toBe('file');
      expect(resolved.name).toBe('legacy.txt');
      expect(resolved.mimeType).toBe('text/plain');
      expect(Array.from(resolved.data)).toEqual(Array.from(raw));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('read_channel_attachment reads the legacy tree for the owner and denies a foreign session', async () => {
    const root = await tempRoot();
    try {
      const raw = new TextEncoder().encode('legacy raw payload');
      await writeLegacyAsset(root, {
        sessionId: 'S',
        messageId: 'm-9',
        attachmentId: 'att-legacy',
        meta: legacyMeta({ attachmentId: 'att-legacy', sessionId: 'S', raw, extracted: 'legacy extracted text' }),
        raw,
        extracted: 'legacy extracted text',
      });

      const store = new FileChannelInboundAssetStore({ root });
      const def = registerReadChannelAttachmentTool({ store });

      const owned: any = await def.execute({ attachment_id: 'att-legacy' }, execFor('S'));
      expect(owned.readable).toBe(true);
      expect(owned.text).toContain('legacy extracted text');

      await expect(def.execute({ attachment_id: 'att-legacy' }, execFor('T'))).rejects.toMatchObject({
        code: 'ATTACHMENT_ACCESS_DENIED',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('legacy reads are strictly read-only: no .staging, no new files, meta/index byte-identical', async () => {
    const root = await tempRoot();
    try {
      const raw = new TextEncoder().encode('legacy raw payload');
      await writeLegacyAsset(root, {
        sessionId: 'S',
        messageId: 'm-9',
        attachmentId: 'att-legacy',
        meta: legacyMeta({ attachmentId: 'att-legacy', sessionId: 'S', raw, extracted: 'legacy extracted text' }),
        raw,
        extracted: 'legacy extracted text',
      });

      const before = await listFiles(root);
      const metaBefore = await readFile(join(root, 'sessions', 'S', 'm-9', 'att-legacy', 'meta.json'), 'utf8');
      const indexBefore = await readFile(join(root, 'index.json'), 'utf8');

      const store = new FileChannelInboundAssetStore({ root });
      await store.get('att-legacy');
      await store.readRaw('att-legacy', { maxBytes: DEFAULT_ATTACHMENT_POLICY.maxInboundBytes });
      await store.readExtracted('att-legacy', { maxBytes: DEFAULT_ATTACHMENT_POLICY.extract.maxOutputBytes });
      await resolveAttachment('att-legacy', 'S', store, { policy: DEFAULT_ATTACHMENT_POLICY });
      const def = registerReadChannelAttachmentTool({ store });
      await def.execute({ attachment_id: 'att-legacy' }, execFor('S'));

      // Reads must be free of side effects (never rewrite on read).
      expect(await listFiles(root)).toEqual(before);
      expect(existsSync(join(root, '.staging'))).toBe(false);
      expect(
        await readFile(join(root, 'sessions', 'S', 'm-9', 'att-legacy', 'meta.json'), 'utf8'),
      ).toBe(metaBefore);
      expect(await readFile(join(root, 'index.json'), 'utf8')).toBe(indexBefore);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('§25-C2 — schema evolution (reader tolerance, never rewrite on read)', () => {
  it('meta.json with extra unknown fields still parses and reads (future vN writer)', async () => {
    const root = await tempRoot();
    try {
      const raw = new TextEncoder().encode('extra-fields payload');
      await writeLegacyAsset(root, {
        sessionId: 'S',
        messageId: 'm-x',
        attachmentId: 'att-extra',
        meta: legacyMeta({
          attachmentId: 'att-extra',
          sessionId: 'S',
          raw,
          extracted: 'extra fields text',
          extra: {
            vendorNote: 'written by an older build',
            future: { nested: true, v2flag: 'on' },
            legacyAlias: 'att-extra',
          },
        }),
        raw,
        extracted: 'extra fields text',
      });

      const store = new FileChannelInboundAssetStore({ root });
      const asset = await store.get('att-extra');
      // Required fields parse; unknown fields are tolerated (stripped, never fatal).
      expect(asset).toMatchObject({
        schemaVersion: 1,
        attachmentId: 'att-extra',
        sessionId: 'S',
        kind: 'file',
        name: 'legacy.txt',
        bytes: raw.byteLength,
        sha256: sha256Hex(raw),
      });
      expect(asset).not.toHaveProperty('vendorNote');

      const bytes = await store.readRaw('att-extra', { maxBytes: DEFAULT_ATTACHMENT_POLICY.maxInboundBytes });
      expect(Array.from(bytes)).toEqual(Array.from(raw));

      const resolved = await resolveAttachment('att-extra', 'S', store, {
        policy: DEFAULT_ATTACHMENT_POLICY,
      });
      expect(Array.from(resolved.data)).toEqual(Array.from(raw));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('meta.json with optional fields missing still parses and reads', async () => {
    const root = await tempRoot();
    try {
      const raw = new TextEncoder().encode('minimal payload');
      await writeLegacyAsset(root, {
        sessionId: 'S',
        messageId: 'm-min',
        attachmentId: 'att-min',
        meta: legacyMeta({
          attachmentId: 'att-min',
          sessionId: 'S',
          raw,
          extracted: 'minimal fields text',
          omit: ['conversationType', 'threadId', 'mimeType'],
        }),
        raw,
        extracted: 'minimal fields text',
      });

      const store = new FileChannelInboundAssetStore({ root });
      const asset = await store.get('att-min');
      expect(asset).toMatchObject({
        schemaVersion: 1,
        attachmentId: 'att-min',
        sessionId: 'S',
        conversationId: 'u1',
        messageId: 'm-9',
        kind: 'file',
        extraction: { status: 'ready' },
      });
      // The optional fields are absent, not defaulted.
      expect(asset?.conversationType).toBeUndefined();
      expect(asset?.threadId).toBeUndefined();
      expect(asset?.mimeType).toBeUndefined();

      // Extraction status is what the tool keys on — text is still readable.
      const extracted = await store.readExtracted('att-min', {
        maxBytes: DEFAULT_ATTACHMENT_POLICY.extract.maxOutputBytes,
      });
      expect(extracted).toBe('minimal fields text');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('meta.json missing a REQUIRED field is treated as missing (fail-closed, never auto-repaired)', async () => {
    const root = await tempRoot();
    try {
      const raw = new TextEncoder().encode('orphan payload');
      const meta = legacyMeta({ attachmentId: 'att-corrupt', sessionId: 'S', raw });
      delete meta.sessionId; // a required field is gone
      await writeLegacyAsset(root, {
        sessionId: 'S',
        messageId: 'm-c',
        attachmentId: 'att-corrupt',
        meta,
        raw,
      });

      const store = new FileChannelInboundAssetStore({ root });
      // Corrupt metadata is never partially trusted: get is undefined...
      expect(await store.get('att-corrupt')).toBeUndefined();
      // ...and the resolver surfaces NOT_FOUND, not a guessed or repaired asset.
      await expect(
        resolveAttachment('att-corrupt', 'S', store, { policy: DEFAULT_ATTACHMENT_POLICY }),
      ).rejects.toBeInstanceOf(OutboxError);
      await expect(
        resolveAttachment('att-corrupt', 'S', store, { policy: DEFAULT_ATTACHMENT_POLICY }),
      ).rejects.toMatchObject({ code: 'ATTACHMENT_NOT_FOUND' });

      // And the reader did NOT rewrite/fix the file (C2: no in-place repair).
      const metaText = await readFile(join(root, 'sessions', 'S', 'm-c', 'att-corrupt', 'meta.json'), 'utf8');
      expect(JSON.parse(metaText)).not.toHaveProperty('sessionId');
      expect(existsSync(join(root, '.staging'))).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('§25-C1 — end-to-end legacy read path (put -> extraction -> tool)', () => {
  /** Minimal uncompressed PDF (same builder as pdf-docx-xlsx-extractors.test.ts). */
  function buildPdf(textLines: string[]): Uint8Array {
    const content = [
      'BT',
      '/F1 12 Tf',
      '72 720 Td',
      ...textLines.map((t) => '(' + t + ') Tj\nT*'),
      'ET',
    ].join('\n');
    return new TextEncoder().encode(
      '%PDF-1.4\n' +
        '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
        '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n' +
        '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n' +
        '4 0 obj\n<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream\nendobj\n' +
        '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n' +
        'trailer\n<< /Root 1 0 R >>\n%%EOF\n',
    );
  }

  function context(sessionId = 'S') {
    return {
      sessionId,
      channelId: 'weixin',
      accountId: 'main',
      conversationId: 'u1',
      conversationType: 'dm' as const,
      messageId: 'm-1',
    };
  }

  it('PDF-like file ingested via put -> extraction ready -> tool returns extracted text', async () => {
    const root = await tempRoot();
    try {
      const store = new FileChannelInboundAssetStore({ root });
      const extractor = createAttachmentExtractor(DEFAULT_ATTACHMENT_POLICY);
      const pdfBytes = buildPdf(['Hello, PDF!', 'Second line']);
      const descriptor = await storeBinaryPart(
        store,
        context('S'),
        { type: 'file', name: 'report.pdf', mimeType: 'application/pdf', localData: pdfBytes },
        { extractor },
      );

      expect(descriptor?.readable).toBe(true);
      const meta = await store.get(descriptor!.attachmentId);
      expect(meta?.extraction.status).toBe('ready');
      expect(meta?.extraction.format).toBe('text');

      const extracted = await store.readExtracted(descriptor!.attachmentId, {
        maxBytes: DEFAULT_ATTACHMENT_POLICY.extract.maxOutputBytes,
      });
      expect(extracted).toContain('Hello, PDF!');
      expect(extracted).toContain('Second line');

      const def = registerReadChannelAttachmentTool({ store });
      const r: any = await def.execute({ attachment_id: descriptor!.attachmentId }, execFor('S'));
      expect(r.readable).toBe(true);
      expect(r.text).toContain('Hello, PDF!');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('TXT file via put -> extraction ready -> tool returns extracted text (dependency-free path)', async () => {
    const root = await tempRoot();
    try {
      const store = new FileChannelInboundAssetStore({ root });
      const extractor = createAttachmentExtractor(DEFAULT_ATTACHMENT_POLICY);
      const descriptor = await storeBinaryPart(
        store,
        context('S'),
        { type: 'file', name: 'notes.txt', mimeType: 'text/plain', localData: new TextEncoder().encode('legacy txt body\nline two') },
        { extractor },
      );

      const meta = await store.get(descriptor!.attachmentId);
      expect(meta?.extraction.status).toBe('ready');

      const def = registerReadChannelAttachmentTool({ store });
      const r: any = await def.execute({ attachment_id: descriptor!.attachmentId }, execFor('S'));
      expect(r.readable).toBe(true);
      expect(r.text).toContain('legacy txt body');
      expect(r.text).toContain('line two');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
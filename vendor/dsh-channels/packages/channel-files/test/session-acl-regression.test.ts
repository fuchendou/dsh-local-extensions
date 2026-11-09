/**
 * Session ACL regression — resolver + tool level.
 *
 * Mirrors the plan matrix against the CURRENT code paths:
 *
 * | row                                                 | test                                                     |
 * |----------------------------------------------------|----------------------------------------------------------|
 * | Session A stores att-1                             | (setup in every test)                                    |
 * | Session A reads att-1 -> success                   | 'owner session resolves its own asset (bytes match)'     |
 * | Session B reads att-1 -> ACCESS_DENIED             | 'foreign session -> ATTACHMENT_ACCESS_DENIED (resolver)' |
 * |                                                    | 'foreign session -> ATTACHMENT_ACCESS_DENIED (tool)'     |
 * | same conversation /new -> Session B, B reads old   | '/new on the same conversation does not inherit'         |
 * | att-1 -> ACCESS_DENIED                             |                                                          |
 * | Session A resume, A reads att-1 -> success         | 'resume (fresh store, same sessionId) keeps access'      |
 * | legacy v1 file same Session -> success             | 'legacy v1 asset: owner reads, foreign denied'           |
 * | legacy v1 file different Session -> denied         | (same test; resolver + tool)                             |
 *
 * The ACL is `attachment.sessionId === invoking sessionId` —
 * never cwd, never channel/account/conversation identity. The `/new` row
 * proves a NEW Harness session for the SAME conversation does NOT inherit old
 * attachments; the resume row proves a FRESH store instance with the SAME
 * sessionId keeps access (the ACL binds the durable session id, not an
 * ephemeral in-memory identity).
 *
 * Deep hand-written v1-tree / schema-evolution coverage lives in
 * legacy-v1-compat.test.ts; this file reuses the store.put path (§33 row 6/7).
 */
import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileChannelInboundAssetStore } from '../src/attachments/store.ts';
import { DEFAULT_ATTACHMENT_POLICY } from '../src/attachments/policy.ts';
import { resolveAttachment } from '../src/attachment-resolver.ts';
import { registerReadChannelAttachmentTool } from '../src/attachments/tool-read.ts';
import { OutboxError } from '@wsz987/channel-harness';

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'dsh-acl-'));
}

/** Fake tool exec carrying a session id (mirrors tool-read.test.ts). */
type Exec = any;
function execFor(sessionId: string, signal: AbortSignal = new AbortController().signal): Exec {
  return { signal, deferContext: () => {}, concludeTurn: () => {}, agent: { id: sessionId } };
}

/**
 * Store one asset under `session` via the CURRENT store (which writes the v1
 * layout, so this doubles as the "real v1 tree ingested under a session" row)
 * and mark its extraction ready.
 */
async function putOwnedText(
  store: FileChannelInboundAssetStore,
  opts: {
    id: string;
    session: string;
    name: string;
    text: string;
    channelId?: string;
    accountId?: string;
    conversationId?: string;
  },
): Promise<void> {
  const data = new TextEncoder().encode(opts.text);
  await store.put({
    attachmentId: opts.id,
    sessionId: opts.session,
    channelId: opts.channelId ?? 'weixin',
    accountId: opts.accountId ?? 'main',
    conversationId: opts.conversationId ?? 'u1',
    conversationType: 'dm',
    messageId: 'msg-1',
    kind: 'file',
    name: opts.name,
    mimeType: 'text/plain',
    data,
  });
  await store.putExtracted(opts.id, { text: opts.text, format: 'text' });
}

describe('Session A stores att-1, Session A reads att-1 -> success', () => {
  it('owner session resolves its own asset (bytes match)', async () => {
    const root = await tempRoot();
    try {
      const store = new FileChannelInboundAssetStore({ root });
      await putOwnedText(store, { id: 'att-1', session: 'sessionA', name: 'a.txt', text: 'owned by A' });

      const resolved = await resolveAttachment('att-1', 'sessionA', store, {
        policy: DEFAULT_ATTACHMENT_POLICY,
      });
      expect(resolved.kind).toBe('file');
      expect(resolved.name).toBe('a.txt');
      expect(Array.from(resolved.data)).toEqual(Array.from(new TextEncoder().encode('owned by A')));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('Session B reads att-1 -> ATTACHMENT_ACCESS_DENIED', () => {
  it('foreign session -> ATTACHMENT_ACCESS_DENIED via resolver (OutboxError)', async () => {
    const root = await tempRoot();
    try {
      const store = new FileChannelInboundAssetStore({ root });
      await putOwnedText(store, { id: 'att-1', session: 'sessionA', name: 'a.txt', text: 'secret' });

      await expect(
        resolveAttachment('att-1', 'sessionB', store, { policy: DEFAULT_ATTACHMENT_POLICY }),
      ).rejects.toBeInstanceOf(OutboxError);
      await expect(
        resolveAttachment('att-1', 'sessionB', store, { policy: DEFAULT_ATTACHMENT_POLICY }),
      ).rejects.toMatchObject({ code: 'ATTACHMENT_ACCESS_DENIED' });

      // The asset itself is intact and still owner-readable (denial is
      // caller-keyed, not a global lock).
      expect(await store.get('att-1')).toMatchObject({ attachmentId: 'att-1', sessionId: 'sessionA' });
      await expect(
        resolveAttachment('att-1', 'sessionA', store, { policy: DEFAULT_ATTACHMENT_POLICY }),
      ).resolves.toMatchObject({ kind: 'file', name: 'a.txt' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('foreign session -> ATTACHMENT_ACCESS_DENIED via read_channel_attachment tool (fake agent session B)', async () => {
    const root = await tempRoot();
    try {
      const store = new FileChannelInboundAssetStore({ root });
      await putOwnedText(store, { id: 'att-1', session: 'sessionA', name: 'a.txt', text: 'secret' });
      const def = registerReadChannelAttachmentTool({ store });

      await expect(def.execute({ attachment_id: 'att-1' }, execFor('sessionB'))).rejects.toMatchObject({
        code: 'ATTACHMENT_ACCESS_DENIED',
      });

      // Same tool, same asset: the owner session still passes.
      const owned: any = await def.execute({ attachment_id: 'att-1' }, execFor('sessionA'));
      expect(owned.readable).toBe(true);
      expect(owned.text).toContain('secret');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('same conversation /new -> Session B', () => {
  it('/new on the same conversation does NOT inherit old attachments (resolver + tool)', async () => {
    const root = await tempRoot();
    try {
      const store = new FileChannelInboundAssetStore({ root });
      // att-1 is owned by sessionA; channel/account/conversation identity is
      // IDENTICAL for the /new session B — only the sessionId differs.
      await putOwnedText(store, {
        id: 'att-1',
        session: 'sessionA',
        name: 'a.txt',
        text: 'old session content',
        channelId: 'qq',
        accountId: 'main',
        conversationId: 'u1',
      });

      // Resolver: the new session (same conversation) must be denied.
      await expect(
        resolveAttachment('att-1', 'sessionB', store, { policy: DEFAULT_ATTACHMENT_POLICY }),
      ).rejects.toMatchObject({ code: 'ATTACHMENT_ACCESS_DENIED' });

      // Tool: the same call as the /new Harness session would make.
      const def = registerReadChannelAttachmentTool({ store });
      await expect(def.execute({ attachment_id: 'att-1' }, execFor('sessionB'))).rejects.toMatchObject({
        code: 'ATTACHMENT_ACCESS_DENIED',
      });

      // Old bytes stay on disk, un-revoked and still owner-visible.
      expect(await store.get('att-1')).toMatchObject({
        attachmentId: 'att-1',
        sessionId: 'sessionA',
        channelId: 'qq',
        conversationId: 'u1',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('Session A resume', () => {
  it('resume (fresh store instance, same recorded sessionId) keeps attachment access', async () => {
    const root = await tempRoot();
    try {
      // First lifetime: Session A stores att-1.
      const store1 = new FileChannelInboundAssetStore({ root });
      await putOwnedText(store1, { id: 'att-1', session: 'sessionA', name: 'a.txt', text: 'resumed' });

      // Resume: an ephemeral recreate preserves the RECORDED session id, so a
      // brand-new store instance against the same on-disk files (the same as a
      // resumed Harness session would face) can still read.
      const store2 = new FileChannelInboundAssetStore({ root });
      const resolved = await resolveAttachment('att-1', 'sessionA', store2, {
        policy: DEFAULT_ATTACHMENT_POLICY,
      });
      expect(Array.from(resolved.data)).toEqual(Array.from(new TextEncoder().encode('resumed')));

      // And a DIFFERENT session still cannot (ACL binds sessionId, not cwd).
      await expect(
        resolveAttachment('att-1', 'sessionB', store2, { policy: DEFAULT_ATTACHMENT_POLICY }),
      ).rejects.toMatchObject({ code: 'ATTACHMENT_ACCESS_DENIED' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('legacy v1 file ingested under Session A', () => {
  it('legacy v1 asset: same session reads OK (resolver + tool), different session DENIED', async () => {
    const root = await tempRoot();
    try {
      // store.put writes the v1 on-disk tree (sessions/<sid>/<mid>/<aid>/...).
      const store = new FileChannelInboundAssetStore({ root });
      await putOwnedText(store, { id: 'att-legacy', session: 'sessionA', name: 'legacy.txt', text: 'v1 payload' });

      // Same session -> success at both levels.
      const resolved = await resolveAttachment('att-legacy', 'sessionA', store, {
        policy: DEFAULT_ATTACHMENT_POLICY,
      });
      expect(Array.from(resolved.data)).toEqual(Array.from(new TextEncoder().encode('v1 payload')));

      const def = registerReadChannelAttachmentTool({ store });
      const owned: any = await def.execute({ attachment_id: 'att-legacy' }, execFor('sessionA'));
      expect(owned.readable).toBe(true);
      expect(owned.text).toContain('v1 payload');

      // Different session -> denied at both levels.
      await expect(
        resolveAttachment('att-legacy', 'sessionB', store, { policy: DEFAULT_ATTACHMENT_POLICY }),
      ).rejects.toMatchObject({ code: 'ATTACHMENT_ACCESS_DENIED' });
      await expect(def.execute({ attachment_id: 'att-legacy' }, execFor('sessionB'))).rejects.toMatchObject({
        code: 'ATTACHMENT_ACCESS_DENIED',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
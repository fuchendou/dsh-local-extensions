import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { bindingKey, type SessionBinding } from './session-router.js';

const selectionSchema = z.object({
  provider: z.string().min(1), model: z.string().min(1), reasoningEffort: z.string().optional(),
});
const bindingSchema = z.object({
  channelId: z.string(), accountId: z.string(), conversationId: z.string(),
  conversationType: z.enum(['dm', 'group']), senderId: z.string().optional(), threadId: z.string().optional(),
  sessionId: z.string(), durability: z.enum(['durable', 'ephemeral']).optional(), mirror: z.boolean().optional(),
  route: z.object({ preset: z.string().optional(), provider: z.string().optional(), model: z.string().optional(), maxTokens: z.number().optional() }),
  schemaVersion: z.literal(3), createdAt: z.number(), updatedAt: z.number(),
});
const entrySchema = z.object({
  binding: bindingSchema,
  title: z.string().max(80),
  kind: z.enum(['chat', 'goal']),
  awaitingGoal: z.boolean(),
  runIntent: z.enum(['running', 'paused']),
  goalPhase: z.enum(['active', 'paused', 'blocked', 'complete']).optional(),
  modelPolicy: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('auto') }),
    z.object({ mode: z.literal('manual'), selection: selectionSchema }),
  ]),
  lastEffective: selectionSchema.optional(),
  routine: z.object({ ownerSessionId: z.string(), selection: selectionSchema.optional() }).optional(),
  previousSandbox: z.enum(['read-only', 'workspace-write', 'danger-full-access']).optional(),
  planStartOffset: z.number().int().nonnegative().optional(),
  notification: z.object({ key: z.string(), text: z.string(), sent: z.boolean() }).optional(),
});
const indexSchema = z.object({ version: z.literal(1), entries: z.array(entrySchema) });

export type SessionEntry = z.infer<typeof entrySchema>;
export type SessionModelPolicy = SessionEntry['modelPolicy'];
export type SessionModelSelection = z.infer<typeof selectionSchema>;

export function sameOwner(a: SessionBinding, b: SessionBinding): boolean {
  return bindingKey(a) === bindingKey(b) && a.conversationType === b.conversationType
    && a.senderId === b.senderId;
}

export function shortSessionId(id: string): string {
  return id.startsWith('ch-') ? id.slice(3, 11) : id.slice(0, 8);
}

export class ChannelSessionIndex {
  private entries = new Map<string, SessionEntry>();
  private chain: Promise<void> = Promise.resolve();
  readonly ready: Promise<void>;

  constructor(private readonly path?: string) {
    this.ready = this.load();
    void this.ready.catch(() => {});
  }
  get storagePath(): string | undefined { return this.path; }

  private async load(): Promise<void> {
    if (!this.path) return;
    let text: string;
    try { text = await readFile(this.path, 'utf8'); }
    catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
      throw error;
    }
    const parsed = indexSchema.safeParse(JSON.parse(text));
    if (!parsed.success) throw new Error('会话索引损坏，已停止读取；请恢复备份。');
    for (const entry of parsed.data.entries) {
      if (this.entries.has(entry.binding.sessionId)) throw new Error('会话索引包含重复 ID。');
      this.entries.set(entry.binding.sessionId, entry);
    }
  }

  async get(id: string): Promise<SessionEntry | undefined> {
    await this.ready;
    await this.chain;
    const entry = this.entries.get(id);
    return entry && structuredClone(entry);
  }

  peek(id: string): SessionEntry | undefined {
    const entry = this.entries.get(id);
    return entry && structuredClone(entry);
  }

  async all(): Promise<SessionEntry[]> {
    await this.ready;
    await this.chain;
    return structuredClone([...this.entries.values()]);
  }

  async list(owner: SessionBinding): Promise<SessionEntry[]> {
    return (await this.all()).filter(e => !e.routine && sameOwner(e.binding, owner))
      .sort((a, b) => b.binding.createdAt - a.binding.createdAt || a.binding.sessionId.localeCompare(b.binding.sessionId));
  }

  async resolve(owner: SessionBinding, query: string): Promise<SessionEntry> {
    if (!query.trim()) throw new Error('请指定会话短 ID。');
    const entries = await this.list(owner);
    const exact = entries.find(e => e.binding.sessionId === query);
    const hits = exact ? [exact] : entries.filter(e => shortSessionId(e.binding.sessionId) === query);
    if (hits.length !== 1) throw new Error(hits.length ? '短 ID 不唯一，请使用完整 ID。' : '未找到属于当前对话的会话。');
    return hits[0]!;
  }

  async track(binding: SessionBinding, title = '新会话'): Promise<SessionEntry> {
    return this.change(binding.sessionId, current => {
      if (current && !sameOwner(current.binding, binding)) throw new Error('会话归属冲突，拒绝重新绑定。');
      return current ? { ...current, binding } : {
        binding, title: title.trim().slice(0, 80) || '新会话', kind: 'chat', awaitingGoal: false,
        runIntent: 'paused', modelPolicy: { mode: 'auto' },
      };
    });
  }

  async update(id: string, patch: Partial<Omit<SessionEntry, 'binding'>>): Promise<SessionEntry> {
    return this.change(id, current => {
      if (!current) throw new Error('会话尚未登记。');
      return { ...current, ...patch };
    });
  }

  private async change(id: string, transform: (entry?: SessionEntry) => SessionEntry): Promise<SessionEntry> {
    await this.ready;
    let result!: SessionEntry;
    const task = this.chain.then(async () => {
      const parsed = entrySchema.safeParse(transform(this.entries.get(id)));
      if (!parsed.success) throw new Error('无效的会话索引更新。');
      result = parsed.data;
      const next = new Map(this.entries);
      next.set(id, result);
      if (this.path) {
        await mkdir(dirname(this.path), { recursive: true });
        const temporary = `${this.path}.${process.pid}.tmp`;
        await writeFile(temporary, JSON.stringify({ version: 1, entries: [...next.values()] }), { mode: 0o600 });
        await rename(temporary, this.path);
      }
      this.entries = next;
    });
    this.chain = task.catch(() => {});
    await task;
    return structuredClone(result);
  }
}

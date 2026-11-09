/**
 * Pure payload mapping (no I/O): Telegram Bot API updates → Channel Contract.
 *
 * Raw updates only ever ride along in `event.raw` for debugging — core and
 * the harness bridge never depend on their shape (red line 6).
 *
 * Telegram update shape (Bot API 10.2):
 * ```json
 * { "update_id": 123,
 *   "message": { "message_id": 456, "date": 1700000000,
 *     "chat": { "id": 789, "type": "private" },
 *     "from": { "id": 111, "first_name": "Alice" },
 *     "text": "hello" } }
 * ```
 *
 * `chat.type` 'private' → dm conversation; 'group'/'supergroup' → group
 * conversation keyed by the chat id. All ids are numeric on the wire and are
 * stringified into the branded contract identities. The bot token is never
 * part of any mapped event.
 */
import type {
  AccountId,
  ChannelId,
  ConversationId,
  MessageId,
  MessagePart,
  MessageReceived,
  SenderId,
} from '@wsz987/channel-core';
import type { InteractionReceived } from '@wsz987/channel-core';
import { textParts } from '@wsz987/channel-core';
import { z } from 'zod';

export interface TelegramInboundMeta {
  channel: ChannelId;
  accountId: AccountId;
  /** Trusted bot identity resolved from getMe before polling starts. */
  bot?: {
    id: number;
    username?: string;
  };
}

/** An untrusted Telegram update did not satisfy the canonical identity schema. */
export class TelegramInboundValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TelegramInboundValidationError';
  }
}

const telegramInteger = z.number().int().refine(Number.isSafeInteger, {
  message: 'expected a safe integer',
});

const telegramChatSchema = z.object({
  id: telegramInteger,
  type: z.enum(['private', 'group', 'supergroup']),
  first_name: z.string().optional(),
  username: z.string().optional(),
  title: z.string().optional(),
}).passthrough();

const telegramUserSchema = z.object({
  id: telegramInteger,
  is_bot: z.boolean().optional(),
  first_name: z.string().optional(),
  username: z.string().optional(),
}).passthrough();

const telegramMessageEntitySchema = z.object({
  type: z.string(),
  offset: telegramInteger.nonnegative(),
  length: telegramInteger.nonnegative(),
  user: telegramUserSchema.optional(),
}).passthrough();

const telegramPhotoSchema = z.object({
  file_id: z.string(),
  file_unique_id: z.string().optional(),
  width: telegramInteger.optional(),
  height: telegramInteger.optional(),
  file_size: telegramInteger.nonnegative().optional(),
}).passthrough();

const telegramDocumentSchema = z.object({
  file_id: z.string(),
  file_name: z.string().optional(),
  mime_type: z.string().optional(),
  file_size: telegramInteger.nonnegative().optional(),
}).passthrough();

const telegramAudioSchema = z.object({
  file_id: z.string(),
  duration: telegramInteger.nonnegative().optional(),
  mime_type: z.string().optional(),
  file_name: z.string().optional(),
}).passthrough();

const telegramVoiceSchema = z.object({
  file_id: z.string(),
  duration: telegramInteger.nonnegative().optional(),
  mime_type: z.string().optional(),
}).passthrough();

const telegramVideoSchema = z.object({
  file_id: z.string(),
  duration: telegramInteger.nonnegative().optional(),
  mime_type: z.string().optional(),
  file_name: z.string().optional(),
}).passthrough();

const telegramMessageSchema = z.object({
  message_id: telegramInteger,
  date: telegramInteger.optional(),
  chat: telegramChatSchema,
  from: telegramUserSchema,
  text: z.string().optional(),
  caption: z.string().optional(),
  entities: z.array(telegramMessageEntitySchema).optional(),
  caption_entities: z.array(telegramMessageEntitySchema).optional(),
  message_thread_id: telegramInteger.optional(),
  reply_to_message: z.object({ message_id: telegramInteger }).passthrough().optional(),
  photo: z.array(telegramPhotoSchema).optional(),
  document: telegramDocumentSchema.optional(),
  audio: telegramAudioSchema.optional(),
  voice: telegramVoiceSchema.optional(),
  video: telegramVideoSchema.optional(),
}).passthrough();

const telegramMessageUpdateSchema = z.object({
  update_id: telegramInteger.optional(),
  message: telegramMessageSchema,
}).passthrough();

type TelegramMessage = z.infer<typeof telegramMessageSchema>;

const telegramDedupSchema = z.object({
  update_id: telegramInteger.optional(),
  message: z.object({ message_id: telegramInteger.optional() }).passthrough().optional(),
  callback_query: z.object({ id: z.string().optional() }).passthrough().optional(),
}).passthrough();

/** Message fields that carry metadata rather than content kind. */
const TELEGRAM_META_KEYS = new Set([
  'message_id', 'date', 'chat', 'from', 'reply_to_message',
  'edit_date', 'media_group_id', 'message_thread_id', 'entities', 'caption',
  'caption_entities', 'author_signature', 'is_automatic_forward',
]);

/** Stable hash for ids when the platform omits them. */
export function simpleHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

/** Map one raw Telegram update into the stable channel event shape. */
export function mapInbound(raw: unknown, meta: TelegramInboundMeta): MessageReceived {
  const parsed = telegramMessageUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    throw new TelegramInboundValidationError('telegram mapInbound: invalid message update');
  }
  const { message } = parsed.data;
  const { chat, from } = message;

  const sender = String(from.id) as SenderId;
  // The chat id is the conversation id for both dm and group messages.
  const conversationId = String(chat.id) as ConversationId;
  const messageId = String(message.message_id) as MessageId;
  const conversationType = chat.type === 'group' || chat.type === 'supergroup' ? 'group' : 'dm';
  const mentionedBot = conversationType === 'group'
    ? messageMentionedBot(message, meta.bot)
    : undefined;

  return {
    type: 'message.received',
    channel: meta.channel,
    accountId: meta.accountId,
    conversation: {
      id: conversationId,
      // 'private' → dm; 'group'/'supergroup' → group keyed by the chat id.
      // The schema rejects unsupported chat types rather than treating them as
      // a private conversation.
      type: chat.type === 'group' || chat.type === 'supergroup' ? 'group' : 'dm',
      ...(message.message_thread_id !== undefined
        ? { threadId: String(message.message_thread_id) as never }
        : {}),
    },
    sender: { id: sender, name: from.first_name },
    message: {
      id: messageId,
      content: partsFor(message),
      ...(message.reply_to_message?.message_id !== undefined
        ? { replyTo: String(message.reply_to_message.message_id) as MessageId }
        : {}),
      // Telegram timestamps are Unix seconds; the contract uses ms.
      createdAt: message.date !== undefined ? message.date * 1000 : Date.now(),
      ...(mentionedBot !== undefined ? { activation: { mentionedBot } } : {}),
    },
    raw,
  };
}

/** Telegram entity offsets use UTF-16 code units, matching JavaScript slice. */
function messageMentionedBot(
  message: TelegramMessage,
  bot: TelegramInboundMeta['bot'],
): boolean | undefined {
  if (!bot) return undefined;

  const sources = [
    { text: message.text, entities: message.entities },
    { text: message.caption, entities: message.caption_entities },
  ];

  for (const source of sources) {
    if (!source.text || !source.entities) continue;
    for (const entity of source.entities) {
      if (entity.type === 'text_mention' && entity.user?.id === bot.id) return true;
    }
  }

  const username = bot.username?.replace(/^@/, '').toLowerCase();
  if (!username) return false;

  for (const source of sources) {
    if (!source.text || !source.entities) continue;
    for (const entity of source.entities) {
      const value = source.text.slice(entity.offset, entity.offset + entity.length);
      if (entity.type === 'mention' && value.slice(1).toLowerCase() === username) return true;
      if (entity.type === 'bot_command') {
        const addressedTo = value.slice(value.lastIndexOf('@') + 1).toLowerCase();
        if (value.includes('@') && addressedTo === username) return true;
      }
    }
  }
  return false;
}

function partsFor(message: TelegramMessage): MessagePart[] {
  if (typeof message.text === 'string') {
    return textParts(message.text);
  }
  if (Array.isArray(message.photo) && message.photo.length > 0) {
    // Telegram sends several sizes; the last entry is the largest. file_id is
    // a platform-opaque handle, so it maps to `resourceRef` — never `url`,
    // which is reserved for real http(s) URLs. The inbound processor resolves
    // this reference through getFile before emitting the channel event.
    const last = message.photo[message.photo.length - 1];
    const resourceRef = last?.file_id;
    return withCaption(message.caption, [{ type: 'image', resourceRef }]);
  }
  if (message.document) {
    return withCaption(message.caption, [{
      type: 'file',
      resourceRef: message.document.file_id,
      name: message.document.file_name,
      mimeType: message.document.mime_type,
    }]);
  }
  if (message.audio) {
    return withCaption(message.caption, [{
      type: 'audio',
      resourceRef: message.audio.file_id,
      durationMs: message.audio.duration !== undefined ? message.audio.duration * 1000 : undefined,
      mimeType: message.audio.mime_type,
    }]);
  }
  if (message.voice) {
    return [{
      type: 'audio',
      resourceRef: message.voice.file_id,
      durationMs: message.voice.duration !== undefined ? message.voice.duration * 1000 : undefined,
      mimeType: message.voice.mime_type,
    }];
  }
  if (message.video) {
    return withCaption(message.caption, [{
      type: 'video',
      resourceRef: message.video.file_id,
      durationMs: message.video.duration !== undefined ? message.video.duration * 1000 : undefined,
      mimeType: message.video.mime_type,
    }]);
  }
  return [{ type: 'unsupported', reason: `unsupported telegram message type '${messageKind(message)}'` }];
}

function withCaption(caption: string | undefined, parts: MessagePart[]): MessagePart[] {
  return typeof caption === 'string' && caption.length > 0
    ? [...textParts(caption), ...parts]
    : parts;
}

/** Best-effort content-kind name for the unsupported-part reason. */
function messageKind(message: TelegramMessage): string {
  for (const key of Object.keys(message)) {
    if (!TELEGRAM_META_KEYS.has(key)) return key;
  }
  return 'unknown';
}

/** Dedup identity for raw updates (update_id, then message_id). */
export function dedupKey(raw: unknown): string {
  const parsed = telegramDedupSchema.safeParse(raw);
  if (parsed.success) {
    const update = parsed.data;
    if (update.update_id !== undefined) return `update-${update.update_id}`;
    if (update.message?.message_id !== undefined) return `message-${update.message.message_id}`;
    if (update.callback_query?.id !== undefined) return `callback-${update.callback_query.id}`;
  }
  return `telegram-${simpleHash(JSON.stringify(raw))}`;
}

/**
 * Zod schema for a `callback_query` update. `callback_query.data` is UNTRUSTED
 * client payload: it is validated as a plain string here and only ever echoed
 * back as `InteractionReceived.action` (plan §5 / red line 5). The adapter never
 * parses it into Harness question semantics — that interpretation belongs to
 * `channel-harness`.
 */
const callbackQueryUpdateSchema = z.object({
  update_id: telegramInteger.optional(),
  callback_query: z.object({
    id: z.string(),
    from: telegramUserSchema,
    message: z.object({
      message_id: telegramInteger,
      message_thread_id: telegramInteger.optional(),
      chat: telegramChatSchema,
    }).passthrough(),
    data: z.string().optional(),
    chat_instance: z.string().optional(),
  }).passthrough(),
}).loose();

/** Whether a raw update carries a `callback_query` (message-bearing). */
export function isCallbackQueryUpdate(raw: unknown): boolean {
  return callbackQueryUpdateSchema.safeParse(raw).success;
}

/**
 * Map a validated `callback_query` update to `InteractionReceived`. Always run
 * `isCallbackQueryUpdate` first; this function re-parses defensively and throws
 * a clear error for a malformed tolerance so the adapter fails closed rather
 * than emitting a fabricated interaction.
 */
export function mapCallbackQuery(raw: unknown, meta: TelegramInboundMeta): InteractionReceived {
  const parsed = callbackQueryUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    throw new TelegramInboundValidationError('telegram mapCallbackQuery: invalid callback_query payload');
  }
  const cq = parsed.data.callback_query;
  const { chat, message_thread_id: threadId } = cq.message;
  const { from } = cq;
  const sender = String(from.id) as SenderId;
  const conversationId = String(chat.id) as ConversationId;

  return {
    type: 'interaction.received',
    channel: meta.channel,
    accountId: meta.accountId,
    conversation: {
      id: conversationId,
      // 'private' → dm; 'group'/'supergroup' → group keyed by the chat id.
      type: chat.type === 'group' || chat.type === 'supergroup' ? 'group' : 'dm',
      ...(threadId !== undefined ? { threadId: String(threadId) as never } : {}),
    },
    sender: { id: sender, name: from.first_name },
    interactionId: cq.id,
    // The untrusted callback data is surfaced verbatim as the action; the
    // adapter never interprets it (red line 5).
    action: typeof cq.data === 'string' ? cq.data : '',
    raw,
  };
}

/**
 * Durable outbox types.
 *
 * A channel send request is deliberately MINIMAL: the model supplies only
 * content (`text` and/or `attachment_id`). The durable binding resolves the
 * recipient/target; the model NEVER names a `recipient` / `channel` /
 * `account` / `conversation` / `user_id` / `openid` / `file_path`
 * (those fields must not exist on the request type).
 *
 * An outbound attachment is referenced by its private-store `attachment_id`,
 * never by a model-visible `file_path` (V1 model tools do not
 * provide `file_path`; there is no path handling anywhere in this module).
 */
import { HarnessError } from '@deepseek-ai/dsh-llm';

/**
 * One outbound channel send request. At least one of `text` / `attachmentId`
 * must be set; `text` and `attachmentId` may be combined in a single send.
 */
export interface ChannelOutboundRequest {
  /** Plain text payload. */
  text?: string;
  /** Private-store attachment id whose bytes are sent using its stored media kind. */
  attachmentId?: string;
}

/**
 * Stable, machine-routable outbox failure codes. Tool results route on `code`, never on `message`.
 */
export type OutboxErrorCode =
  | 'OUTBOX_NO_BINDING'
  | 'OUTBOX_AMBIGUOUS_BINDING'
  | 'OUTBOX_CAPABILITY_UNAVAILABLE'
  | 'ATTACHMENT_NOT_FOUND'
  | 'ATTACHMENT_ACCESS_DENIED'
  | 'ATTACHMENT_TOO_LARGE';

/**
 * Typed outbox failure carried as a `HarnessError` (mirrors the M4
 * `AttachmentReadError` pattern in tool-read.ts) so the tool pipeline records
 * a stable machine-routable `code`. Carries the session id it was raised for
 * as an optional diagnostic.
 */
export class OutboxError extends HarnessError {
  readonly sessionId?: string;
  constructor(code: OutboxErrorCode, message: string, options?: { sessionId?: string; cause?: unknown }) {
    super(message, code, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'OutboxError';
    if (options?.sessionId !== undefined) this.sessionId = options.sessionId;
  }
}

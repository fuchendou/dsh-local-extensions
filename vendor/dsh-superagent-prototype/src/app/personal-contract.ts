import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { IsolatedAsset, IsolatedFile } from './personal-isolation.ts'

export interface PersonalOwner { key: string; sessionId: string }
export interface PersonalInput { owner: PersonalOwner; sessionId: string; messageId: string; message: UserMessage;
  attachmentIds: string[]; imageIds?: string[]; isCurrent?(): boolean }
export interface PersonalConfirmation {
  owner: PersonalOwner; sessionId: string; messageId: string; message: UserMessage; attachmentIds: string[]
  imageIds?: string[]; digest: string; expiresAt: number; generation: number; attempts: number
}
export interface PersonalHandler {
  isolateAttachments?: boolean
  ready(owner: PersonalOwner): Promise<void>
  receive(input: PersonalInput): Promise<void>
  confirm(owner: PersonalOwner, code: string, isCurrent: () => boolean): Promise<string>
  cancelPending(owner: PersonalOwner): Promise<void>
  command(owner: PersonalOwner, name: 'tasks' | 'task', input: string): Promise<string>
  stop(owner: PersonalOwner): Promise<void>
}
export interface PersonalChannels {
  getProtectedPaths(): string[]
  validateSuperagentOwner(owner: PersonalOwner): Promise<unknown>
  registerSuperagentSession(owner: PersonalOwner, id: string, role: 'router' | 'worker', ticketId?: string, useManualModel?: boolean): Promise<void>
  configureSuperagentSession(id: string): Promise<void>
  superagentWorkspace(owner: PersonalOwner): Promise<string>
  readSuperagentAttachment(owner: PersonalOwner, sourceSessionId: string, attachmentId: string,
    offset: number, limit: number, signal: AbortSignal): Promise<unknown>
  resolveSuperagentAttachment?(owner: PersonalOwner, sourceSessionId: string, attachmentId: string): Promise<IsolatedAsset>
  deliverSuperagentFile(owner: PersonalOwner, sessionId: string, path: string, isolatedFile?: IsolatedFile): Promise<void>
  registerSuperagentHandler(handler: PersonalHandler): () => void
  notifySuperagentOwner(owner: PersonalOwner, text: string): Promise<void>
}

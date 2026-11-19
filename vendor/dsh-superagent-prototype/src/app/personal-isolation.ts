import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import type { Session } from '@deepseek-ai/dsh-session'
import { latestAssignment, liveTicket, type Ticket } from '../core/index.ts'

export const ISOLATED_TOOLS = new Set(['read', 'write', 'edit', 'read_image', 'glob', 'grep', 'bash', 'pwsh',
  'job_output', 'job_list', 'job_kill', 'office_status'])

export interface IsolatedFile { type: 'file'; name: string; localData: Uint8Array; mimeType?: string }
export interface IsolatedAsset { data: Uint8Array; name: string; mimeType?: string }
export interface IsolationTarget { ticket: string; epoch: number; mode: 'read-only' | 'workspace-write' }
export interface IsolatedJob { id: string; status: string }

export interface PersonalIsolation {
  ready(): Promise<string>
  call(target: IsolationTarget, name: string, args: unknown, signal: AbortSignal): Promise<ToolExecutionResult>
  input(target: IsolationTarget, asset: IsolatedAsset, offset: number, limit: number, signal: AbortSignal): Promise<unknown>
  image(target: IsolationTarget, asset: IsolatedAsset, signal: AbortSignal): Promise<ImageAttachmentRef>
  output(ticket: string, path: string): Promise<IsolatedFile>
  stop(ticket: string, epoch: number): Promise<void>
  release(ticket: string, epoch: number): Promise<void>
  jobs(ticket: string, epoch: number): Promise<IsolatedJob[]>
}

declare module '@deepseek-ai/cordis' { interface Context { personalIsolation: PersonalIsolation } }

export function isolationOf(ctx: Context): PersonalIsolation {
  const client = ctx.get('personalIsolation')
  if (!client) throw new Error('个人任务隔离服务未就绪。')
  return client
}

export function isolationTarget(ctx: Context, ticket: Ticket | undefined, session: Session): IsolationTarget {
  if (!ticket || !liveTicket(ticket) || !latestAssignment(ticket)) throw new Error('任务授权已失效。')
  const policy = (ctx as unknown as { get(name: string): { resolve(input: { session: Session }): { mode: string } } | undefined }).get('sandboxPolicy')
  const mode = policy?.resolve({ session }).mode
  if (mode !== 'read-only' && mode !== 'workspace-write') throw new Error('任务沙箱权限不可用。')
  return { ticket: ticket.id, epoch: ticket.assignments.length, mode }
}

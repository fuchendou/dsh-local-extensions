import { z } from 'zod'
import { extname, isAbsolute } from 'node:path'
import type { Ticket, Trigger } from '../core/index.ts'
import { KV } from '../kv.ts'
import type { Store } from './store.ts'
import type { PersonalChannels, PersonalOwner } from './personal-contract.ts'
import type { IsolationTarget, PersonalIsolation } from './personal-isolation.ts'
import { tool, type Tool } from './tools/tool.ts'

export function personalTools(ticket: Ticket, store: Pick<Store, 'tickets' | 'triggers' | 'set' | 'atomic'>,
  channels: () => PersonalChannels | undefined, isolation?: () => { client: PersonalIsolation; target: IsolationTarget }): Tool[] {
  const triggerOf = (triggerId: string): Trigger => {
    const current = store.tickets.get(ticket.id)
    const reached = current && (current.origin.triggerIds.includes(triggerId)
      || current.inputs.some(input => input.kind === 'trigger' && input.triggerId === triggerId))
    const trigger = reached ? store.triggers.get(triggerId) : undefined
    if (!trigger || trigger.source !== 'personal' || trigger.actor.id !== ticket.mandate.actor.id) {
      throw new Error('该消息不属于当前任务。')
    }
    return trigger
  }
  const attachmentSource = (trigger: Trigger) => {
    const sourceSessionId = trigger.meta.sourceSessionId, ownerSessionId = trigger.meta.ownerSessionId
    if (typeof sourceSessionId !== 'string' || typeof ownerSessionId !== 'string') throw new Error('附件来源不可用。')
    const channel = channels()
    if (!channel) throw new Error('渠道附件服务不可用。')
    const owner: PersonalOwner = { key: ticket.mandate.actor.id, sessionId: ownerSessionId }
    return { channel, owner, sourceSessionId }
  }
  const asset = async (trigger: Trigger, id: string) => {
    const { channel, owner, sourceSessionId } = attachmentSource(trigger)
    if (!channel.resolveSuperagentAttachment) throw new Error('隔离附件服务不可用。')
    return channel.resolveSuperagentAttachment(owner, sourceSessionId, id)
  }
  return [tool({
    name: 'personal_read_image', description: '读取当前任务消息中真实附带的图片；先从消息中的 image_N 标记获取编号。',
    schema: z.object({ trigger_id: z.string().min(1), index: z.number().int().min(0).max(50) }).strict(),
    execute: async ({ trigger_id, index }, signal) => {
      signal.throwIfAborted()
      const trigger = triggerOf(trigger_id)
      const raw = Array.isArray(trigger.meta.imageIds) ? trigger.meta.imageIds[index] : undefined
      if (typeof raw === 'string') {
        if (!isolation) throw new Error('图片隔离服务不可用。')
        const source = await asset(trigger, raw)
        const { client, target } = isolation()
        return { trigger_id, index, image: await client.image(target, source, signal) }
      }
      const images = Array.isArray(trigger.meta.images) ? trigger.meta.images : []
      const image = images[index]
      if (!image) throw new Error('该消息没有指定图片。')
      return { trigger_id, index, image }
    },
  }), tool({
    name: 'personal_read_attachment', description: '分页读取当前任务消息中真实附带的文件的提取文本。',
    schema: z.object({ trigger_id: z.string().min(1), attachment_id: z.string().min(1),
      offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(8000).default(4000) }).strict(),
    execute: async ({ trigger_id, attachment_id, offset, limit }, signal) => {
      const trigger = triggerOf(trigger_id)
      const ids = Array.isArray(trigger.meta.attachmentIds) ? trigger.meta.attachmentIds : []
      if (!ids.includes(attachment_id)) throw new Error('该附件不属于此消息。')
      if (isolation) {
        const source = await asset(trigger, attachment_id)
        const { client, target } = isolation()
        return client.input(target, source, offset, limit, signal)
      }
      const { channel, owner, sourceSessionId } = attachmentSource(trigger)
      return channel.readSuperagentAttachment(owner, sourceSessionId, attachment_id, offset, limit, signal)
    },
  }), tool({
    name: 'personal_present_files', description: '登记当前任务目录中的 Office 或 PDF 文件，在任务结果交付时发送。',
    schema: z.object({ paths: z.array(z.string().min(1).max(1000)).min(1).max(8) }).strict(),
    execute: async ({ paths }, signal) => {
      signal.throwIfAborted()
      for (const path of paths) {
        if (isAbsolute(path) || path.includes('\\') || path.includes('\0') || path.split('/').some(part => !part || part === '.' || part === '..')
            || !['.docx', '.xlsx', '.pptx', '.pdf'].includes(extname(path).toLowerCase())) {
          throw new Error('仅可登记任务目录中的 Office 或 PDF 文件。')
        }
      }
      const files = [...new Set(paths)]
      if (isolation) {
        const { client, target } = isolation()
        if (target.mode !== 'workspace-write') throw new Error('只读任务不能登记新文件。')
        for (const path of files) {
          await client.output(ticket.id, path)
          signal.throwIfAborted()
        }
        isolation()
      }
      store.atomic(() => {
        store.set(KV.personal.files(ticket.id), files)
        store.set(KV.personal.isolatedFiles(ticket.id), !!isolation)
      })
      return { staged: paths.length }
    },
  })]
}

import type { Context } from '@deepseek-ai/cordis'
import { createHash, randomInt, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { key, latestAssignment, liveTicket, type Ticket, type Trigger } from '../core/index.ts'
import { family, KV } from '../kv.ts'
import type { PersonalChannels, PersonalInput, PersonalOwner } from '../app/personal-contract.ts'
import type { Runtime } from '../app/runtime.ts'
import type { SourceKind } from './kind.ts'

export const name = 'dsh-superagent-personal'
export const inject = ['orchestrator', 'channelSessions']
const SOURCE = 'personal'
type PersonalReceipt = { state: 'ready' | 'sending' | 'sent' | 'uncertain'; next: number; files: string[]; isolatedFiles?: boolean }
const receipt = family<PersonalReceipt>('personal-receipt:')
const explicit = /^(?:\s*)(?:帮我|帮忙|请(?:帮|你|把|将|查|写|做|整理|生成|分析|处理|制作|搜索)|麻烦(?:你|帮|查|写|做|整理|处理)|替我|给我|为我|我需要你|我想让你|我要你|查一下|查询|搜索|整理|生成|制作|写一|分析|处理)/u

export function personalTrigger(input: PersonalInput, generation: number, confirmed = false): Trigger {
  if (!input.messageId.trim()) throw new Error('缺少渠道消息 ID。')
  const images = input.message.content.flatMap(part => part.type === 'image' ? [part.attachment] : [])
  const text = input.message.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n')
  const imageIds = [...new Set(input.imageIds ?? [])]
  const body = [text, ...Array.from({ length: imageIds.length || images.length }, (_, index) => `[image_${index}]`)].filter(Boolean).join('\n')
  if (!body.trim()) throw new Error('消息没有可处理的内容。')
  const id = key(SOURCE, input.owner.key, input.messageId)
  return { id, source: SOURCE, threads: [{ source: SOURCE, id }], actor: { source: SOURCE, id: input.owner.key }, human: true,
    ...(confirmed ? { addressed: 'direct' as const } : {}), at: new Date().toISOString(), text: body,
    channel: { source: SOURCE, thread: `${SOURCE}:${input.owner.key}`, address: { ownerKey: input.owner.key, ownerSessionId: input.owner.sessionId } },
    meta: { ownerKey: input.owner.key, ownerSessionId: input.owner.sessionId, sourceSessionId: input.sessionId, messageId: input.messageId,
      generation, images, ...(imageIds.length ? { imageIds } : {}), attachmentIds: [...new Set(input.attachmentIds)], ...(confirmed ? { confirmed: true } : {}) } }
}

function confirmationDigest(owner: PersonalOwner, code: string): string {
  return createHash('sha256').update(JSON.stringify([owner.key, owner.sessionId, code])).digest('hex')
}

function ownerOf(address: Record<string, string>): PersonalOwner {
  if (!address.ownerKey || !address.ownerSessionId) throw new Error('个人渠道回复目标不完整。')
  return { key: address.ownerKey, sessionId: address.ownerSessionId }
}

export function personalKind(runtime: Runtime, channels: PersonalChannels): SourceKind {
  return {
    kind: SOURCE, title: { zh: '微信个人助手', en: 'Personal channel' },
    description: { zh: '接收已授权的个人渠道消息', en: 'Authorized personal-channel messages' },
    schema: z.object({}).strict(), fields: [], health: [],
    scope: ({ meta }) => meta.ownerKey === runtime.store.get(KV.runtime.personalOwner)?.key
      && meta.generation === (runtime.store.get(KV.runtime.personalGeneration) ?? 0)
      ? { listened: true, observed: true } : { listened: false, reason: 'personal_owner_or_generation_changed' },
    policy: { schema: z.object({ allowed: z.array(z.object({ id: z.string(), name: z.string().optional() })).default([]) }),
      fields: [], explicit: { zh: '用户明确交办的任务', en: 'An explicit request from the owner' } },
    channel: {
      allowed: address => !!address.ownerKey && !!address.ownerSessionId,
      link: () => ({ url: '', label: { zh: '微信私聊', en: 'Personal chat' } }),
      async send(_host, message) {
        const owner = ownerOf(message.channel.address)
        await channels.validateSuperagentOwner(owner)
        if (runtime.store.get(KV.runtime.personalOwner)?.key !== owner.key) throw new Error('个人渠道所有者不匹配。')
        const ticket = message.ticketId ? runtime.store.tickets.get(message.ticketId) : undefined
        const finished = ticket && (ticket.ended?.outcome === 'completed' || latestAssignment(ticket)?.report?.state === 'ready')
        const files = message.kind === 'reply' && finished ? runtime.store.get(KV.personal.files(ticket!.id)) ?? [] : []
        const isolatedFiles = !!ticket && runtime.store.get(KV.personal.isolatedFiles(ticket.id)) === true
        let saved = runtime.store.get(receipt(message.id)) ?? { state: 'ready' as const, next: 0, files, ...(isolatedFiles ? { isolatedFiles } : {}) }
        if (saved.state === 'sent') return 'sent'
        if (saved.state !== 'ready') throw new Error('上次发送结果不确定，需要人工核对后处理。')
        const characters = Array.from(message.text)
        const chunks: string[] = []
        for (let index = 0; index < characters.length; index += 1500) chunks.push(characters.slice(index, index + 1500).join(''))
        const parts = [...chunks.map(text => ({ text })), ...saved.files.map(path => ({ path }))]
        while (saved.next < parts.length) {
          const part = parts[saved.next]!
          saved = { ...saved, state: 'sending' }
          runtime.store.set(receipt(message.id), saved)
          try {
            if ('text' in part) await channels.notifySuperagentOwner(owner, part.text!)
            else {
              if (!message.ticketId) throw new Error('文件缺少所属任务。')
              if (saved.isolatedFiles) {
                const file = await runtime.personalIsolation().output(message.ticketId, part.path!)
                await channels.deliverSuperagentFile(owner, `worker-${message.ticketId}`, part.path!, file)
              } else await channels.deliverSuperagentFile(owner, `worker-${message.ticketId}`, part.path!)
            }
            saved = { ...saved, state: 'ready', next: saved.next + 1 }
            runtime.store.set(receipt(message.id), saved)
          } catch (error) {
            runtime.store.set(receipt(message.id), { ...saved, state: 'uncertain' })
            throw error
          }
        }
        runtime.store.set(receipt(message.id), { ...saved, state: 'sent' })
        return 'sent'
      },
    },
    threadContext: {
      messageId: trigger => trigger.id,
      async read(_commands, trigger) {
        const message = { id: trigger.id, from: trigger.actor.id, at: trigger.at, text: trigger.text }
        return { messages: [message], body: { messages: [message] } }
      },
      images: text => [...new Set(text.match(/\bimage_\d+\b/g) ?? [])],
      async image(_agent, _commands, trigger, _message, imageKey) {
        const index = /^image_(\d+)$/.exec(imageKey)
        const raw = index && Array.isArray(trigger.meta.imageIds) ? trigger.meta.imageIds[Number(index[1])] : undefined
        if (typeof raw === 'string' && trigger.text.includes(`[${imageKey}]`)) {
          if (!channels.resolveSuperagentAttachment || typeof trigger.meta.ownerSessionId !== 'string'
              || typeof trigger.meta.sourceSessionId !== 'string') throw new Error('图片来源不可用。')
          const asset = await channels.resolveSuperagentAttachment({ key: trigger.actor.id, sessionId: trigger.meta.ownerSessionId }, trigger.meta.sourceSessionId, raw)
          const target = { ticket: key('personal-image', trigger.id), mode: 'read-only' as const, epoch: 1 }
          const client = runtime.personalIsolation()
          const signal = AbortSignal.any([runtime.lifetime, AbortSignal.timeout(45_000)])
          try { return { source_message_id: trigger.id, image_key: imageKey, image: await client.image(target, asset, signal) } }
          finally { await client.release(target.ticket, target.epoch) }
        }
        const images = Array.isArray(trigger.meta.images) ? trigger.meta.images : []
        const image = index ? images[Number(index[1])] : undefined
        if (!image || !trigger.text.includes(`[${imageKey}]`)) throw new Error('图片不属于此消息。')
        return { source_message_id: trigger.id, image_key: imageKey, image }
      },
    },
  }
}

function owned(runtime: Runtime, owner: PersonalOwner): Ticket[] {
  return runtime.store.tickets.list().filter(ticket => ticket.mandate.actor.source === SOURCE && ticket.mandate.actor.id === owner.key)
}
function resolveTicket(runtime: Runtime, owner: PersonalOwner, prefix: string): Ticket {
  if (!/^[a-f0-9]{8,32}$/.test(prefix)) throw new Error('请提供至少 8 位任务 ID。')
  const matches = owned(runtime, owner).filter(ticket => ticket.id.startsWith(prefix))
  if (matches.length !== 1) throw new Error(matches.length ? '任务 ID 不唯一，请提供更多位。' : '未找到属于你的任务。')
  return matches[0]!
}
function describe(ticket: Ticket): string {
  const assignment = latestAssignment(ticket)
  const state = ticket.ended?.outcome ?? assignment?.report?.state ?? assignment?.state ?? 'queued'
  const summary = assignment?.report?.summary
  return `${ticket.id.slice(0, 8)} ${ticket.title} [${state}]${summary ? `\n${summary}` : ''}`
}

export function personalHandler(runtime: Runtime, channels: PersonalChannels, attached: Promise<() => void>) {
  const validate = async (owner: PersonalOwner) => {
    await attached
    await channels.validateSuperagentOwner(owner)
    await runtime.activatePersonal(owner)
  }
  return {
    isolateAttachments: runtime.machine.isolatedWorkers,
    ready: validate,
    async receive(input: PersonalInput): Promise<void> {
      await validate(input.owner)
      if (input.isCurrent && !input.isCurrent()) return
      const generation = runtime.store.get(KV.runtime.personalGeneration) ?? 0
      const trigger = personalTrigger(input, generation)
      const match = /(?:^|\s)#([a-f0-9]{8,32})(?=\s|$)/i.exec(trigger.text)
      const ticket = match ? resolveTicket(runtime, input.owner, match[1]!.toLowerCase()) : undefined
      if (explicit.test(trigger.text) || ticket?.mandate.strength === 'explicit') {
        const previous = runtime.store.get(KV.personal.confirmation(input.owner.key))
        let code: string
        do { code = String(randomInt(0, 100_000_000)).padStart(8, '0') }
        while (previous?.digest === confirmationDigest(input.owner, code))
        const now = Date.now()
        const queued = runtime.store.atomic(() => {
          if (input.isCurrent && !input.isCurrent()) return false
          for (const item of runtime.store.keys(KV.personal.confirmationSeen)) {
            if ((runtime.store.get(item) ?? 0) <= now) runtime.store.delete(item)
          }
          if (runtime.store.get(KV.personal.confirmationSeen(trigger.id))) return false
          runtime.store.set(KV.personal.confirmation(input.owner.key), {
            owner: input.owner, sessionId: input.sessionId, messageId: input.messageId, message: input.message,
            ...(input.imageIds?.length ? { imageIds: input.imageIds } : {}),
            attachmentIds: input.attachmentIds, digest: confirmationDigest(input.owner, code),
            expiresAt: now + 10 * 60_000, generation, attempts: 0,
          })
          runtime.store.set(KV.personal.confirmationSeen(trigger.id), now + 24 * 60 * 60_000)
          return true
        })
        if (!queued || input.isCurrent && !input.isCurrent()) return
        const preview = trigger.text.replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, 400)
        await channels.notifySuperagentOwner(input.owner, `待确认任务：${preview}\n请核对原消息。若由你本人交办并同意执行，10 分钟内回复 /super confirm ${code}；若是转发或不想执行，请忽略。`)
        return
      }
      runtime.store.atomic(() => {
        const received = runtime.engine.receive(trigger)
        if (received === 'stored' && ticket) runtime.engine.attach(ticket.id, trigger.id)
      })
      runtime.passes.request()
    },
    async confirm(owner: PersonalOwner, code: string, isCurrent: () => boolean): Promise<string> {
      await validate(owner)
      if (!isCurrent()) throw new Error('确认已失效，请重新发送任务。')
      if (!/^\d{8}$/.test(code)) throw new Error('用法：/super confirm <8位确认码>')
      let failure = ''
      runtime.store.atomic(() => {
        const pending = runtime.store.get(KV.personal.confirmation(owner.key))
        if (!pending || pending.owner.sessionId !== owner.sessionId || pending.sessionId !== owner.sessionId) {
          failure = '没有属于当前会话的待确认任务。'; return
        }
        if (!isCurrent() || pending.expiresAt <= Date.now()
            || pending.generation !== (runtime.store.get(KV.runtime.personalGeneration) ?? 0)) {
          runtime.store.delete(KV.personal.confirmation(owner.key))
          failure = '确认已过期或任务已停止，请重新发送。'; return
        }
        const expected = Buffer.from(pending.digest, 'hex')
        const actual = Buffer.from(confirmationDigest(owner, code), 'hex')
        if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
          const attempts = pending.attempts + 1
          if (attempts >= 5) runtime.store.delete(KV.personal.confirmation(owner.key))
          else runtime.store.set(KV.personal.confirmation(owner.key), { ...pending, attempts })
          failure = attempts >= 5 ? '确认失败次数过多，请重新发送任务。' : '确认码不正确。'
          return
        }
        const trigger = personalTrigger(pending, pending.generation, true)
        const match = /(?:^|\s)#([a-f0-9]{8,32})(?=\s|$)/i.exec(trigger.text)
        const ticket = match ? resolveTicket(runtime, owner, match[1]!.toLowerCase()) : undefined
        const received = runtime.engine.receive(trigger)
        if (received === 'stored' && ticket) runtime.engine.attach(ticket.id, trigger.id)
        runtime.store.delete(KV.personal.confirmation(owner.key))
      })
      if (failure) throw new Error(failure)
      runtime.passes.request()
      return '已确认，任务已交给 Super-agent。'
    },
    async cancelPending(owner: PersonalOwner): Promise<void> {
      const pending = runtime.store.get(KV.personal.confirmation(owner.key))
      if (pending?.owner.sessionId === owner.sessionId) runtime.store.delete(KV.personal.confirmation(owner.key))
    },
    async command(owner: PersonalOwner, name: 'tasks' | 'task', input: string): Promise<string> {
      await validate(owner)
      const args = input.trim().split(/\s+/).filter(Boolean)
      if (name === 'tasks') {
        if (args.length) throw new Error('用法：/tasks')
        const tickets = owned(runtime, owner).slice(0, 20)
        return tickets.length ? tickets.map(describe).join('\n\n') : '暂无 Super-agent 任务。'
      }
      const stopping = args[0] === 'stop'
      if (args.length !== (stopping ? 2 : 1)) throw new Error('用法：/task <ID> 或 /task stop <ID>')
      const ticket = resolveTicket(runtime, owner, (stopping ? args[1] : args[0])!.toLowerCase())
      if (!stopping) return describe(ticket)
      if (!liveTicket(ticket)) throw new Error('该任务已经结束。')
      runtime.engine.stopTicket(ticket.id, '用户停止任务')
      runtime.passes.request()
      return `已停止任务：${ticket.id.slice(0, 8)} ${ticket.title}`
    },
    async stop(owner: PersonalOwner): Promise<void> {
      await validate(owner)
      for (const thread of runtime.store.threads.active()) {
        for (const id of [...thread.pending, ...thread.evaluating?.triggerIds ?? []]) {
          const trigger = runtime.store.triggers.get(id)
          if (trigger?.source !== SOURCE || trigger.actor.id !== owner.key) continue
          try { runtime.engine.decide(id, { kind: 'ignore', reason: '用户停止任务' }) } catch { /* A worker may already own this message. */ }
        }
      }
      for (const ticket of owned(runtime, owner)) if (liveTicket(ticket)) runtime.engine.stopTicket(ticket.id, '用户停止任务')
      runtime.store.delete(KV.personal.confirmation(owner.key))
      runtime.store.set(KV.runtime.personalGeneration, (runtime.store.get(KV.runtime.personalGeneration) ?? 0) + 1)
      runtime.cancelPersonalRouter()
      runtime.passes.request()
    },
  }
}

export function apply(ctx: Context): void {
  const runtime = ctx.orchestrator as unknown as Runtime
  if (!runtime.machine.personal) throw new Error('Personal mode is not enabled')
  const channels = (ctx as unknown as { get(name: string): PersonalChannels }).get('channelSessions')
  ctx.effect(() => {
    const unregister = runtime.sources.register(personalKind(runtime, channels))
    const attached = runtime.attachPersonal(channels)
    const unhandle = channels.registerSuperagentHandler(personalHandler(runtime, channels, attached))
    void attached.catch(error => ctx.logger.error('personal channel setup failed: %s', String(error)))
    return async () => { unhandle(); (await attached.catch(() => undefined))?.(); unregister() }
  }, 'personal: source kind')
}

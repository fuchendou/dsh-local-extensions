import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { afterEach, expect, it, vi } from 'vitest'
import { startRuntime, type Host } from './fixtures/host.ts'
import type { PersonalChannels, PersonalOwner } from '../src/app/personal-contract.ts'
import { personalHandler, personalKind, personalTrigger } from '../src/sources/personal.ts'
import { KV } from '../src/kv.ts'
import { assessmentOutcome } from '../src/policy.ts'
import { personalPathAllowed } from '../src/app/sessions.ts'
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

let host: Host | undefined
afterEach(async () => { await host?.stop(); host = undefined })
const owner: PersonalOwner = { key: 'owner-1', sessionId: 'ch-owner' }
const input = (messageId: string, text: string) => ({ owner, sessionId: owner.sessionId, messageId,
  message: createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }), attachmentIds: [] })

it('marks a message explicit only after a separate confirmation', () => {
  const request = personalTrigger(input('1', '帮我整理报告'), 0)
  const forwarded = personalTrigger(input('2', 'https://example.com/news'), 0)
  expect(request.addressed).toBeUndefined()
  expect(personalTrigger(input('1', '帮我整理报告'), 0, true).addressed).toBe('direct')
  expect(forwarded.addressed).toBeUndefined()
  expect(personalTrigger(input('1', '重放'), 0).id).toBe(request.id)
  expect(request.threads[0]).not.toEqual(forwarded.threads[0])
})

it('fails a personal file tool when the isolated service fails, without dispatching the host tool', async () => {
  const call = vi.fn(async () => { throw new Error('isolated service unavailable') })
  host = await startRuntime(undefined, { personal: true, isolation: { ready: async () => 'test', call } })
  const f = host
  const sent = vi.fn(async (_owner: PersonalOwner, _text: string) => {})
  const channels: PersonalChannels = { getProtectedPaths: () => [f.runtime.machine.stateDir], validateSuperagentOwner: vi.fn(async () => {}),
    registerSuperagentSession: vi.fn(async () => {}), configureSuperagentSession: vi.fn(async () => {}), superagentWorkspace: vi.fn(async () => `${f.directory}/workspace`),
    readSuperagentAttachment: vi.fn(async () => ({})), deliverSuperagentFile: vi.fn(async () => {}),
    registerSuperagentHandler: vi.fn(() => () => {}), notifySuperagentOwner: sent }
  f.runtime.sources.register(personalKind(f.runtime, channels))
  const handler = personalHandler(f.runtime, channels, f.runtime.attachPersonal(channels))
  const request = input('isolation-failed', '帮我读取材料')
  await handler.receive(request)
  await handler.confirm(owner, /\/super confirm (\d{8})/.exec(sent.mock.calls.at(-1)![1])![1]!, () => true)
  await f.runtime.idle()
  await f.route({ kind: 'accept', trigger_id: personalTrigger(request, 0, true).id, title: '查看材料', worktree_name: 'read-material', acknowledgement: '收到。' })
  await f.runtime.idle()
  const ticket = f.runtime.store.tickets.open()[0]!
  const agent = f.agents.get(`worker-${ticket.id}`)!
  const next = vi.fn()
  const signal = new AbortController().signal
  await expect(f.ctx.waterfall('tools/execute', { agent, name: 'read', arguments: { file_path: 'fixture.txt' }, signal } as never, next))
    .rejects.toThrow('isolated service unavailable')
  expect(call).toHaveBeenCalledWith({ ticket: ticket.id, mode: 'read-only', epoch: 1 }, 'read', { file_path: 'fixture.txt' }, signal)
  expect(next).not.toHaveBeenCalled()
})

it('starts personal mode without GitHub and dispatches owned tasks in protected sessions', async () => {
  host = await startRuntime(undefined, { personal: true })
  const f = host
  const sent = vi.fn(async (_owner: PersonalOwner, _text: string) => {})
  const channels: PersonalChannels = { getProtectedPaths: () => [f.runtime.machine.stateDir], validateSuperagentOwner: vi.fn(async () => {}),
    registerSuperagentSession: vi.fn(async () => {}), configureSuperagentSession: vi.fn(async () => {}), superagentWorkspace: vi.fn(async () => `${f.directory}/workspace`),
    readSuperagentAttachment: vi.fn(async () => ({})), deliverSuperagentFile: vi.fn(async () => {}),
    registerSuperagentHandler: vi.fn(() => () => {}), notifySuperagentOwner: sent }
  const unregister = f.runtime.sources.register(personalKind(f.runtime, channels))
  const attached = f.runtime.attachPersonal(channels)
  const handler = personalHandler(f.runtime, channels, attached)
  await handler.ready(owner)
  expect(f.runtime.deployment.repository).toBe('')
  expect(f.runtime.store.settings().executor.maxWorkers).toBe(2)
  expect(channels.configureSuperagentSession).toHaveBeenCalledWith(f.runtime.masterId)
  expect(channels.registerSuperagentSession).toHaveBeenCalledWith(owner, f.runtime.masterId, 'router', undefined, false)

  let current = true
  const stale = { ...input('cancelled-during-admission', '帮我整理旧报告'), isCurrent: () => current }
  const cancelled = handler.receive(stale)
  current = false
  await cancelled
  expect(f.runtime.store.triggers.get(personalTrigger(stale, 0).id)).toBeUndefined()

  const request = { ...input('request-1', '帮我整理报告'), attachmentIds: ['asset-a'] }
  await handler.receive(request)
  expect(f.runtime.store.triggers.get(personalTrigger(request, 0).id)).toBeUndefined()
  const code = /\/super confirm (\d{8})/.exec(sent.mock.calls.at(-1)![1])![1]!
  await expect(handler.confirm(owner, 'not-a-code', () => true)).rejects.toThrow('8位确认码')
  await expect(handler.confirm({ ...owner, sessionId: 'other-session' }, code, () => true)).rejects.toThrow('当前会话')
  await expect(handler.confirm(owner, code, () => false)).rejects.toThrow('失效')
  await handler.confirm(owner, code, () => true)
  await expect(handler.confirm(owner, code, () => true)).rejects.toThrow('待确认任务')
  await f.runtime.idle()
  const trigger = personalTrigger(request, 0, true)
  await f.route({ kind: 'accept', trigger_id: trigger.id, title: '整理报告', worktree_name: 'organize-report', acknowledgement: '收到，整理报告。' })
  await f.runtime.idle()
  const tickets = f.runtime.store.tickets.open()
  expect(tickets).toHaveLength(1)
  const workspace = tickets[0]!.execution!.directory
  mkdirSync(join(workspace, 'local'), { recursive: true })
  writeFileSync(join(f.directory, 'outside.txt'), 'not part of the task')
  symlinkSync(join(f.directory, 'outside.txt'), join(workspace, 'escape.txt'))
  expect(personalPathAllowed('read', { file_path: 'local/draft.txt' }, workspace)).toBe(true)
  expect(personalPathAllowed('read', { file_path: 'escape.txt' }, workspace)).toBe(false)
  expect(personalPathAllowed('read', { file_path: 'file:///etc/passwd' }, workspace)).toBe(false)
  expect(personalPathAllowed('grep', { path: '..', pattern: 'x' }, workspace)).toBe(false)
  expect(personalPathAllowed('glob', { pattern: '../*' }, workspace)).toBe(false)
  expect(channels.registerSuperagentSession).toHaveBeenCalledWith(owner, `worker-${tickets[0]!.id}`, 'worker', tickets[0]!.id, true)
  expect(channels.configureSuperagentSession).toHaveBeenCalledWith(`worker-${tickets[0]!.id}`)
  const worker = `worker-${tickets[0]!.id}`
  expect(f.guards.get(worker)!({ name: 'todo_add', arguments: { title: '用户要求的待办' } })).toBeUndefined()
  await f.runTool(worker, 'personal_read_attachment', { trigger_id: trigger.id, attachment_id: 'asset-a' })
  expect(channels.readSuperagentAttachment).toHaveBeenCalledWith(owner, owner.sessionId, 'asset-a', 0, 4000, expect.any(AbortSignal))
  await expect(f.runTool(worker, 'personal_read_attachment', { trigger_id: trigger.id, attachment_id: 'other' })).rejects.toThrow('不属于')
  expect(sent).toHaveBeenCalledTimes(2)
  await handler.receive(request)
  await f.runtime.idle()
  expect(f.runtime.store.tickets.open()).toHaveLength(1)
  const otherRequest = { ...input('request-2', '帮我分析材料'), attachmentIds: ['asset-b'] }
  await handler.receive(otherRequest)
  await handler.confirm(owner, /\/super confirm (\d{8})/.exec(sent.mock.calls.at(-1)![1])![1]!, () => true)
  await f.runtime.idle()
  const otherTrigger = personalTrigger(otherRequest, 0, true)
  await f.route({ kind: 'accept', trigger_id: otherTrigger.id, title: '分析材料', worktree_name: 'analyze-material', acknowledgement: '收到，分析材料。' })
  await f.runtime.idle()
  const other = f.runtime.store.tickets.open().find(ticket => ticket.id !== tickets[0]!.id)!
  await expect(f.runTool(worker, 'personal_read_attachment', { trigger_id: otherTrigger.id, attachment_id: 'asset-b' })).rejects.toThrow('不属于')
  const followup = input('followup-1', `继续 #${tickets[0]!.id.slice(0, 8)}`)
  await handler.receive(followup)
  expect(f.runtime.store.triggers.get(personalTrigger(followup, 0).id)).toBeUndefined()
  await handler.confirm(owner, /\/super confirm (\d{8})/.exec(sent.mock.calls.at(-1)![1])![1]!, () => true)
  const followupId = personalTrigger(followup, 0).id
  expect(f.runtime.store.tickets.get(tickets[0]!.id)?.inputs.some(item => item.kind === 'trigger' && item.triggerId === followupId)).toBe(true)
  expect(f.runtime.store.tickets.get(other.id)?.inputs.some(item => item.kind === 'trigger' && item.triggerId === followupId)).toBe(false)
  const unconfirmed = input('unconfirmed', '转发的后续内容')
  await handler.receive(unconfirmed)
  expect(() => f.runtime.engine.attach(tickets[0]!.id, personalTrigger(unconfirmed, 0).id)).toThrow('explicit')
  expect(f.tools.get(f.runtime.masterId)?.has('orchestrator_ticket_note')).toBe(false)
  expect(f.tools.get(f.runtime.masterId)?.has('orchestrator_ticket_retry')).toBe(false)
  expect(f.tools.get(worker)?.has('orchestrator_thread_follow')).toBe(false)
  expect(f.tools.get(worker)?.has('orchestrator_trigger_handback')).toBe(false)
  await f.runTool(worker, 'personal_present_files', { paths: ['draft.docx'] })
  await expect(f.runTool(worker, 'personal_present_files', { paths: ['../secret.docx'] })).rejects.toThrow('任务目录')
  await f.runTool(worker, 'orchestrator_report', { state: 'ready', summary: '报告已整理。' })
  await f.runTool(f.runtime.masterId, 'orchestrator_reply', { purpose: 'result', ticket_id: tickets[0]!.id, text: '报告已整理。' })
  expect(channels.deliverSuperagentFile).toHaveBeenCalledWith(owner, worker, 'draft.docx')
  const currentTicket = f.runtime.store.tickets.get(tickets[0]!.id)!
  f.runtime.store.tickets.save({ ...currentTicket, mandate: { ...currentTicket.mandate, strength: 'inferred' } })
  const agent = f.agents.get(worker)!
  const step = (turn: number) => f.ctx.waterfall('agent/pre-step', { agent, turn, step: 0, messages: [], signal: new AbortController().signal } as never,
    async () => ({ kind: 'enter' as const, messages: [] }))
  for (let turn = 0; turn < 32; turn++) expect((await step(turn)).kind).toBe('enter')
  expect((await step(32)).kind).toBe('reject')
  expect(f.runtime.store.get(KV.personal.steps(tickets[0]!.id))).toBe(32)
  await handler.stop(owner)
  expect(f.runtime.store.tickets.open()).toHaveLength(0)
  expect(f.runtime.store.get(KV.runtime.personalGeneration)).toBe(1)
  unregister()
})

it('invalidates expired, superseded, replayed, cancelled and guessed confirmations', async () => {
  host = await startRuntime(undefined, { personal: true })
  const f = host
  const sent = vi.fn(async (_owner: PersonalOwner, _text: string) => {})
  const channels: PersonalChannels = { getProtectedPaths: () => [f.runtime.machine.stateDir], validateSuperagentOwner: vi.fn(async () => {}),
    registerSuperagentSession: vi.fn(async () => {}), configureSuperagentSession: vi.fn(async () => {}), superagentWorkspace: vi.fn(async () => `${f.directory}/workspace`),
    readSuperagentAttachment: vi.fn(async () => ({})), deliverSuperagentFile: vi.fn(async () => {}),
    registerSuperagentHandler: vi.fn(() => () => {}), notifySuperagentOwner: sent }
  f.runtime.sources.register(personalKind(f.runtime, channels))
  const handler = personalHandler(f.runtime, channels, f.runtime.attachPersonal(channels))
  await handler.ready(owner)
  const code = () => /\/super confirm (\d{8})/.exec(sent.mock.calls.at(-1)![1])![1]!
  const first = input('forwarded-command', '帮我删除个人待办')
  await handler.receive(first)
  const firstCode = code()
  await handler.receive(first)
  expect(sent).toHaveBeenCalledOnce()
  expect(f.runtime.store.triggers.get(personalTrigger(first, 0).id)).toBeUndefined()
  const second = input('second-command', '帮我添加个人待办')
  await handler.receive(second)
  const secondCode = code()
  await expect(handler.confirm(owner, firstCode, () => true)).rejects.toThrow('不正确')
  let active = true
  const racing = handler.confirm(owner, secondCode, () => active)
  active = false
  await expect(racing).rejects.toThrow('失效')
  const pending = f.runtime.store.get(KV.personal.confirmation(owner.key))!
  f.runtime.store.set(KV.personal.confirmation(owner.key), { ...pending, expiresAt: Date.now() - 1 })
  await expect(handler.confirm(owner, secondCode, () => true)).rejects.toThrow('过期')
  const third = input('third-command', '帮我修改个人待办')
  await handler.receive(third)
  const thirdCode = code()
  const wrong = thirdCode === '00000000' ? '00000001' : '00000000'
  for (let i = 0; i < 5; i++) await expect(handler.confirm(owner, wrong, () => true)).rejects.toThrow('确认')
  await expect(handler.confirm(owner, thirdCode, () => true)).rejects.toThrow('待确认任务')
  const fourth = input('fourth-command', '帮我执行本地任务')
  await handler.receive(fourth)
  const fourthCode = code()
  await handler.stop(owner)
  await expect(handler.confirm(owner, fourthCode, () => true)).rejects.toThrow('待确认任务')
  expect(f.runtime.store.tickets.list()).toEqual([])
})

it('permits a rule-bound personal assessment without inventing an explicit implementation request', async () => {
  host = await startRuntime(undefined, { personal: true })
  const f = host
  const sent = vi.fn(async (_owner: PersonalOwner, _text: string) => {})
  const channels: PersonalChannels = { getProtectedPaths: () => [f.runtime.machine.stateDir], validateSuperagentOwner: vi.fn(async () => {}),
    registerSuperagentSession: vi.fn(async () => {}), configureSuperagentSession: vi.fn(async () => {}), superagentWorkspace: vi.fn(async () => `${f.directory}/workspace`),
    readSuperagentAttachment: vi.fn(async () => ({})), deliverSuperagentFile: vi.fn(async () => {}),
    registerSuperagentHandler: vi.fn(() => () => {}), notifySuperagentOwner: sent }
  f.runtime.sources.register(personalKind(f.runtime, channels))
  const attached = f.runtime.attachPersonal(channels)
  await personalHandler(f.runtime, channels, attached).ready(owner)
  const assessment = { decision: 'accept' as const, title: '核验链接', scope: '核验用户提供的链接', reason: '规则匹配',
    worktree_name: 'check-link', intent_evidence: '用户提供了链接',
    direction: { implementation_requested: false, target_basis: 'existing-standard', requires_design_decision: false, evidence: '核验规则' },
    rule_assessments: [{ rule_id: 'personal-verify', matched: true, reason: '用户提供链接' },
      { rule_id: 'personal-draft', matched: false, reason: '不是资料整理' }] }
  expect(assessmentOutcome(assessment, f.runtime.store.settings(), 'inferred', true).kind).toBe('accept')
  expect(assessmentOutcome(assessment, f.runtime.store.settings(), 'inferred').kind).toBe('ignore')
})

it('runs at most one automatic worker while allowing one explicit worker', async () => {
  host = await startRuntime(undefined, { personal: true })
  const f = host
  const sent = vi.fn(async (_owner: PersonalOwner, _text: string) => {})
  const channels: PersonalChannels = { getProtectedPaths: () => [f.runtime.machine.stateDir], validateSuperagentOwner: vi.fn(async () => {}),
    registerSuperagentSession: vi.fn(async () => {}), configureSuperagentSession: vi.fn(async () => {}), superagentWorkspace: vi.fn(async () => `${f.directory}/workspace`),
    readSuperagentAttachment: vi.fn(async () => ({})), deliverSuperagentFile: vi.fn(async () => {}),
    registerSuperagentHandler: vi.fn(() => () => {}), notifySuperagentOwner: sent }
  f.runtime.sources.register(personalKind(f.runtime, channels))
  const handler = personalHandler(f.runtime, channels, f.runtime.attachPersonal(channels))
  await handler.ready(owner)
  const acceptAuto = async (messageId: string) => {
    const request = input(messageId, `https://example.com/${messageId}`)
    await handler.receive(request)
    await f.runtime.idle()
    const trigger = personalTrigger(request, 0)
    await f.runTool(f.runtime.masterId, 'orchestrator_eval', { trigger_id: trigger.id })
    const result = await f.runTool(f.runtime.masterId, 'orchestrator_eval_decide', { trigger_id: trigger.id, decision: 'accept',
      title: '核验链接', worktree_name: 'check-link', scope: '核验所给链接', reason: '符合核验规则', intent_evidence: '用户发送链接',
      direction: { implementation_requested: false, target_basis: 'existing-standard', requires_design_decision: false, evidence: '核验规则' },
      rule_assessments: [{ rule_id: 'personal-verify', matched: true, reason: '链接核验' },
        { rule_id: 'personal-draft', matched: false, reason: '不是资料整理' }] })
    await f.runtime.idle()
    return (result.ticket as { ticket_id: string }).ticket_id
  }
  const first = await acceptAuto('auto-one')
  const second = await acceptAuto('auto-two')
  expect(f.agents.has(`worker-${first}`)).toBe(true)
  expect(f.agents.has(`worker-${second}`)).toBe(false)
  const guard = f.guards.get(`worker-${first}`)!
  expect(guard({ name: 'bash', arguments: { command: 'true' } })).toContain('not authorized')
  expect(guard({ name: 'todo_write', arguments: {} })).toContain('not authorized')
  expect(guard({ name: 'todo_add', arguments: { title: '不得擅自添加' } })).toContain('not authorized')
  expect(guard({ name: 'read', arguments: { file_path: '/etc/passwd' } })).toContain('workspace')
  expect(guard({ name: 'web_fetch', arguments: { url: 'https://example.com/' } })).toBeUndefined()
  const direct = input('direct', '帮我整理报告')
  await handler.receive(direct)
  await handler.confirm(owner, /\/super confirm (\d{8})/.exec(sent.mock.calls.at(-1)![1])![1]!, () => true)
  await f.runtime.idle()
  const directTrigger = personalTrigger(direct, 0, true)
  await f.route({ kind: 'accept', trigger_id: directTrigger.id, title: '整理报告', worktree_name: 'prepare-report', acknowledgement: '收到，整理报告。' })
  await f.runtime.idle()
  expect(f.runtime.store.tickets.open().filter(ticket => f.agents.has(`worker-${ticket.id}`))).toHaveLength(2)
  f.runtime.store.set(KV.personal.startedAt(first), Date.now() - 15 * 60_000)
  const timedOut = await f.ctx.waterfall('agent/pre-step', { agent: f.agents.get(`worker-${first}`)!, turn: 2, step: 0,
    messages: [], signal: new AbortController().signal } as never, async () => ({ kind: 'enter' as const, messages: [] }))
  expect(timedOut.kind).toBe('reject')
  await handler.stop(owner)
})

it('does not retry an outbound message whose delivery result is uncertain', async () => {
  host = await startRuntime(undefined, { personal: true })
  const f = host
  const sent = vi.fn(async () => { throw new Error('connection lost') })
  const channels: PersonalChannels = { getProtectedPaths: () => [f.runtime.machine.stateDir], validateSuperagentOwner: vi.fn(async () => {}),
    registerSuperagentSession: vi.fn(async () => {}), configureSuperagentSession: vi.fn(async () => {}), superagentWorkspace: vi.fn(async () => `${f.directory}/workspace`),
    readSuperagentAttachment: vi.fn(async () => ({})), deliverSuperagentFile: vi.fn(async () => {}),
    registerSuperagentHandler: vi.fn(() => () => {}), notifySuperagentOwner: sent }
  const kind = personalKind(f.runtime, channels)
  f.runtime.sources.register(kind)
  const attached = f.runtime.attachPersonal(channels)
  await personalHandler(f.runtime, channels, attached).ready(owner)
  const message = { id: 'reply-1', channel: { source: 'personal', thread: 'personal:owner-1',
    address: { ownerKey: owner.key, ownerSessionId: owner.sessionId } }, text: '结果', kind: 'reply' as const }
  await expect(kind.channel!.send({ commands: f.runtime.commands }, message)).rejects.toThrow('connection lost')
  await expect(kind.channel!.send({ commands: f.runtime.commands }, message)).rejects.toThrow('结果不确定')
  expect(sent).toHaveBeenCalledOnce()
})

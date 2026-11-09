import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { DEFAULT_TICK_MS, TodoService, type TodoServiceConfig } from './service.js'
import { makeTodoRoutes } from './routes.js'
import { makeTodoTools } from './tools.js'
import { todoHomeDir } from './store.js'

export interface ChannelOwner { key: string; sessionId: string }
interface AgentLike { id: unknown }
interface ChannelSessions {
  ownerForAgent(agent: AgentLike): Promise<ChannelOwner>
  assertWritable(agent: AgentLike): void
  getSessionEntry(id: string): unknown
  singleOwner(): Promise<ChannelOwner>
  listOwners(): Promise<ChannelOwner[]>
  notifyOwner(owner: ChannelOwner, text: string): Promise<void>
}
interface Connection {
  admit(req: IncomingMessage): { rejection: 401 | 403 } | { peer: { principal: { kind: string } } }
}
export interface TodoHostContext {
  webServer: { register(route: { kind: 'exact' | 'prefix'; path: string; handler: unknown }): () => void }
  interval(callback: () => void, ms: number): () => void
  effect(fn: () => (() => void) | void, label?: string): () => void
  provide(name: string, value: unknown): unknown
  tools: { register(definition: unknown): () => void }
  channelSessions: ChannelSessions
  connection: Connection
  systemPrompt?: { section(opts: { name: string; order: number; text: string }): () => void }
}

export const name = 'todo-reminder'
export const inject = ['webServer', 'timer', 'tools', 'systemPrompt', 'channelSessions', 'connection']
export const TODO_GUIDANCE = '已启用个人待办工具。只有用户要求或本人已开启的每日早报订阅才允许读取待办；修改仍须用户要求，不把待办当作聊天历史。用户要求提醒时使用 personal_reminder，先用 clock 获取北京时间，再创建或管理提醒。提醒到点只发送通知，不执行任务。用户要求每天主动生成待办与资讯时使用 personal_briefing，不能用普通提醒冒充自动生成。'

export function ownerAdmission(connection: Connection | undefined, req: IncomingMessage): 200 | 401 | 403 | 503 {
  if (!connection || typeof connection.admit !== 'function') return 503
  try {
    const result = connection.admit(req)
    if ('rejection' in result) return result.rejection === 401 ? 401 : 403
    return result.peer?.principal?.kind === 'owner' ? 200 : 403
  } catch { return 503 }
}

export function createTodoRuntime(ctx: TodoHostContext) {
  const stores = new Map<string, TodoService>()
  const getForOwner = (owner: ChannelOwner): TodoService => {
    if (!/^[0-9a-f]{64}$/.test(owner.key) || !owner.sessionId) throw new Error('无效的所有者。')
    let store = stores.get(owner.key)
    if (!store) {
      store = new TodoService(join(todoHomeDir(), 'todo-reminder', 'owners', `${owner.key}.json`))
      stores.set(owner.key, store)
    }
    store.setOriginSession(owner.sessionId)
    return store
  }
  const ownerForAgent = async (agent: AgentLike): Promise<ChannelOwner> => {
    if (!agent || !agent.id) throw new Error('无法确认待办所有者。')
    if (ctx.channelSessions.getSessionEntry(String(agent.id))) return ctx.channelSessions.ownerForAgent(agent)
    if (String(agent.id).startsWith('ch-')) throw new Error('渠道会话未登记。')
    return ctx.channelSessions.singleOwner()
  }
  const forAgent = async (agent: AgentLike) => {
    const owner = await ownerForAgent(agent)
    return { owner, store: getForOwner(owner) }
  }
  let working = false
  const tick = async (): Promise<void> => {
    if (working) return
    working = true
    try {
      for (const owner of await ctx.channelSessions.listOwners()) {
        const store = getForOwner(owner)
        store.tick(Date.now())
        for (const event of store.pendingDeliveries()) {
          try {
            await ctx.channelSessions.notifyOwner({ key: owner.key, sessionId: event.originSessionId! }, `【提醒】${event.title}`)
            store.confirmDelivery(event.id)
          } catch (error) {
            console.warn('[dsh-todo-reminder] notification pending:', error instanceof Error ? error.message : String(error))
          }
        }
      }
    } finally { working = false }
  }
  return { getForOwner, forAgent, tick }
}

export function apply(ctx: TodoHostContext, config: TodoServiceConfig = {}): void {
  const runtime = createTodoRuntime(ctx)
  ctx.provide('personalTodos', runtime)

  ctx.effect(() => {
    const routeTemplates = makeTodoRoutes({} as TodoService)
    const disposers = routeTemplates.map((template) => ctx.webServer.register({
      kind: template.kind,
      path: template.path,
      async handler(req: IncomingMessage, res: ServerResponse) {
        const admission = ownerAdmission(ctx.connection, req)
        if (admission !== 200) { res.writeHead(admission); res.end(); return }
        if (req.method !== 'GET' && req.method !== 'HEAD' && !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '')) {
          res.writeHead(403); res.end(); return
        }
        if (req.method === 'POST' && !/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) {
          res.writeHead(415); res.end(); return
        }
        if (template.path.endsWith('/open-dir')) { res.writeHead(403); res.end(); return }
        try {
          const owner = await ctx.channelSessions.singleOwner()
          const route = makeTodoRoutes(runtime.getForOwner(owner)).find((entry) => entry.path === template.path)
          if (!route) { res.writeHead(404); res.end(); return }
          await route.handler(req, res)
        } catch { res.writeHead(503); res.end('待办服务不可用或所有者不唯一。') }
      },
    }))
    return () => { for (const dispose of disposers) dispose() }
  }, 'todo-reminder: authenticated routes')

  ctx.effect(() => {
    const templates = makeTodoTools({} as TodoService)
    const disposers = templates.map((template) => ctx.tools.register({
      ...template,
      async execute(args: Record<string, unknown>, exec: { agent?: AgentLike }) {
        if (!exec.agent) throw new Error('无法确认待办所有者。')
        const { store } = await runtime.forAgent(exec.agent)
        if (template.name !== 'todo_list') ctx.channelSessions.assertWritable(exec.agent)
        const tool = makeTodoTools(store).find((entry) => entry.name === template.name)
        if (!tool) throw new Error('待办工具不可用。')
        return tool.execute(args)
      },
    }))
    return () => { for (const dispose of disposers) dispose() }
  }, 'todo-reminder: owned tools')

  ctx.interval(() => { void runtime.tick().catch((error) => console.error('[dsh-todo-reminder] tick failed:', error)) }, config.tickMs ?? DEFAULT_TICK_MS)
  ctx.effect(() => ctx.systemPrompt?.section({ name: 'plugin:todo-reminder', order: 201, text: TODO_GUIDANCE }), 'todo-reminder: guidance')
}

export { TodoService } from './service.js'
export type { TodoServiceConfig } from './service.js'
export type { ReminderEvent, ReminderStyle, TodoAddInput, TodoItem, TodoPatch, TodoSettings, TodoState } from './types.js'

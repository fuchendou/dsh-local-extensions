import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { OfficeFeatureId } from '../features'
import type { AnnotationController, AnnotationInjected, PendingAnnotation } from './types'
import { rankByName } from '@deepseek-ai/dsh-client-ui-primitives'
import { featureByCommand, featureById, OFFICE_FEATURES } from '../features'
import { annotationRule } from './annotation'
import { AnnotationReference } from './annotation-reference'
import { ANNOTATION_ID, ANNOTATION_NODE, ANNOTATION_ORDER, ANNOTATION_PRIORITY, ANNOTATION_SLOT, FILE_ADDRESS_PREFIX, OFFICE_CHIP, OFFICE_CHIP_SLOT, OFFICE_NS, OFFICE_SOURCE } from './constants'
import { DocumentAnnotation } from './document-annotation'
import { OFFICE_ICONS } from './icons'
import { officeChipRule, serializeOfficeCommand } from './office-chip'
import { OfficeReference } from './office-reference'
import { mountOfficeStyles } from './styles'

/** Client services used by this half. */
export const inject = [
  'inputTriggers',
  'sessions',
  'slots',
  'locale',
  'remote',
  'remote.skills',
  'sidebarRight',
  'uiConversation',
  'conversation',
]

const zh = {
  'menu.group': '办公',
  'menu.documents.label': '文档',
  'menu.documents.description': '创建、读取、编辑和渲染 DOCX 文档',
  'menu.pdf.label': 'PDF 文档',
  'menu.pdf.description': '读取、创建、检查、渲染和验证 PDF',
  'menu.presentations.label': '演示文稿',
  'menu.presentations.description': '创建、编辑、渲染和导出 PPTX 演示文稿',
  'menu.spreadsheets.label': '电子表格',
  'menu.spreadsheets.description': '创建、编辑、计算和导出 XLSX 电子表格',
  'annotation.ask': '请求修改',
  'annotation.cancel': '取消',
  'annotation.send': '发送',
  'annotation.add': '添加标注',
  'annotation.placeholder': '说明要怎么改…',
  'annotation.page': '第 {page} 页',
  'annotation.count': '{count} 条注释',
  'annotation.remove': '删除第 {index} 条注释',
  'annotation.image': '位置截图：{name}',
  'annotation.help': '悬停吸附段落，点击输入要求；长按拖动框选区域，松开添加标注。方向键选择，Enter 确认，Esc 退出。',
  'annotation.unavailable': '等待文档页面渲染；当前预览不支持标注',
  'annotation.capturing': '正在截图…',
  'annotation.captureFailed': '截图失败，请重新选择区域',
  'annotation.intakeUnavailable': '当前 DSH 版本不支持从侧栏添加截图附件，PDF 与表格标注已禁用',
  'annotation.imageLimit': '截图超过当前模型的数量或大小限制，请减少标注后重试',
  'annotation.sendFailed': '未能加入会话，请重试；标注仍保留',
  'annotation.draftReady': '标注和截图已保留在会话输入框，请在那里确认发送',
  'annotation.invalid': '标注内容无效，请重新添加',
  'annotation.tooLarge': '标注内容过长，请减少后重试',
  'annotation.emptyPage': '页面尚未渲染，请重试',
  'annotation.emptyRegion': '请选择页面内的区域',
} as const

const en: Record<keyof typeof zh, string> = {
  'menu.group': 'Office',
  'menu.documents.label': 'Documents',
  'menu.documents.description': 'Create, read, edit, and render DOCX documents',
  'menu.pdf.label': 'PDF documents',
  'menu.pdf.description': 'Read, create, inspect, render, and verify PDFs',
  'menu.presentations.label': 'Presentations',
  'menu.presentations.description': 'Create, edit, render, and export PPTX decks',
  'menu.spreadsheets.label': 'Spreadsheets',
  'menu.spreadsheets.description': 'Create, edit, calculate, and export XLSX workbooks',
  'annotation.ask': 'Request changes',
  'annotation.cancel': 'Cancel',
  'annotation.send': 'Send',
  'annotation.add': 'Add annotation',
  'annotation.placeholder': 'Describe the change…',
  'annotation.page': 'page {page}',
  'annotation.count': '{count} annotations',
  'annotation.remove': 'Remove annotation {index}',
  'annotation.image': 'Location screenshot: {name}',
  'annotation.help': 'Hover to select a paragraph; click to comment. Hold and drag to select a region. Arrow keys select, Enter confirms, Esc exits.',
  'annotation.unavailable': 'Waiting for rendered pages; this preview cannot be annotated yet',
  'annotation.capturing': 'Capturing…',
  'annotation.captureFailed': 'Screenshot failed; please select the region again',
  'annotation.intakeUnavailable': 'This DSH version cannot add screenshots from the sidebar; PDF and spreadsheet annotation is disabled',
  'annotation.imageLimit': 'Screenshots exceed the current model’s count or size limits; remove some annotations and retry',
  'annotation.sendFailed': 'Could not add annotations to the conversation; your annotations are retained',
  'annotation.draftReady': 'Annotations and screenshots are kept in the conversation input; confirm sending there',
  'annotation.invalid': 'Invalid annotation; please add it again',
  'annotation.tooLarge': 'Annotations are too long; remove some and retry',
  'annotation.emptyPage': 'The page has not rendered yet; please retry',
  'annotation.emptyRegion': 'Select a region inside the page',
}

interface OfficeSkillSummary {
  readonly name: string
  readonly path?: string
}

interface CatalogEntry {
  readonly abort: AbortController
  readonly promise: Promise<readonly OfficeSkillSummary[]>
  settled?: readonly OfficeSkillSummary[]
}

function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/%3A/gi, ':')
}

function encodePath(path: string): string {
  return path.split('/').map(encodeSegment).join('/')
}

function sessionFileAddress(sessionId: string, path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/^(?:\.\/)+/u, '')
  return `${FILE_ADDRESS_PREFIX}session/${encodeSegment(sessionId)}/${encodePath(normalized)}`
}

function fileAddressFor(sessionId: string, cwd: string | undefined, path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const root = cwd?.replace(/\\/g, '/').replace(/\/+$/u, '') ?? ''
  if (!/^(?:\/|[A-Za-z]:\/|\\\\)/u.test(normalized))
    return sessionFileAddress(sessionId, normalized)
  if (root !== '' && normalized.startsWith(`${root}/`))
    return sessionFileAddress(sessionId, normalized.slice(root.length + 1))
  return sessionFileAddress(sessionId, normalized)
}

interface OfficeSkillCatalog {
  list: (input: { sessionId: string }, signal?: AbortSignal) => Promise<
    | { ok: true, value: { skills: readonly OfficeSkillSummary[] } }
    | { ok: false, error: { code: string, message: string } }
  >
}

interface OfficeSessionReference {
  readonly binding: {
    readonly session: {
      getSnapshot: () => { openState: string, openError?: Error }
    }
  }
}

/**
 * The small public Session face this client needs. The installed DSH assembly
 * also ships a host `dsh-session` augmentation that widens `ctx.sessions` with
 * an incompatible `SessionStore`, so narrow through the documented client face.
 */
interface OfficeSessions {
  binding: (sessionId: string) => unknown
  using: <T>(
    sessionId: string,
    options: { source: string, signal: AbortSignal },
    fn: (reference: OfficeSessionReference) => Promise<T>,
  ) => Promise<T>
  list: {
    getSnapshot: () => { byId: Record<string, { cwd?: string } | undefined> }
  }
}

/** Register the `/` source, transcript chip, and right-sidebar preview. */
export function apply(ctx: ClientContext): void {
  const sessions = ctx.sessions as unknown as OfficeSessions
  const remoteSkills = (ctx.remote as unknown as { skills: OfficeSkillCatalog }).skills
  const t = ctx.locale.bind(OFFICE_NS)
  const entries = new Map<string, CatalogEntry>()
  const pendingAnnotations = new Map<string, Map<string, readonly PendingAnnotation[]>>()

  ctx.effect(() => mountOfficeStyles(), 'office-suite: styles')
  ctx.effect(() => ctx.locale.register(OFFICE_NS, { zh, en }), 'office-suite: dictionaries')

  function catalogFor(sessionId: string): CatalogEntry {
    const existing = entries.get(sessionId)
    if (existing !== undefined)
      return existing

    const abort = new AbortController()
    const promise = (async () => {
      if (sessions.binding(sessionId) === undefined)
        throw new Error(`office catalog requires a retained session "${sessionId}"`)
      return sessions.using(sessionId, { source: 'officeCatalog', signal: abort.signal }, async (reference) => {
        abort.signal.throwIfAborted()
        const state = reference.binding.session.getSnapshot()
        if (state.openState !== 'open')
          throw state.openError ?? new Error(`session "${sessionId}" is not open`)
        const result = await remoteSkills.list({ sessionId }, abort.signal)
        abort.signal.throwIfAborted()
        if (!result.ok)
          throw new Error(`skills/list failed: ${result.error.code}: ${result.error.message}`)
        return result.value.skills
      })
    })()

    const entry: CatalogEntry = { abort, promise }
    entries.set(sessionId, entry)
    promise.then((skills) => {
      entry.settled = skills
    }, () => {
      if (entries.get(sessionId) === entry)
        entries.delete(sessionId)
    })
    return entry
  }

  function openSkill(sessionId: string, feature: OfficeFeatureId, catalog: readonly OfficeSkillSummary[]): boolean {
    const definition = featureById(feature)
    if (definition === undefined)
      return false
    const skill = catalog.find(item => item.name === definition.skill)
    if (skill?.path === undefined)
      return false
    const cwd = sessions.list.getSnapshot().byId[sessionId]?.cwd
    try {
      ctx.sidebarRight.openResource(fileAddressFor(sessionId, cwd, skill.path))
      return true
    }
    catch (error) {
      console.error('[dsh-office-kit] reference preview failed:', error)
      return false
    }
  }

  const source: InputTriggerSource = {
    trigger: '/',
    name: OFFICE_SOURCE,
    order: 1,
    async candidates(_session, { query, signal }) {
      if (signal.aborted)
        return []
      const items = OFFICE_FEATURES.map((feature) => {
        const Icon = OFFICE_ICONS[feature.id]
        return {
          name: feature.command,
          label: t(`menu.${feature.id}.label`),
          description: t(`menu.${feature.id}.description`),
          section: t('menu.group'),
          icon: Icon,
        }
      })
      return query.length === 0 ? items : rankByName(items, query)
    },
    lexicon() {
      return OFFICE_FEATURES.map(feature => feature.command)
    },
    openReference(session, { ref }) {
      const feature = featureById(ref)
      if (feature === undefined)
        return false

      const settled = entries.get(session.sessionId)?.settled
      if (settled !== undefined)
        return openSkill(session.sessionId, feature.id, settled)

      const entry = catalogFor(session.sessionId)
      entry.promise.then((catalog) => {
        if (!entry.abort.signal.aborted)
          openSkill(session.sessionId, feature.id, catalog)
      }).catch((error) => {
        if (!entry.abort.signal.aborted)
          console.error('[dsh-office-kit] reference preview failed:', error)
      })
      return true
    },
    onPick({ candidate }) {
      const feature = featureByCommand(candidate.name)
      if (feature === undefined)
        return undefined
      return {
        insert: {
          source: OFFICE_SOURCE,
          ref: feature.id,
          label: t(`menu.${feature.id}.label`),
          appearance: 'file',
          clipboardText: `/${feature.command}`,
        },
      }
    },
    codec: {
      clipboardText(ref) {
        const feature = featureById(ref)
        return feature === undefined ? `/${ref}` : `/${feature.command}`
      },
      async serialize(ref) {
        const feature = featureById(ref)
        if (feature === undefined)
          return '/documents'
        return serializeOfficeCommand(feature)
      },
    },
  }

  ctx.effect(() => ctx.uiConversation.userText.register(officeChipRule), 'office-suite: transcript chip')

  ctx.effect(() => ctx.slots.inject(OFFICE_CHIP_SLOT, () => ctx.slots.register({
    name: OFFICE_CHIP_SLOT,
    key: OFFICE_CHIP,
    priority: 100,
    inject: (sessionId: string) => ({
      openOffice: (feature: OfficeFeatureId) => {
        source.openReference?.({ sessionId: sessionId as never }, { ref: feature, appearance: 'file' })
      },
      officeLabel: (feature: OfficeFeatureId) => t(`menu.${feature}.label`),
    }),
  }, OfficeReference)), 'office-suite: transcript chip slot')

  function annotationDependencies(sessionId: string): AnnotationInjected {
    const controller = ctx.conversation as unknown as Partial<AnnotationController>
    const compatible = typeof controller.createDrafts === 'function'
      && typeof controller.releaseDraftAttachments === 'function'
      && typeof controller.resolveDraftAttachments === 'function'
    let pending = pendingAnnotations.get(sessionId)
    if (!pending) {
      pending = new Map()
      pendingAnnotations.set(sessionId, pending)
    }
    return {
      pendingAnnotations: pending,
      // ponytail: current DSH concrete File intake only, replace with outward intake API when exported.
      intake: compatible
        ? {
            create: files => controller.createDrafts!(sessionId as never, files),
            release: drafts => controller.releaseDraftAttachments!(drafts),
            images: ids => controller.resolveDraftAttachments!(ids).filter(item => item.kind === 'image').map(item => item.file),
          }
        : undefined,
      openAnnotation: (target) => {
        try {
          const cwd = sessions.list.getSnapshot().byId[sessionId]?.cwd
          ctx.sidebarRight.openResource(fileAddressFor(sessionId, cwd, target))
        }
        catch (error) {
          console.error('[dsh-office-kit] annotation preview failed:', error)
        }
      },
    }
  }

  ctx.effect(() => ctx.uiConversation.userText.register(annotationRule), 'office-suite: annotations')
  ctx.effect(() => ctx.slots.inject(OFFICE_CHIP_SLOT, () => ctx.slots.register({
    name: OFFICE_CHIP_SLOT,
    key: ANNOTATION_NODE,
    priority: ANNOTATION_PRIORITY,
    locale: OFFICE_NS,
    inject: annotationDependencies,
  }, AnnotationReference)), 'office-suite: annotation references')
  ctx.effect(() => ctx.slots.inject(ANNOTATION_SLOT, () => ctx.slots.register({
    name: ANNOTATION_SLOT,
    id: ANNOTATION_ID,
    order: ANNOTATION_ORDER,
    locale: OFFICE_NS,
    inject: annotationDependencies,
  }, DocumentAnnotation)), 'office-suite: annotation tool')

  const inputTriggers = ctx.inputTriggers
  ctx.effect(() => {
    const unregister = inputTriggers.registerSource(source)
    return () => {
      unregister()
      for (const entry of entries.values())
        entry.abort.abort()
      entries.clear()
      pendingAnnotations.clear()
    }
  }, 'office-suite: slash source')
}

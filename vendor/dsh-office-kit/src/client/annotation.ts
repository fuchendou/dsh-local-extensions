import type { UserTextRule } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { AnnotationParagraph, AnnotationRect, AnnotationSelection, AnnotationSendInput, AnnotationTextRun, OfficeAnnotation } from './types'
import { ANNOTATION_CANVAS_SELECTOR, ANNOTATION_CLOSE, ANNOTATION_HIT_X, ANNOTATION_HIT_Y, ANNOTATION_MAX_ITEMS, ANNOTATION_MAX_PAYLOAD, ANNOTATION_MAX_PIXELS, ANNOTATION_MAX_TEXT, ANNOTATION_NODE, ANNOTATION_OPEN, ANNOTATION_PADDING, ANNOTATION_SPREADSHEET_CANVAS_SELECTOR } from './constants'
import { normalizeSelection } from './quote'

export function unionRect(a: AnnotationRect, b: AnnotationRect): AnnotationRect {
  const left = Math.min(a.left, b.left)
  const top = Math.min(a.top, b.top)
  return { left, top, width: Math.max(a.left + a.width, b.left + b.width) - left, height: Math.max(a.top + a.height, b.top + b.height) - top }
}

export function intersectRect(a: AnnotationRect, b: AnnotationRect): AnnotationRect | undefined {
  const left = Math.max(a.left, b.left)
  const top = Math.max(a.top, b.top)
  const width = Math.min(a.left + a.width, b.left + b.width) - left
  const height = Math.min(a.top + a.height, b.top + b.height) - top
  return width > 0 && height > 0 ? { left, top, width, height } : undefined
}

/** Leave breathing room around text/regions without extending outside the painted page. */
export function paddedRect(box: AnnotationRect, page: AnnotationRect): AnnotationRect | undefined {
  return intersectRect({ left: box.left - ANNOTATION_PADDING, top: box.top - ANNOTATION_PADDING, width: box.width + ANNOTATION_PADDING * 2, height: box.height + ANNOTATION_PADDING * 2 }, page)
}

export function containsPoint(box: AnnotationRect, x: number, y: number): boolean {
  return x >= box.left && x <= box.left + box.width && y >= box.top && y <= box.top + box.height
}

/** Viewport coordinates for a native top-layer popover, independent of chat clipping ancestors. */
export function annotationPopoverPosition(anchor: AnnotationRect, popup: Pick<AnnotationRect, 'width' | 'height'>, viewport: Pick<AnnotationRect, 'width' | 'height'>): Pick<AnnotationRect, 'left' | 'top'> {
  return {
    left: Math.max(8, Math.min(anchor.left, viewport.width - popup.width - 8)),
    top: Math.max(8, Math.min(anchor.top >= popup.height + 8 ? anchor.top - popup.height : anchor.top + anchor.height, viewport.height - popup.height - 8)),
  }
}

/** Small hit slop bridges text edges without expanding the displayed paragraph outline. */
export function paragraphAtPoint(paragraphs: readonly AnnotationParagraph[], x: number, y: number): AnnotationParagraph | undefined {
  let hit: AnnotationParagraph | undefined
  for (const paragraph of paragraphs) {
    const box = paragraph.box
    if ((paragraph.rects ?? [box]).some(rect => x >= rect.left - ANNOTATION_HIT_X && x <= rect.left + rect.width + ANNOTATION_HIT_X
      && y >= rect.top - ANNOTATION_HIT_Y && y <= rect.top + rect.height + ANNOTATION_HIT_Y)
    && (!hit || box.width * box.height < hit.box.width * hit.box.height)) {
      hit = paragraph
    }
  }
  return hit
}

/** PDF text is positioned, not semantic: recover lines, then separate columns and paragraph gaps. */
export function groupParagraphs(runs: readonly AnnotationTextRun[]): AnnotationParagraph[] {
  const lines: { text: string, box: AnnotationRect, rects: AnnotationRect[] }[] = []
  for (const run of [...runs].sort((a, b) => a.box.top - b.box.top || a.box.left - b.box.left)) {
    if (!run.text.trim() || run.box.width <= 0 || run.box.height <= 0)
      continue
    const line = lines.find(item => Math.abs(item.box.top - run.box.top) < Math.min(item.box.height, run.box.height) * 0.45
      && run.box.left >= item.box.left && run.box.left - (item.box.left + item.box.width) < run.box.height * 2)
    if (line) {
      line.text += ` ${run.text}`
      line.box = unionRect(line.box, run.box)
      line.rects.push(run.box)
    }
    else {
      lines.push({ text: run.text, box: run.box, rects: [run.box] })
    }
  }
  const paragraphs: { text: string, box: AnnotationRect, rects: AnnotationRect[], last: AnnotationRect }[] = []
  for (const line of lines) {
    const paragraph = paragraphs.findLast((item) => {
      const gap = line.box.top - (item.last.top + item.last.height)
      const overlap = Math.min(item.last.left + item.last.width, line.box.left + line.box.width) - Math.max(item.last.left, line.box.left)
      return gap >= -line.box.height * 0.2 && gap <= Math.min(item.last.height, line.box.height) * 0.7
        && overlap > 0 && Math.abs(item.last.left - line.box.left) < line.box.height * 2
        && Math.max(item.last.height, line.box.height) / Math.min(item.last.height, line.box.height) < 1.4
    })
    if (paragraph) {
      paragraph.text += `\n${line.text}`
      paragraph.box = unionRect(paragraph.box, line.box)
      paragraph.rects.push(...line.rects)
      paragraph.last = line.box
    }
    else {
      paragraphs.push({ ...line, last: line.box })
    }
  }
  return paragraphs.map(({ text, box, rects }) => ({ text: normalizeSelection(text), box, rects }))
}

/** Read only the accessible page canvas's sibling text layer, without private PDF.js state. */
export function canvasParagraphs(canvas: HTMLCanvasElement): AnnotationParagraph[] {
  const surface = canvas.parentElement
  if (!surface)
    return []
  const walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT)
  const runs: AnnotationTextRun[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent?.trim())
      continue
    const range = document.createRange()
    range.selectNodeContents(node)
    const box = range.getBoundingClientRect()
    if (box.width > 0 && box.height > 0)
      runs.push({ text: node.textContent, box: { left: box.left, top: box.top, width: box.width, height: box.height } })
  }
  // ponytail: visual paragraphs in PDF/Office previews, replace with a public paragraph API when provided.
  return groupParagraphs(runs)
}

/** Slot outlets are display:contents wrappers, not the document header itself. */
export function annotationPreview(anchor: HTMLElement): { header: HTMLElement, root: HTMLElement } | undefined {
  let header = anchor.parentElement
  while (header && getComputedStyle(header).display === 'contents')
    header = header.parentElement
  return header?.parentElement ? { header, root: header.parentElement } : undefined
}

export function canvasAt(preview: HTMLElement, x: number, y: number): { canvas: HTMLCanvasElement, page: number } | undefined {
  const canvases = [...preview.querySelectorAll<HTMLCanvasElement>(ANNOTATION_CANVAS_SELECTOR)]
  const index = canvases.findIndex(canvas => containsPoint(canvas.getBoundingClientRect(), x, y) && canvas.getBoundingClientRect().width > 0)
  return index < 0 ? undefined : { canvas: canvases[index]!, page: index + 1 }
}

/** A workbook is one unpaged grid canvas: it locates pixels, never a page number. */
export function spreadsheetAt(preview: HTMLElement, x: number, y: number): { canvas: HTMLCanvasElement } | undefined {
  const canvas = [...preview.querySelectorAll<HTMLCanvasElement>(ANNOTATION_SPREADSHEET_CANVAS_SELECTOR)].find(item => containsPoint(item.getBoundingClientRect(), x, y) && item.getBoundingClientRect().width > 0)
  return canvas ? { canvas } : undefined
}

export function normalizedRegion(box: AnnotationRect, page: AnnotationRect): AnnotationRect {
  if (page.width <= 0 || page.height <= 0)
    throw new Error('annotation.emptyPage')
  const clipped = intersectRect(box, page)
  if (!clipped)
    throw new Error('annotation.emptyRegion')
  return { left: (clipped.left - page.left) / page.width, top: (clipped.top - page.top) / page.height, width: clipped.width / page.width, height: clipped.height / page.height }
}

/** Copy the selected pixels now, before a zoom, rerender, or tab switch can change the page. */
export async function captureAnnotation(selection: AnnotationSelection, name: string, pixelLimit = ANNOTATION_MAX_PIXELS, dimensionLimit = Infinity): Promise<File> {
  const canvas = selection.canvas
  if (!canvas || canvas.width <= 0 || canvas.height <= 0)
    throw new Error('annotation.captureFailed')
  const painted = canvas.getBoundingClientRect()
  const region = selection.region ?? normalizedRegion(selection.box, painted)
  const width = canvas.width * region.width
  const height = canvas.height * region.height
  const scale = Math.min(1, Math.sqrt(pixelLimit / (width * height)), dimensionLimit / width, dimensionLimit / height)
  if (!Number.isFinite(scale) || scale <= 0)
    throw new Error('annotation.captureFailed')
  const output = document.createElement('canvas')
  output.width = Math.max(1, Math.floor(width * scale))
  output.height = Math.max(1, Math.floor(height * scale))
  const context = output.getContext('2d')
  if (!context)
    throw new Error('annotation.captureFailed')
  context.drawImage(canvas, region.left * canvas.width, region.top * canvas.height, width, height, 0, 0, output.width, output.height)
  const blob = await new Promise<Blob>((resolve, reject) => output.toBlob(value => value ? resolve(value) : reject(new Error('annotation.captureFailed')), 'image/png'))
  return new File([blob], name, { type: 'image/png' })
}

function isAnnotation(value: unknown): value is OfficeAnnotation {
  if (typeof value !== 'object' || value === null)
    return false
  const item = value as Record<string, unknown>
  const string = (value: unknown, max: number): boolean => typeof value === 'string' && value.length <= max
  if (!string(item.target, ANNOTATION_MAX_TEXT) || !string(item.fileName, 1000) || !string(item.text, ANNOTATION_MAX_TEXT)
    || !string(item.requirement, ANNOTATION_MAX_TEXT) || !(item.requirement as string).trim()
    || (item.page !== undefined && (!Number.isSafeInteger(item.page) || (item.page as number) < 1))
    || (item.imageName !== undefined && !string(item.imageName, 1000))
    || (item.sheet !== undefined && (!string(item.sheet, 1000) || !(item.sheet as string).trim()))
    || (item.range !== undefined && (!string(item.range, 100) || !(item.range as string).trim()))
    || (item.unmapped !== undefined && item.unmapped !== true)) {
    return false
  }
  if (item.region !== undefined) {
    const region = item.region as Record<string, unknown> | null
    if (!region || !['left', 'top', 'width', 'height'].every(key => typeof region[key] === 'number' && Number.isFinite(region[key]) && (region[key] as number) >= 0 && (region[key] as number) <= 1))
      return false
    if ((region.width as number) <= 0 || (region.height as number) <= 0
      || (region.left as number) + (region.width as number) > 1.000001 || (region.top as number) + (region.height as number) > 1.000001) {
      return false
    }
  }
  return true
}

/** Plain text in the normal user message is the durable source of truth; no new Session event. */
export function serializeAnnotations(items: readonly OfficeAnnotation[]): string {
  if (!items.length || items.length > ANNOTATION_MAX_ITEMS || !items.every(isAnnotation))
    throw new Error('annotation.invalid')
  const payload = JSON.stringify(items).replace(/</gu, '\\u003c')
  if (payload.length > ANNOTATION_MAX_PAYLOAD)
    throw new Error('annotation.tooLarge')
  return `${ANNOTATION_OPEN}\n${payload}\n${ANNOTATION_CLOSE}`
}

export const annotationRule: UserTextRule<'officeAnnotation'> = {
  id: ANNOTATION_NODE,
  order: 10,
  match(text, from) {
    for (let start = text.indexOf(ANNOTATION_OPEN, from); start >= 0; start = text.indexOf(ANNOTATION_OPEN, start + ANNOTATION_OPEN.length)) {
      const end = text.indexOf(ANNOTATION_CLOSE, start + ANNOTATION_OPEN.length)
      if (end < 0)
        return undefined
      const payload = text.slice(start + ANNOTATION_OPEN.length, end).trim()
      if (payload.length > ANNOTATION_MAX_PAYLOAD)
        continue
      try {
        const items: unknown = JSON.parse(payload)
        if (Array.isArray(items) && items.length > 0 && items.length <= ANNOTATION_MAX_ITEMS && items.every(isAnnotation))
          return { id: ANNOTATION_NODE, start, end: end + ANNOTATION_CLOSE.length, data: { items } }
      }
      catch { /* Invalid/foreign markers remain visible as ordinary text. */ }
    }
    return undefined
  },
}

/** Prepare one synchronous input transaction; admitted or restored drafts belong to the composer. */
export function sendAnnotations({ items, inputActions, intake, limits, existingImages, deferSubmit }: AnnotationSendInput): 'sent' | 'draft' {
  const text = serializeAnnotations(items.map(item => item.annotation))
  const files = items.flatMap(item => item.file ? [item.file] : [])
  if (files.length && !intake)
    throw new Error('annotation.intakeUnavailable')
  if (files.length && limits) {
    if (files.some(file => !limits.mediaTypes.includes(file.type) || file.size > limits.maxImageBytes)
      || existingImages.length + files.length > limits.maxImagesPerMessage
      || [...existingImages, ...files].reduce((sum, file) => sum + file.size, 0) > limits.maxMessageImageBytes) {
      throw new Error('annotation.imageLimit')
    }
  }
  const span = inputActions.captureInsertion()
  const drafts = files.length ? intake!.create(files) : []
  if (drafts.length && !inputActions.addAttachments(drafts.map(item => item.id))) {
    intake!.release(drafts)
    throw new Error('annotation.sendFailed')
  }
  if (!inputActions.insertText(`\n${text}\n`, { ...span, start: span.end })) {
    for (const draft of drafts)
      inputActions.removeAttachment(draft.id)
    intake?.release(drafts)
    throw new Error('annotation.sendFailed')
  }
  try {
    inputActions.persistDraft()
    if (deferSubmit)
      return 'draft'
    inputActions.submit()
    return 'sent'
  }
  catch {
    // The text and files are already in the composer; never discard or duplicate them on retry.
    return 'draft'
  }
}

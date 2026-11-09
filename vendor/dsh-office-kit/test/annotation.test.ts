import type { ComposerAttachment, InputActions, UserTextTransformContext } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { AnnotationImageLimits, AnnotationIntake, AnnotationParagraph, AnnotationTextRun, OfficeAnnotation } from '../src/client/types'
import { describe, expect, it, vi } from 'vitest'
import { annotationPopoverPosition, annotationPreview, annotationRule, captureAnnotation, containsPoint, groupParagraphs, intersectRect, normalizedRegion, paddedRect, paragraphAtPoint, sendAnnotations, serializeAnnotations, spreadsheetAt } from '../src/client/annotation'
import { ANNOTATION_CLOSE, ANNOTATION_MAX_ITEMS, ANNOTATION_MAX_PAYLOAD, ANNOTATION_MAX_TEXT, ANNOTATION_NODE, ANNOTATION_OPEN, ANNOTATION_SPREADSHEET_CANVAS_SELECTOR } from '../src/client/constants'

const ANNOTATION: OfficeAnnotation = {
  target: 'reports/review.pdf',
  fileName: 'review.pdf',
  text: 'Original paragraph',
  requirement: 'Replace this paragraph',
}
const CONTEXT: UserTextTransformContext = { read: () => undefined }

function composer() {
  return {
    captureInsertion: vi.fn<InputActions['captureInsertion']>(() => ({ start: 5, end: 5, draftRev: 1 })),
    insertText: vi.fn<InputActions['insertText']>(() => true),
    setDraft: vi.fn<InputActions['setDraft']>(),
    persistDraft: vi.fn<InputActions['persistDraft']>(),
    addAttachments: vi.fn<InputActions['addAttachments']>(() => true),
    removeAttachment: vi.fn<InputActions['removeAttachment']>(),
    pruneAttachments: vi.fn<InputActions['pruneAttachments']>(),
    submit: vi.fn<InputActions['submit']>(),
  } satisfies InputActions
}

function screenshotBatch() {
  const files = ['first.png', 'second.png'].map(name => new File([name], name, { type: 'image/png' }))
  const drafts: ComposerAttachment[] = files.map((file, index) => ({
    kind: 'image',
    id: `image-${index}` as ComposerAttachment['id'],
    file,
    previewUrl: `blob:test-${index}`,
  }))
  const intake = {
    create: vi.fn<AnnotationIntake['create']>(() => drafts),
    release: vi.fn<AnnotationIntake['release']>(),
    images: vi.fn<AnnotationIntake['images']>(() => []),
  } satisfies AnnotationIntake
  const items = files.map((file, index) => ({ annotation: { ...ANNOTATION, page: index + 1, imageName: file.name }, file }))
  return { items, files, drafts, intake, inputActions: composer(), existingImages: [] }
}

describe('annotation geometry and paragraphs', () => {
  const page = { left: 100, top: 200, width: 200, height: 100 }

  it('clips a selection to the painted page before normalizing coordinates', () => {
    const box = { left: 50, top: 225, width: 300, height: 100 }
    expect(intersectRect(box, page)).toEqual({ left: 100, top: 225, width: 200, height: 75 })
    expect(normalizedRegion(box, page)).toEqual({ left: 0, top: 0.25, width: 1, height: 0.75 })
    expect(normalizedRegion(page, page)).toEqual({ left: 0, top: 0, width: 1, height: 1 })
    expect(containsPoint(page, 100, 200)).toBe(true)
    expect(containsPoint(page, 300, 300)).toBe(true)
    expect(containsPoint(page, 301, 300)).toBe(false)
  })

  it('locates the spreadsheet grid canvas by point without assigning a page', () => {
    const grid = { left: 100, top: 200, width: 300, height: 200 }
    const canvas = { getBoundingClientRect: () => grid } as HTMLCanvasElement
    const preview = { querySelectorAll: (selector: string) => selector === ANNOTATION_SPREADSHEET_CANVAS_SELECTOR ? [canvas] : [] } as unknown as HTMLElement
    expect(spreadsheetAt(preview, 150, 250)).toEqual({ canvas })
    expect(spreadsheetAt(preview, 10, 10)).toBeUndefined()
  })

  it('pads paragraph and captured region bounds by 3px without changing the source', () => {
    const box = Object.freeze({ left: 120, top: 220, width: 60, height: 20 })
    expect(paddedRect(box, page)).toEqual({ left: 117, top: 217, width: 66, height: 26 })
    expect(box).toEqual({ left: 120, top: 220, width: 60, height: 20 })
    expect(paddedRect({ left: 100, top: 200, width: 10, height: 10 }, page)).toEqual({ left: 100, top: 200, width: 13, height: 13 })
    expect(paddedRect(page, page)).toEqual(page)
  })

  it('rejects empty pages and selections that only touch a page edge', () => {
    const outside = { left: 300, top: 200, width: 10, height: 10 }
    expect(intersectRect(outside, page)).toBeUndefined()
    expect(() => normalizedRegion(outside, page)).toThrow('annotation.emptyRegion')
    expect(() => normalizedRegion(page, { ...page, width: 0 })).toThrow('annotation.emptyPage')
    expect(() => normalizedRegion(page, { ...page, height: 0 })).toThrow('annotation.emptyPage')
  })

  it('joins visual lines without crossing columns or paragraph gaps', () => {
    const runs: AnnotationTextRun[] = [
      { text: 'Right two', box: { left: 160, top: 23, width: 70, height: 10 } },
      { text: 'Left two', box: { left: 10, top: 23, width: 80, height: 10 } },
      { text: '  one ', box: { left: 45, top: 10, width: 40, height: 10 } },
      { text: 'After gap', box: { left: 10, top: 52, width: 90, height: 10 } },
      { text: 'Right one', box: { left: 160, top: 10, width: 70, height: 10 } },
      { text: ' Left ', box: { left: 10, top: 10, width: 30, height: 10 } },
      { text: '  ', box: { left: 10, top: 0, width: 80, height: 10 } },
      { text: 'Hidden', box: { left: 10, top: 0, width: 0, height: 10 } },
    ]
    const original = structuredClone(runs)
    const paragraphs = groupParagraphs(runs)
    expect(paragraphs).toEqual([
      { text: 'Left one\nLeft two', box: { left: 10, top: 10, width: 80, height: 23 }, rects: [runs[5]!.box, runs[2]!.box, runs[1]!.box] },
      { text: 'Right one\nRight two', box: { left: 160, top: 10, width: 70, height: 23 }, rects: [runs[4]!.box, runs[0]!.box] },
      { text: 'After gap', box: { left: 10, top: 52, width: 90, height: 10 }, rects: [runs[3]!.box] },
    ])
    expect(paragraphAtPoint(paragraphs, 30, 21)).toBe(paragraphs[0])
    expect(runs).toEqual(original)
  })

  it('does not snap an empty tail inside a wrapped paragraph envelope', () => {
    const paragraphs = groupParagraphs([
      { text: 'Long line', box: { left: 10, top: 10, width: 200, height: 10 } },
      { text: 'Short', box: { left: 10, top: 25, width: 30, height: 10 } },
    ])
    expect(paragraphs).toHaveLength(1)
    expect(paragraphAtPoint(paragraphs, 180, 32)).toBeUndefined()
    expect(paragraphAtPoint(paragraphs, 180, 15)).toBe(paragraphs[0])
    expect(paragraphAtPoint(paragraphs, 20, 32)).toBe(paragraphs[0])
  })

  it('retains individual text runs rather than accepting gaps in a merged line', () => {
    const paragraphs = groupParagraphs([
      { text: 'Left', box: { left: 10, top: 10, width: 20, height: 10 } },
      { text: 'Right', box: { left: 49, top: 10, width: 20, height: 10 } },
    ])
    expect(paragraphs).toHaveLength(1)
    expect(paragraphAtPoint(paragraphs, 39.5, 15)).toBeUndefined()
    expect(paragraphAtPoint(paragraphs, 38, 15)).toBe(paragraphs[0])
    expect(paragraphAtPoint(paragraphs, 41, 15)).toBe(paragraphs[0])
  })

  it('hits inclusive 8px horizontal and 4px vertical margins without snapping distant text', () => {
    const paragraph: AnnotationParagraph = { text: 'Paragraph', box: { left: 100, top: 200, width: 80, height: 30 } }
    for (const [x, y] of [[100, 200], [180, 230], [92, 196], [188, 234]] as const)
      expect(paragraphAtPoint([paragraph], x, y)).toBe(paragraph)
    for (const [x, y] of [[91.99, 210], [188.01, 210], [130, 195.99], [130, 234.01], [1000, 1000]] as const)
      expect(paragraphAtPoint([paragraph], x, y)).toBeUndefined()
    expect(paragraphAtPoint([], 130, 210)).toBeUndefined()
  })

  it('chooses the smallest overlapping box by area without reordering readonly paragraphs', () => {
    const wide: AnnotationParagraph = { text: 'Wide', box: { left: 100, top: 200, width: 80, height: 10 } }
    const narrow: AnnotationParagraph = { text: 'Narrow', box: { left: 120, top: 196, width: 20, height: 36 } }
    expect(paragraphAtPoint(Object.freeze([wide, narrow]), 130, 205)).toBe(narrow)
    expect(paragraphAtPoint(Object.freeze([narrow, wide]), 130, 205)).toBe(narrow)
    expect(paragraphAtPoint([wide, narrow], 113, 205)).toBe(narrow)
  })
})

describe('annotation popover placement', () => {
  const viewport = { width: 800, height: 600 }
  const popup = { width: 320, height: 150 }

  it('clamps a conversation chip beside an open sidebar to the viewport, not its clipping parent', () => {
    expect(annotationPopoverPosition({ left: 650, top: 300, width: 90, height: 28 }, popup, viewport)).toEqual({ left: 472, top: 150 })
  })

  it('flips below a chip near the top and stays within bottom and left edges', () => {
    expect(annotationPopoverPosition({ left: -10, top: 30, width: 90, height: 28 }, popup, viewport)).toEqual({ left: 8, top: 58 })
    expect(annotationPopoverPosition({ left: 20, top: 580, width: 90, height: 28 }, popup, viewport)).toEqual({ left: 20, top: 430 })
  })
})

describe('annotation preview root', () => {
  it.each([0, 1, 2])('resolves its own header through %i display:contents wrappers', (count) => {
    const root = {} as HTMLElement
    const header = { parentElement: root } as HTMLElement
    const otherRoot = {} as HTMLElement
    const otherHeader = { parentElement: otherRoot } as HTMLElement
    const wrappers = new Set<HTMLElement>()
    let parentElement = header
    for (let index = 0; index < count; index++) {
      parentElement = { parentElement } as HTMLElement
      wrappers.add(parentElement)
    }
    vi.stubGlobal('getComputedStyle', (element: HTMLElement) => ({ display: wrappers.has(element) ? 'contents' : 'flex' }))
    try {
      const preview = annotationPreview({ parentElement } as HTMLElement)
      expect(preview?.header).toBe(header)
      expect(preview?.root).toBe(root)
      expect(annotationPreview({ parentElement: otherHeader } as HTMLElement)?.root).toBe(otherRoot)
      expect(annotationPreview({ parentElement: null } as HTMLElement)).toBeUndefined()
    }
    finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('annotation screenshot capture', () => {
  it('limits a thin crop by maximum dimension even when its pixel count is already allowed', async () => {
    const box = { left: 100, top: 200, width: 1000, height: 10 }
    const canvas = { width: 10000, height: 100, getBoundingClientRect: () => box } as HTMLCanvasElement
    const drawImage = vi.fn()
    const output = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage }),
      toBlob: (callback: BlobCallback) => callback(new Blob(['png'], { type: 'image/png' })),
    }
    vi.stubGlobal('document', { createElement: vi.fn(() => output) })
    try {
      const file = await captureAnnotation({ canvas, box, text: '' }, 'thin.png', 4000000, 2048)
      expect([output.width, output.height]).toEqual([2048, 20])
      expect(drawImage).toHaveBeenCalledExactlyOnceWith(canvas, 0, 0, 10000, 100, 0, 0, 2048, 20)
      expect(file.name).toBe('thin.png')
      expect(file.type).toBe('image/png')
    }
    finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('annotation message codec', () => {
  it('keeps absent optional fields out of the payload and carries xlsx regions as unmapped', () => {
    expect(JSON.stringify(ANNOTATION)).toBe('{"target":"reports/review.pdf","fileName":"review.pdf","text":"Original paragraph","requirement":"Replace this paragraph"}')
    const sheet: OfficeAnnotation = {
      target: 'books/budget.xlsx',
      fileName: 'budget.xlsx',
      text: '',
      requirement: 'Explain this block',
      region: { left: 0.1, top: 0.2, width: 0.3, height: 0.4 },
      imageName: 'budget-region-1.png',
      unmapped: true,
    }
    const encoded = serializeAnnotations([sheet])
    expect(encoded).toContain('"unmapped":true')
    expect(encoded).not.toContain('"page"')
    expect(annotationRule.match(encoded, 0, CONTEXT)?.data).toEqual({ items: [sheet] })
  })

  it('roundtrips marker-like text, quotes, slashes, and Unicode without ending the payload early', () => {
    const items: OfficeAnnotation[] = [{
      ...ANNOTATION,
      text: `Quoted "text"\n${ANNOTATION_CLOSE}${ANNOTATION_OPEN}<script>\\例`,
      requirement: 'Keep < & > as literal text',
      page: 2,
      region: { left: 0.25, top: 0.5, width: 0.5, height: 0.25 },
      imageName: 'page-2.png',
    }]
    const encoded = serializeAnnotations(items)
    const prefix = 'Before 😀\n'
    expect(encoded).toContain('\\u003cscript>')
    expect(encoded).not.toContain('<script>')
    expect(annotationRule.match(`${prefix}${encoded}\nAfter`, 0, CONTEXT)).toEqual({
      id: ANNOTATION_NODE,
      start: prefix.length,
      end: prefix.length + encoded.length,
      data: { items },
    })
  })

  it('roundtrips the exact JSON budget without counting serializer framing newlines', () => {
    const padding = 'x'.repeat(ANNOTATION_MAX_TEXT)
    const items = Array.from({ length: Math.ceil(ANNOTATION_MAX_PAYLOAD / (3 * ANNOTATION_MAX_TEXT)) }, () => ({ ...ANNOTATION, target: padding, text: padding, requirement: padding }))
    items[0]!.text = padding.slice(JSON.stringify(items).length - ANNOTATION_MAX_PAYLOAD)
    expect(JSON.stringify(items)).toHaveLength(ANNOTATION_MAX_PAYLOAD)
    expect(annotationRule.match(serializeAnnotations(items), 0, CONTEXT)?.data).toEqual({ items })
    items[0]!.text += 'x'
    expect(() => serializeAnnotations(items)).toThrow('annotation.tooLarge')
    expect(annotationRule.match(`${ANNOTATION_OPEN}\n${JSON.stringify(items)}\n${ANNOTATION_CLOSE}`, 0, CONTEXT)).toBeUndefined()
  })

  it('skips malformed blocks and respects the original-text cursor', () => {
    const invalid = `${ANNOTATION_OPEN}not JSON${ANNOTATION_CLOSE}\n`
    const encoded = serializeAnnotations([ANNOTATION])
    const text = `${invalid}${encoded}\n${encoded}`
    expect(annotationRule.match(text, 0, CONTEXT)?.start).toBe(invalid.length)
    expect(annotationRule.match(text, invalid.length + encoded.length, CONTEXT)?.start).toBe(invalid.length + encoded.length + 1)
    expect(annotationRule.match(text, text.length, CONTEXT)).toBeUndefined()
    expect(annotationRule.match(ANNOTATION_OPEN, 0, CONTEXT)).toBeUndefined()
  })

  it.each([
    ['a non-array', {}],
    ['an empty batch', []],
    ['too many items', Array.from<OfficeAnnotation>({ length: ANNOTATION_MAX_ITEMS + 1 }).fill(ANNOTATION)],
    ['a non-string field', [{ ...ANNOTATION, text: 17 }]],
    ['a blank requirement', [{ ...ANNOTATION, requirement: ' \n\t' }]],
    ['a nonpositive page', [{ ...ANNOTATION, page: 0 }]],
    ['a fractional page', [{ ...ANNOTATION, page: 1.5 }]],
    ['an incomplete region', [{ ...ANNOTATION, region: { left: 0, top: 0, width: 1 } }]],
    ['an overflowing region', [{ ...ANNOTATION, region: { left: 0.8, top: 0, width: 0.3, height: 1 } }]],
    ['a zero-size region', [{ ...ANNOTATION, region: { left: 0, top: 0, width: 0, height: 1 } }]],
    ['a blank sheet name', [{ ...ANNOTATION, sheet: ' \n' }]],
    ['a blank range', [{ ...ANNOTATION, range: '' }]],
    ['a false unmapped flag', [{ ...ANNOTATION, unmapped: false }]],
  ])('keeps %s visible as ordinary text', (_label, payload) => {
    expect(annotationRule.match(`${ANNOTATION_OPEN}\n${JSON.stringify(payload)}\n${ANNOTATION_CLOSE}`, 0, CONTEXT)).toBeUndefined()
  })

  it('rejects invalid batches before serializing', () => {
    expect(() => serializeAnnotations([])).toThrow('annotation.invalid')
    expect(() => serializeAnnotations(Array.from<OfficeAnnotation>({ length: ANNOTATION_MAX_ITEMS + 1 }).fill(ANNOTATION))).toThrow('annotation.invalid')
    expect(() => serializeAnnotations([{ ...ANNOTATION, requirement: ' ' }])).toThrow('annotation.invalid')
    expect(() => serializeAnnotations([{ ...ANNOTATION, page: 0 }])).toThrow('annotation.invalid')
    expect(() => serializeAnnotations([{ ...ANNOTATION, text: 'x'.repeat(ANNOTATION_MAX_TEXT + 1) }])).toThrow('annotation.invalid')
    expect(() => serializeAnnotations([{ ...ANNOTATION, region: { left: 0, top: 0, width: 0, height: 1 } }])).toThrow('annotation.invalid')
  })
})

describe('annotation composer transaction', () => {
  it('sends text-only document annotations without an attachment intake', () => {
    const inputActions = composer()
    expect(sendAnnotations({ items: [{ annotation: ANNOTATION }], inputActions, existingImages: [] })).toBe('sent')
    expect(inputActions.addAttachments).not.toHaveBeenCalled()
    expect(inputActions.insertText).toHaveBeenCalledExactlyOnceWith(`\n${serializeAnnotations([ANNOTATION])}\n`, inputActions.captureInsertion.mock.results[0]?.value)
    expect(inputActions.persistDraft).toHaveBeenCalledOnce()
    expect(inputActions.submit).toHaveBeenCalledOnce()
  })

  it('inserts after a nonempty selection without deleting the selected draft text', () => {
    const inputActions = composer()
    const original = 'abcdef'
    let draft = original
    inputActions.captureInsertion.mockReturnValue({ start: 2, end: 5, draftRev: 1 })
    inputActions.insertText.mockImplementation((text, span) => {
      draft = `${draft.slice(0, span.start)}${text}${draft.slice(span.end)}`
      return true
    })
    expect(sendAnnotations({ items: [{ annotation: ANNOTATION }], inputActions, existingImages: [] })).toBe('sent')
    const inserted = `\n${serializeAnnotations([ANNOTATION])}\n`
    expect(inputActions.insertText).toHaveBeenCalledExactlyOnceWith(inserted, { start: 5, end: 5, draftRev: 1 })
    expect(draft).toBe(`${original.slice(0, 5)}${inserted}${original.slice(5)}`)
    expect(inputActions.setDraft).not.toHaveBeenCalled()
  })

  it('admits all screenshots and inserts one ordered annotation batch before submission', () => {
    const batch = screenshotBatch()
    expect(sendAnnotations(batch)).toBe('sent')
    expect(batch.intake.create).toHaveBeenCalledExactlyOnceWith(batch.files)
    expect(batch.inputActions.addAttachments).toHaveBeenCalledExactlyOnceWith(batch.drafts.map(item => item.id))
    expect(batch.inputActions.insertText).toHaveBeenCalledExactlyOnceWith(`\n${serializeAnnotations(batch.items.map(item => item.annotation))}\n`, { start: 5, end: 5, draftRev: 1 })
    expect(batch.inputActions.persistDraft).toHaveBeenCalledOnce()
    expect(batch.inputActions.submit).toHaveBeenCalledOnce()
    expect(batch.inputActions.persistDraft.mock.invocationCallOrder[0]).toBeLessThan(batch.inputActions.submit.mock.invocationCallOrder[0]!)
    expect(batch.intake.release).not.toHaveBeenCalled()
    expect(batch.inputActions.removeAttachment).not.toHaveBeenCalled()
    expect(batch.inputActions.setDraft).not.toHaveBeenCalled()
  })

  it.each(['maxImagesPerMessage', 'maxImageBytes', 'maxMessageImageBytes'] as const)('admits the exact %s boundary and rejects one over before touching the composer', (key) => {
    const batch = screenshotBatch()
    const existingImages = [{ size: 5 }]
    const limits: AnnotationImageLimits = {
      maxImagesPerMessage: batch.files.length + existingImages.length,
      maxImageBytes: Math.max(...batch.files.map(file => file.size)),
      maxMessageImageBytes: [...batch.files, ...existingImages].reduce((sum, file) => sum + file.size, 0),
      maxImagePixels: 4000000,
      maxImageDimension: 2048,
      mediaTypes: ['image/png'],
    }
    expect(sendAnnotations({ ...batch, existingImages, limits })).toBe('sent')
    const denied = screenshotBatch()
    expect(() => sendAnnotations({ ...denied, existingImages, limits: { ...limits, [key]: limits[key] - 1 } })).toThrow('annotation.imageLimit')
    expect(denied.intake.create).not.toHaveBeenCalled()
    expect(denied.inputActions.captureInsertion).not.toHaveBeenCalled()
    expect(denied.inputActions.insertText).not.toHaveBeenCalled()
    expect(denied.inputActions.submit).not.toHaveBeenCalled()
  })

  it('releases newly created screenshots when attachment admission refuses', () => {
    const batch = screenshotBatch()
    batch.inputActions.addAttachments.mockReturnValue(false)
    expect(() => sendAnnotations(batch)).toThrow('annotation.sendFailed')
    expect(batch.intake.release).toHaveBeenCalledExactlyOnceWith(batch.drafts)
    expect(batch.inputActions.insertText).not.toHaveBeenCalled()
    expect(batch.inputActions.removeAttachment).not.toHaveBeenCalled()
    expect(batch.inputActions.persistDraft).not.toHaveBeenCalled()
    expect(batch.inputActions.submit).not.toHaveBeenCalled()
  })

  it('removes every admitted screenshot and releases it when text insertion refuses', () => {
    const batch = screenshotBatch()
    batch.inputActions.insertText.mockReturnValue(false)
    expect(() => sendAnnotations(batch)).toThrow('annotation.sendFailed')
    expect(batch.inputActions.removeAttachment.mock.calls).toEqual(batch.drafts.map(item => [item.id]))
    expect(batch.intake.release).toHaveBeenCalledExactlyOnceWith(batch.drafts)
    expect(batch.inputActions.persistDraft).not.toHaveBeenCalled()
    expect(batch.inputActions.submit).not.toHaveBeenCalled()
    expect(batch.inputActions.setDraft).not.toHaveBeenCalled()
  })

  it('merges into an existing text and attachment draft without submitting when deferred', () => {
    const batch = screenshotBatch()
    let draft = 'Existing draft'
    const attachments = ['existing'] as ComposerAttachment['id'][]
    batch.inputActions.captureInsertion.mockReturnValue({ start: draft.length, end: draft.length, draftRev: 1 })
    batch.inputActions.insertText.mockImplementation((text, span) => {
      draft = `${draft.slice(0, span.start)}${text}${draft.slice(span.end)}`
      return true
    })
    batch.inputActions.addAttachments.mockImplementation((ids) => {
      attachments.push(...ids)
      return true
    })
    expect(sendAnnotations({ ...batch, existingImages: [{ size: 5 }], deferSubmit: true })).toBe('draft')
    expect(draft).toBe(`Existing draft\n${serializeAnnotations(batch.items.map(item => item.annotation))}\n`)
    expect(attachments).toEqual(['existing', ...batch.drafts.map(item => item.id)])
    expect(batch.inputActions.persistDraft).toHaveBeenCalledOnce()
    expect(batch.inputActions.submit).not.toHaveBeenCalled()
    expect(batch.inputActions.setDraft).not.toHaveBeenCalled()
    expect(batch.inputActions.removeAttachment).not.toHaveBeenCalled()
    expect(batch.inputActions.pruneAttachments).not.toHaveBeenCalled()
    expect(batch.intake.release).not.toHaveBeenCalled()
  })

  it('leaves persisted text and screenshots in the composer when submit throws', () => {
    const batch = screenshotBatch()
    batch.inputActions.submit.mockImplementation(() => {
      throw new Error('submission unavailable')
    })
    expect(sendAnnotations(batch)).toBe('draft')
    expect(batch.inputActions.insertText).toHaveBeenCalledOnce()
    expect(batch.inputActions.addAttachments).toHaveBeenCalledOnce()
    expect(batch.inputActions.persistDraft).toHaveBeenCalledOnce()
    expect(batch.inputActions.submit).toHaveBeenCalledOnce()
    expect(batch.intake.release).not.toHaveBeenCalled()
    expect(batch.inputActions.removeAttachment).not.toHaveBeenCalled()
    expect(batch.inputActions.setDraft).not.toHaveBeenCalled()
  })
})

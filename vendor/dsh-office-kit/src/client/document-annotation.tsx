import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { CSSProperties, PointerEvent, ReactElement } from 'react'
import type { OFFICE_NS } from './constants'
import type { AnnotationInjected, AnnotationRect, AnnotationSelection, PendingAnnotation } from './types'
import { useEffect, useId, useRef, useState } from 'react'
import { annotationPreview, canvasAt, canvasParagraphs, captureAnnotation, intersectRect, normalizedRegion, paddedRect, paragraphAtPoint, sendAnnotations, spreadsheetAt } from './annotation'
import { ANNOTATION_CANVAS_SELECTOR, ANNOTATION_HOLD_MS, ANNOTATION_MAX_ITEMS, ANNOTATION_MAX_TEXT, ANNOTATION_MIN_REGION, ANNOTATION_SPREADSHEET_CANVAS_SELECTOR } from './constants'
import { fillTemplate } from './quote'

type Props = PropsRuntime<'sidebar.right.tab.document.actions'> & PropsLocale<typeof OFFICE_NS> & AnnotationInjected

/** This slot is rendered by the document header; every overlay stays in this React subtree. */
export function DocumentAnnotation(props: Props): ReactElement | null {
  if (!/\.(?:pdf|docx?|pptx|xlsx)$/iu.test(props.absolutePath))
    return null
  return <AnnotationTool key={props.absolutePath} {...props} />
}

function AnnotationTool({ absolutePath, pendingAnnotations, intake, inputActions, useInput, useProjection, t }: Props): ReactElement {
  const anchor = useRef<HTMLSpanElement>(null)
  const form = useRef<HTMLFormElement>(null)
  const surface = useRef<HTMLDivElement>(null)
  const preview = useRef<HTMLElement>()
  const [bounds, setBounds] = useState<AnnotationRect>()
  const [active, setActive] = useState(false)
  const [hover, setHover] = useState<AnnotationSelection>()
  const [selection, setSelection] = useState<AnnotationSelection>()
  const [requirement, setRequirement] = useState('')
  const [image, setImage] = useState<File>()
  const [capturing, setCapturing] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [items, setItems] = useState<readonly PendingAnnotation[]>(() => pendingAnnotations.get(absolutePath) ?? [])
  const [summaryDismissed, setSummaryDismissed] = useState(false)
  const summaryId = useId()
  const [error, setError] = useState('')
  const input = useInput(state => state)
  const limits = useProjection('imageLimits')
  const isPdf = /\.pdf$/iu.test(absolutePath)
  const isSpreadsheet = /\.xlsx$/iu.test(absolutePath)
  /** Formats whose page/region is only legible as a screenshot attachment. */
  const captures = isPdf || isSpreadsheet
  const canvasSelector = isSpreadsheet ? ANNOTATION_SPREADSHEET_CANVAS_SELECTOR : ANNOTATION_CANVAS_SELECTOR
  const fileName = absolutePath.replace(/\\/gu, '/').split('/').pop() ?? absolutePath
  const revision = useRef(0)
  const hold = useRef<ReturnType<typeof setTimeout>>()
  const gesture = useRef<{ x: number, y: number, lastX: number, lastY: number, canvas: HTMLCanvasElement, page?: number, region: boolean }>()
  const cache = useRef<{ canvas: HTMLCanvasElement, box: AnnotationRect, paragraphs: ReturnType<typeof canvasParagraphs> }>()
  const disabled = input.phase !== 'plain'

  useEffect(() => {
    if (items.length)
      pendingAnnotations.set(absolutePath, items)
    else
      pendingAnnotations.delete(absolutePath)
  }, [absolutePath, items, pendingAnnotations])

  function dismiss(): void {
    revision.current++
    setSelection(undefined)
    setImage(undefined)
    setCapturing(false)
    setRequirement('')
  }

  function cancelGesture(): void {
    clearTimeout(hold.current)
    gesture.current = undefined
    setDragging(false)
    setHover(undefined)
  }

  useEffect(() => {
    const node = anchor.current
    const container = node && annotationPreview(node)
    if (!container)
      return
    const { header, root } = container
    preview.current = root
    let frame = 0
    const measure = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        cache.current = undefined
        const rect = root.getBoundingClientRect()
        const top = Math.max(rect.top, header.getBoundingClientRect().bottom, 0)
        const bottom = Math.min(rect.bottom, window.innerHeight)
        const left = Math.max(0, rect.left)
        const right = Math.min(rect.right, window.innerWidth)
        const canvas = [...root.querySelectorAll<HTMLCanvasElement>(canvasSelector)].find(canvas => canvas.getBoundingClientRect().width > 0)
        const visible = root.isConnected && !root.closest('[hidden], [aria-hidden="true"]') && getComputedStyle(root).visibility === 'visible'
        setBounds(visible && rect.height > 40 && canvas && right > left && bottom > top
          ? { left, top, width: right - left, height: bottom - top }
          : undefined)
        // Keep the saved page-relative region and comment when viewport geometry changes.
        setSelection((previous) => {
          if (!previous?.canvas || !previous.region)
            return previous
          const page = previous.canvas.getBoundingClientRect()
          const region = previous.region
          const box = { left: page.left + region.left * page.width, top: page.top + region.top * page.height, width: region.width * page.width, height: region.height * page.height }
          return Object.keys(box).every(key => box[key as keyof AnnotationRect] === previous.box[key as keyof AnnotationRect]) ? previous : { ...previous, box }
        })
      })
    }
    const resize = new ResizeObserver(measure)
    resize.observe(root)
    const mutation = new MutationObserver((records) => {
      if (records.some(record => !node.contains(record.target)))
        measure()
    })
    mutation.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'aria-hidden', 'class', 'style'] })
    for (let parent = root.parentElement; parent; parent = parent.parentElement)
      mutation.observe(parent, { attributes: true })
    window.addEventListener('resize', measure)
    root.addEventListener('transitionend', measure)
    root.addEventListener('scroll', measure, true)
    measure()
    return () => {
      revision.current++
      clearTimeout(hold.current)
      cancelAnimationFrame(frame)
      resize.disconnect()
      mutation.disconnect()
      window.removeEventListener('resize', measure)
      root.removeEventListener('transitionend', measure)
      root.removeEventListener('scroll', measure, true)
      preview.current = undefined
    }
  }, [])

  useEffect(() => {
    if (!selection)
      return
    const dismissOutside = (event: globalThis.PointerEvent): void => {
      if (event.target instanceof Node && !form.current?.contains(event.target))
        dismiss()
    }
    document.addEventListener('pointerdown', dismissOutside, true)
    form.current?.querySelector('input')?.focus()
    return () => {
      document.removeEventListener('pointerdown', dismissOutside, true)
    }
  }, [selection])

  useEffect(() => {
    if (active)
      surface.current?.focus()
  }, [active])

  function scrollPreview(x: number, y: number): void {
    const root = preview.current
    if (!root)
      return
    let scroll = root.querySelector(canvasSelector)?.parentElement
    while (scroll && scroll !== root && !/auto|scroll/u.test(getComputedStyle(scroll).overflowY))
      scroll = scroll.parentElement
    scroll?.scrollBy({ left: x, top: y })
    setHover(undefined)
  }

  useEffect(() => {
    const node = surface.current
    if (!active || !node || !bounds)
      return
    const wheel = (event: WheelEvent): void => {
      event.preventDefault()
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? bounds.height : 1
      scrollPreview(event.deltaX * unit, event.deltaY * unit)
    }
    node.addEventListener('wheel', wheel, { passive: false })
    return () => node.removeEventListener('wheel', wheel)
  }, [active, bounds])

  function surfaceAt(x: number, y: number): { canvas: HTMLCanvasElement, page?: number } | undefined {
    const root = preview.current
    if (!root)
      return undefined
    return isSpreadsheet ? spreadsheetAt(root, x, y) : canvasAt(root, x, y)
  }

  function paragraphAt(x: number, y: number): AnnotationSelection | undefined {
    // A workbook grid has no text layer: only a dragged region can locate anything.
    if (isSpreadsheet || !preview.current)
      return undefined
    const page = canvasAt(preview.current, x, y)
    if (!page)
      return undefined
    const box = page.canvas.getBoundingClientRect()
    if (cache.current?.canvas !== page.canvas || cache.current.box.left !== box.left || cache.current.box.top !== box.top
      || cache.current.box.width !== box.width || cache.current.box.height !== box.height) {
      cache.current = { canvas: page.canvas, box, paragraphs: canvasParagraphs(page.canvas) }
    }
    const paragraph = paragraphAtPoint(cache.current.paragraphs, x, y)
    return paragraph ? { ...paragraph, ...page } : undefined
  }

  function regionSelection(x: number, y: number): AnnotationSelection | undefined {
    const start = gesture.current
    if (!start)
      return undefined
    const box = intersectRect({ left: Math.min(start.x, x), top: Math.min(start.y, y), width: Math.abs(x - start.x), height: Math.abs(y - start.y) }, start.canvas.getBoundingClientRect())
    if (!box)
      return undefined
    const paragraphs = cache.current?.canvas === start.canvas ? cache.current.paragraphs : canvasParagraphs(start.canvas)
    const text = isSpreadsheet ? '' : paragraphs.filter(item => (item.rects ?? [item.box]).some(rect => intersectRect(rect, box))).map(item => item.text).join('\n').slice(0, ANNOTATION_MAX_TEXT)
    return { canvas: start.canvas, page: start.page, box, region: normalizedRegion(box, start.canvas.getBoundingClientRect()), text }
  }

  function pointerDown(event: PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0 || !preview.current || (captures && !intake))
      return
    const page = surfaceAt(event.clientX, event.clientY)
    if (!page)
      return
    event.preventDefault()
    dismiss()
    const start = { ...page, x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, region: false }
    gesture.current = start
    event.currentTarget.setPointerCapture(event.pointerId)
    hold.current = setTimeout(() => {
      if (gesture.current !== start)
        return
      start.region = true
      setDragging(true)
      setHover(regionSelection(start.lastX, start.lastY))
    }, ANNOTATION_HOLD_MS)
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>): void {
    const start = gesture.current
    if (start) {
      start.lastX = event.clientX
      start.lastY = event.clientY
      if (!start.region && Math.hypot(event.clientX - start.x, event.clientY - start.y) >= ANNOTATION_MIN_REGION) {
        clearTimeout(hold.current)
        start.region = true
        setDragging(true)
      }
    }
    setHover(start?.region ? regionSelection(event.clientX, event.clientY) : paragraphAt(event.clientX, event.clientY))
  }

  async function openSelection(value: AnnotationSelection): Promise<void> {
    dismiss()
    const current = revision.current
    setError('')
    const page = value.canvas?.getBoundingClientRect()
    const box = page ? paddedRect(value.box, page) : value.box
    if (!box)
      return
    const region = page ? normalizedRegion(box, page) : value.region
    const frozen = { ...value, box, region }
    setSelection(frozen)
    if (!captures)
      return
    setCapturing(true)
    try {
      const label = value.page === undefined ? 'region' : `p${value.page}`
      const file = await captureAnnotation(frozen, `${fileName}-${label}-${Date.now()}.png`, limits?.maxImagePixels, limits?.maxImageDimension)
      if (revision.current === current)
        setImage(file)
    }
    catch {
      if (revision.current === current)
        setError(t('annotation.captureFailed'))
    }
    finally {
      if (revision.current === current)
        setCapturing(false)
    }
  }

  function pointerUp(event: PointerEvent<HTMLDivElement>): void {
    const start = gesture.current
    clearTimeout(hold.current)
    if (!start)
      return
    const value = start.region ? regionSelection(event.clientX, event.clientY) : paragraphAt(event.clientX, event.clientY)
    const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y)
    cancelGesture()
    if (value && (start.region ? value.box.width >= ANNOTATION_MIN_REGION && value.box.height >= ANNOTATION_MIN_REGION : moved < ANNOTATION_MIN_REGION))
      void openSelection(value)
  }

  function add(): void {
    if (!selection || !requirement.trim() || (captures && !image) || items.length >= ANNOTATION_MAX_ITEMS)
      return
    const annotation = {
      target: absolutePath,
      fileName,
      page: selection.page,
      text: selection.text.slice(0, ANNOTATION_MAX_TEXT),
      requirement: requirement.trim(),
      region: selection.region,
      imageName: image?.name,
      // The workbook preview exposes no selection API we control, so the region stays raw.
      ...(isSpreadsheet ? { unmapped: true as const } : {}),
    }
    setItems(previous => [...previous, { annotation, file: image }])
    dismiss()
  }

  function send(): void {
    if (disabled)
      return
    try {
      const result = sendAnnotations({
        items,
        inputActions,
        intake,
        limits,
        existingImages: intake?.images(input.attachmentIds) ?? [],
        deferSubmit: !!input.draft.trim() || input.attachmentIds.length > 0,
      })
      setItems([])
      setSummaryDismissed(false)
      setActive(false)
      dismiss()
      setError(result === 'draft' ? t('annotation.draftReady') : '')
    }
    catch (error) {
      const key = error instanceof Error ? error.message : 'annotation.sendFailed'
      setError(t(key.startsWith('annotation.') ? key : 'annotation.sendFailed'))
    }
  }

  const highlight = selection ?? hover
  const highlightBox = highlight && !selection && !dragging && highlight.canvas
    ? paddedRect(highlight.box, highlight.canvas.getBoundingClientRect())
    : highlight?.box
  const clippedHighlight = highlightBox && bounds ? intersectRect(highlightBox, bounds) : undefined
  const formWidth = bounds ? Math.min(360, bounds.width - 16) : 0
  const formLeft = bounds && selection ? Math.max(bounds.left + 8, Math.min(selection.box.left, bounds.left + bounds.width - formWidth - 8)) : 0
  const formTop = bounds && selection ? Math.max(bounds.top + 4, Math.min(selection.box.top + selection.box.height + 6, bounds.top + bounds.height - 56)) : 0

  return (
    <span
      ref={anchor}
      className="dsh-office-annotate"
      onKeyDown={(event) => {
        if (!active || event.key !== 'Escape')
          return
        event.preventDefault()
        event.stopPropagation()
        const hasSelection = !!selection || !!gesture.current
        dismiss()
        cancelGesture()
        if (hasSelection) {
          surface.current?.focus()
        }
        else {
          setActive(false)
          anchor.current?.querySelector('button')?.focus()
        }
      }}
    >
      <button
        type="button"
        className="dsh-office-annotate-toggle"
        aria-pressed={active}
        disabled={!bounds || (captures && !intake)}
        title={captures && !intake ? t('annotation.intakeUnavailable') : !bounds ? t('annotation.unavailable') : t('annotation.help')}
        onClick={() => {
          setActive(value => !value)
          dismiss()
          cancelGesture()
        }}
      >
        {t('annotation.ask')}
      </button>
      {captures && !intake && <span role="status" className="dsh-office-annotate-unavailable">{t('annotation.intakeUnavailable')}</span>}
      {active && bounds && (
        <div
          ref={surface}
          className="dsh-office-annotate-surface"
          tabIndex={0}
          style={{ left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height }}
          role="region"
          aria-label={t('annotation.help')}
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          onPointerCancel={cancelGesture}
          onLostPointerCapture={cancelGesture}
          onKeyDown={(event) => {
            if (event.key === 'PageDown' || event.key === 'PageUp') {
              event.preventDefault()
              scrollPreview(0, bounds.height * (event.key === 'PageDown' ? 0.8 : -0.8))
            }
            else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              const paragraphs = [...preview.current!.querySelectorAll<HTMLCanvasElement>(ANNOTATION_CANVAS_SELECTOR)].flatMap((canvas, index) => canvasParagraphs(canvas).filter(item => intersectRect(item.box, bounds)).map(item => ({ ...item, canvas, page: index + 1 })))
              const current = paragraphs.findIndex(item => item.canvas === hover?.canvas && item.text === hover.text && item.box.top === hover.box.top)
              const index = current < 0 ? (event.key === 'ArrowDown' ? 0 : paragraphs.length - 1) : Math.max(0, Math.min(paragraphs.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)))
              setHover(paragraphs[index])
            }
            else if ((event.key === 'Enter' || event.key === ' ') && hover) {
              event.preventDefault()
              void openSelection(hover)
            }
          }}
          onPointerLeave={() => {
            if (!gesture.current)
              setHover(undefined)
          }}
        />
      )}
      {active && clippedHighlight && (
        <span className="dsh-office-annotate-highlight" data-selected={selection || dragging ? 'true' : undefined} style={{ left: clippedHighlight.left, top: clippedHighlight.top, width: clippedHighlight.width, height: clippedHighlight.height }} />
      )}
      {active && selection && bounds && (
        <form
          ref={form}
          className="dsh-office-annotate-composer"
          style={{ left: formLeft, top: formTop, width: formWidth }}
          aria-label={t('annotation.ask')}
          aria-busy={capturing}
          onSubmit={(event) => {
            event.preventDefault()
            add()
          }}
        >
          <input
            type="text"
            aria-label={t('annotation.placeholder')}
            placeholder={t('annotation.placeholder')}
            value={requirement}
            maxLength={ANNOTATION_MAX_TEXT}
            onChange={event => setRequirement(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && event.nativeEvent.isComposing)
                event.preventDefault()
            }}
          />
          <button type="submit" aria-label={t(capturing ? 'annotation.capturing' : 'annotation.add')} title={t(capturing ? 'annotation.capturing' : 'annotation.add')} disabled={!requirement.trim() || capturing || (captures && !image) || items.length >= ANNOTATION_MAX_ITEMS}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m5 12 4 4L19 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        </form>
      )}
      {(active || items.length > 0 || error) && bounds && (
        <div className="dsh-office-annotate-rail-position" style={{ 'left': bounds.left, 'width': bounds.width, 'bottom': Math.max(0, window.innerHeight - bounds.top - bounds.height) + 12, '--dsh-office-annotation-width': `${bounds.width}px`, '--dsh-office-annotation-height': `${bounds.height}px` } as CSSProperties}>
          <div className="dsh-office-annotate-rail">
            {error && <p role="alert">{error}</p>}
            <div className="dsh-office-annotate-rail-actions">
              <div
                className="dsh-office-annotate-summary"
                data-dismissed={summaryDismissed ? 'true' : undefined}
                onPointerEnter={() => setSummaryDismissed(false)}
                onFocus={() => setSummaryDismissed(false)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.stopPropagation()
                    event.currentTarget.querySelector('button')?.focus()
                    setSummaryDismissed(true)
                  }
                }}
              >
                <button type="button" aria-haspopup="dialog" aria-controls={summaryId} disabled={!items.length}>{fillTemplate(t('annotation.count'), { count: String(items.length) })}</button>
                {items.length > 0 && (
                  <div id={summaryId} role="dialog" aria-label={fillTemplate(t('annotation.count'), { count: String(items.length) })} className="dsh-office-annotate-popover">
                    <ul>
                      {items.map((item, index) => (
                        <li key={item.annotation.imageName ?? index}>
                          <div>
                            <span className="dsh-office-annotation-source">
                              <span title={item.annotation.target}>{item.annotation.fileName}</span>
                              {item.annotation.page && <span>{fillTemplate(t('annotation.page'), { page: String(item.annotation.page) })}</span>}
                            </span>
                            {item.annotation.text && <span className="dsh-office-annotation-original">{item.annotation.text}</span>}
                            <span className="dsh-office-annotation-requirement" title={item.annotation.requirement}>{item.annotation.requirement}</span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setItems([])
                  setActive(false)
                  setSummaryDismissed(false)
                  setError('')
                  dismiss()
                  cancelGesture()
                }}
              >
                {t('annotation.cancel')}
              </button>
              <button type="button" className="dsh-office-annotate-primary" disabled={!items.length || disabled} onClick={send}>{t('annotation.send')}</button>
            </div>
          </div>
        </div>
      )}
    </span>
  )
}

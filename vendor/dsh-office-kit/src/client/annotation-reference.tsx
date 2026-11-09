import type { UserTextNodeProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ReactElement } from 'react'
import type { OFFICE_NS } from './constants'
import type { AnnotationInjected } from './types'
import { useId, useLayoutEffect, useRef, useState } from 'react'
import { annotationPopoverPosition } from './annotation'
import { fillTemplate } from './quote'

type Props = UserTextNodeProps<'officeAnnotation'> & PropsLocale<typeof OFFICE_NS> & Pick<AnnotationInjected, 'openAnnotation'>

/** The native top layer escapes chat clipping without moving UI outside its slot. */
export function AnnotationReference({ node, interactive, openAnnotation, t }: Props): ReactElement {
  const popupId = useId()
  const anchor = useRef<HTMLSpanElement>(null)
  const popup = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  const label = fillTemplate(t('annotation.count'), { count: String(node.data.items.length) })

  useLayoutEffect(() => {
    const element = popup.current
    const trigger = anchor.current
    if (!element || !trigger)
      return
    if (!open) {
      element.hidePopover?.()
      return
    }
    element.showPopover?.()
    const position = (): void => {
      const viewport = { width: document.documentElement.clientWidth, height: window.innerHeight }
      const { left, top } = annotationPopoverPosition(trigger.getBoundingClientRect(), element.getBoundingClientRect(), viewport)
      element.style.left = `${left}px`
      element.style.top = `${top}px`
    }
    const scroll = (event: Event): void => {
      if (event.target instanceof Node && element.contains(event.target))
        return
      setOpen(false)
    }
    const resize = new ResizeObserver(position)
    resize.observe(trigger)
    resize.observe(element)
    window.addEventListener('resize', position)
    document.addEventListener('scroll', scroll, true)
    position()
    return () => {
      element.hidePopover?.()
      resize.disconnect()
      window.removeEventListener('resize', position)
      document.removeEventListener('scroll', scroll, true)
    }
  }, [open])

  return (
    <span
      ref={anchor}
      className="dsh-office-annotation-reference"
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={(event) => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget))
          setOpen(false)
      }}
      onFocus={() => setOpen(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setOpen(false)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          if (popup.current?.contains(event.target as Node))
            anchor.current?.querySelector('button')?.focus()
          setOpen(false)
        }
      }}
    >
      <button type="button" id={`${popupId}-trigger`} aria-haspopup="dialog" aria-controls={popupId} aria-expanded={open}>{label}</button>
      <span ref={popup} {...{ popover: 'manual' }} className="dsh-office-annotation-popover" data-open={open} id={popupId} role="dialog" aria-labelledby={`${popupId}-trigger`}>
        <span className="dsh-office-annotation-list">
          {node.data.items.map((item, index) => (
            <span className="dsh-office-annotation-item" key={index}>
              <span className="dsh-office-annotation-source">
                {interactive
                  ? <button type="button" onClick={() => openAnnotation(item.target)} title={item.target}>{item.fileName}</button>
                  : <span>{item.fileName}</span>}
              </span>
              <span className="dsh-office-annotation-requirement">{item.requirement}</span>
            </span>
          ))}
        </span>
      </span>
    </span>
  )
}

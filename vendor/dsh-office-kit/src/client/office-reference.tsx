import type { UserTextNodeProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ReactElement } from 'react'
import type { OfficeChipInjected } from './types'
import { featureById } from '../features'
import { OFFICE_ICONS } from './icons'

type Props = UserTextNodeProps<'office'> & OfficeChipInjected

/** Render the office reference chip with its format glyph. */
export function OfficeReference({ node, raw, interactive, openOffice, officeLabel }: Props): ReactElement {
  const feature = featureById(node.data.feature)
  if (feature == null)
    return <span>{raw}</span>

  const Icon = OFFICE_ICONS[feature.id]
  const title = `/${feature.command}`
  const content = (
    <>
      <Icon className="dsh-office-ref-icon" size={14} />
      <span>{officeLabel(feature.id)}</span>
    </>
  )

  if (!interactive) {
    return (
      <span className="dsh-office-ref" title={title}>
        {content}
      </span>
    )
  }

  return (
    <button
      type="button"
      className="dsh-office-ref"
      title={title}
      data-interactive
      onClick={() => openOffice(feature.id)}
    >
      {content}
    </button>
  )
}

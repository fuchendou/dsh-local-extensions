import type { ReactElement, SVGProps } from 'react'
import type { OfficeFeatureId } from '../features'

/*
 * Icons from Gravity UI Icons (MIT), https://github.com/gravity-ui/icons.
 * The original SVG files and license are vendored in assets/icons/.
 */

type OfficeIconProps = SVGProps<SVGSVGElement> & { size?: number }

function frame(props: OfficeIconProps): SVGProps<SVGSVGElement> {
  const { size = 16, ...rest } = props
  return {
    'width': size,
    'height': size,
    'viewBox': '0 0 16 16',
    'fill': 'none',
    'aria-hidden': true,
    ...rest,
  }
}

/** file-text: a document page with text lines. */
export function DocumentsIcon(props: OfficeIconProps): ReactElement {
  return (
    <svg {...frame(props)}>
      <path
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M5 13.5h6a1.5 1.5 0 0 0 1.5-1.5V7.243a1.5 1.5 0 0 0-.44-1.061L8.819 2.939a1.5 1.5 0 0 0-1.06-.439H5A1.5 1.5 0 0 0 3.5 4v8A1.5 1.5 0 0 0 5 13.5m9-6.257a3 3 0 0 0-.879-2.122L9.88 1.88A3 3 0 0 0 7.757 1H5a3 3 0 0 0-3 3v8a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3zM5 8.25a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5A.75.75 0 0 1 5 8.25m.75 2.25a.75.75 0 0 0 0 1.5h2.5a.75.75 0 0 0 0-1.5z"
      />
    </svg>
  )
}

/** file-letter-p: a document page with a P badge. */
export function PdfIcon(props: OfficeIconProps): ReactElement {
  return (
    <svg {...frame(props)}>
      <path
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M11 13.5H5A1.5 1.5 0 0 1 3.5 12V4A1.5 1.5 0 0 1 5 2.5h2.757a1.5 1.5 0 0 1 1.061.44l3.243 3.242a1.5 1.5 0 0 1 .439 1.06V12a1.5 1.5 0 0 1-1.5 1.5m2.121-8.379A3 3 0 0 1 14 7.243V12a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V4a3 3 0 0 1 3-3h2.757a3 3 0 0 1 2.122.879zM6.5 6.5a.75.75 0 0 0-.75.75v4a.75.75 0 0 0 1.5 0v-.75H8.5a2 2 0 1 0 0-4zm2 2.5H7.25V8H8.5a.5.5 0 0 1 0 1"
      />
    </svg>
  )
}

/** display: a presentation screen. */
export function PresentationsIcon(props: OfficeIconProps): ReactElement {
  return (
    <svg {...frame(props)}>
      <path
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 3H4a1.5 1.5 0 0 0-1.5 1.5v4A1.5 1.5 0 0 0 4 10h8a1.5 1.5 0 0 0 1.5-1.5v-4A1.5 1.5 0 0 0 12 3M4 1.5a3 3 0 0 0-3 3v4a3 3 0 0 0 3 3h3.25V13h-2.5a.75.75 0 0 0 0 1.5h6.5a.75.75 0 0 0 0-1.5h-2.5v-1.5H12a3 3 0 0 0 3-3v-4a3 3 0 0 0-3-3z"
      />
    </svg>
  )
}

/** layout-cells: a spreadsheet grid. */
export function SpreadsheetsIcon(props: OfficeIconProps): ReactElement {
  return (
    <svg {...frame(props)}>
      <path
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M9.25 3.5h-2.5v2h2.5zM4 3.5h1.25v2H2.5V5A1.5 1.5 0 0 1 4 3.5M2.5 7h2.75v2H2.5zm0 3.5v.5A1.5 1.5 0 0 0 4 12.5h1.25v-2zm4.25 0v2h2.5v-2zm4 0v2H12a1.5 1.5 0 0 0 1.5-1.5v-.5zM13.5 9h-2.75V7h2.75zM9.25 9h-2.5V7h2.5zm1.5-5.5v2h2.75V5A1.5 1.5 0 0 0 12 3.5zM4 2a3 3 0 0 0-3 3v6a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3V5a3 3 0 0 0-3-3z"
      />
    </svg>
  )
}

export const OFFICE_ICONS: Record<OfficeFeatureId, (props: OfficeIconProps) => ReactElement> = {
  documents: DocumentsIcon,
  pdf: PdfIcon,
  presentations: PresentationsIcon,
  spreadsheets: SpreadsheetsIcon,
}

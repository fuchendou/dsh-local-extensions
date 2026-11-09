/** Stable identifiers for the four Office entry points. */
export type OfficeFeatureId = 'documents' | 'pdf' | 'presentations' | 'spreadsheets'

/** One user-facing Office entry, its skill, and the file types it owns. */
export interface OfficeFeature {
  readonly id: OfficeFeatureId
  /** Friendly name used by the '/' menu, chip, and preview. */
  readonly label: string
  /** One-line menu description. */
  readonly description: string
  /** Detail shown after a chip is inserted. */
  readonly hint: string
  /** Skill registered with the DSH skill registry. */
  readonly skill: string
  /** Slash token without the leading '/'. */
  readonly command: string
  /** File extensions shown in menus and documentation. */
  readonly extensions: readonly string[]
}

/** The four entries, in menu order. */
export const OFFICE_FEATURES: readonly OfficeFeature[] = [
  {
    id: 'documents',
    label: 'Documents',
    description: 'Create, edit, render, and verify Word documents (.docx).',
    hint: 'DOCX',
    skill: 'office-documents',
    command: 'documents',
    extensions: ['.docx'],
  },
  {
    id: 'pdf',
    label: 'PDF',
    description: 'Create, read, edit, render, and verify PDF files.',
    hint: 'PDF',
    skill: 'office-pdf',
    command: 'pdf',
    extensions: ['.pdf'],
  },
  {
    id: 'presentations',
    label: 'Presentations',
    description: 'Create, edit, render, and verify slide decks (.pptx).',
    hint: 'PPTX',
    skill: 'office-presentations',
    command: 'presentations',
    extensions: ['.pptx'],
  },
  {
    id: 'spreadsheets',
    label: 'Spreadsheets',
    description: 'Create, edit, recalculate, render, and verify workbooks (.xlsx).',
    hint: 'XLSX',
    skill: 'office-spreadsheets',
    command: 'spreadsheets',
    extensions: ['.xlsx'],
  },
]

/** Resolve a feature by its stable id; unknown ids are not Office entries. */
export function featureById(id: string): OfficeFeature | undefined {
  return OFFICE_FEATURES.find(feature => feature.id === id)
}

/** Resolve a feature by its slash token (without '/'). */
export function featureByCommand(command: string): OfficeFeature | undefined {
  return OFFICE_FEATURES.find(feature => feature.command === command)
}

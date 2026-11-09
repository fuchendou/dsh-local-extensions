import type { QuotePrompt } from './types'
import { SESSION_FILE_PREFIX } from './constants'

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  }
  catch {
    return segment
  }
}

/** Replace every `{name}` placeholder with its value. */
export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/gu, (match, name: string) => values[name] ?? match)
}

/**
 * Collapse what a PDF text layer emits: one line per visual line, padded with
 * spaces and interleaved empty lines.
 */
export function normalizeSelection(raw: string): string {
  const lines: string[] = []
  for (const line of raw.replace(/\r\n?/gu, '\n').split('\n')) {
    const collapsed = line.replace(/\s+/gu, ' ').trim()
    if (collapsed.length > 0)
      lines.push(collapsed)
  }
  return lines.join('\n')
}

/** Quote each line so the agent reads the selection as the document's own words. */
export function quoteLines(text: string): string {
  return text.split('\n').map(line => `> ${line}`).join('\n')
}

/** Path part of a `scheme://authority/path` address, apart from its origin. */
const PATH_AFTER_ORIGIN = /^(?:[^:/?#]+:)?\/\/[^/]+\/(.*)$/u

function pathOf(address: string): string | undefined {
  return PATH_AFTER_ORIGIN.exec(address)?.[1]
}

/** Last path segment of a preview address: the file's display name. */
export function fileNameOf(address: string | undefined): string | undefined {
  if (address === undefined)
    return undefined
  const segment = pathOf(address)?.split('/').pop()
  if (segment === undefined || segment.length === 0)
    return undefined
  const name = decodeSegment(segment)
  return name.length === 0 ? undefined : name
}

/** Workspace-relative path of a session file address; undefined for other resources. */
export function sessionRelativePath(address: string | undefined): string | undefined {
  if (address === undefined || !address.startsWith(SESSION_FILE_PREFIX))
    return undefined
  const rest = address.slice(SESSION_FILE_PREFIX.length)
  const slash = rest.indexOf('/')
  if (slash < 0)
    return undefined
  const path = rest.slice(slash + 1)
  if (path.length === 0)
    return undefined
  return path.split('/').map(decodeSegment).join('/')
}

/** The message inserted into the composer: target, quoted source, and requirement. */
export function composeQuote(prompt: QuotePrompt): string {
  const title = prompt.pageLabel === undefined ? prompt.target : `${prompt.target} · ${prompt.pageLabel}`
  return [
    `${prompt.heading}${title}`,
    '',
    prompt.originalLabel,
    quoteLines(prompt.text),
    '',
    `${prompt.requirementLabel}${prompt.requirement}`,
  ].join('\n')
}

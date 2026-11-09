import type { UserTextRule } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { OfficeFeature } from '../features'
import { featureByCommand } from '../features'
import { OFFICE_CHIP } from './constants'

/** Model-facing instruction appended to a picked slash token; the transcript hides it. */
export function officeInstruction(feature: OfficeFeature): string {
  return `Use the "${feature.skill}" skill for this request and follow its instructions before creating, editing, or rendering files.`
}

/** What the composer sends for one reference chip: the slash token, then the instruction. */
export function serializeOfficeCommand(feature: OfficeFeature): string {
  return `/${feature.command}\n\n${officeInstruction(feature)}`
}

/** One chip covers the token plus the instruction the composer appended after it. */
export const officeChipRule: UserTextRule<'office'> = {
  id: OFFICE_CHIP,
  order: 20,
  match(text, from) {
    const tokens = /(?<!\S)\/([\w-]+)(?!\S)/gu
    tokens.lastIndex = from
    for (let token = tokens.exec(text); token !== null; token = tokens.exec(text)) {
      const feature = featureByCommand(token[1] ?? '')
      if (feature === undefined)
        continue
      const start = token.index
      const tokenEnd = start + token[0].length
      const rest = text.slice(tokenEnd)
      const lead = rest.length - rest.trimStart().length
      const instruction = officeInstruction(feature)
      return {
        id: OFFICE_CHIP,
        start,
        end: rest.startsWith(instruction, lead) ? tokenEnd + lead + instruction.length : tokenEnd,
        data: { feature: feature.id },
      }
    }
    return undefined
  },
}

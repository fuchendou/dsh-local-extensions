import { describe, expect, it } from 'vitest'
import { officeChipRule, serializeOfficeCommand } from '../src/client/office-chip'
import { featureById, OFFICE_FEATURES } from '../src/features'

const CONTEXT = { read: () => undefined }
const sheets = OFFICE_FEATURES.find(feature => feature.id === 'spreadsheets')!

describe('office chip rule', () => {
  it('covers the whole serialized command so the instruction never renders', () => {
    const text = serializeOfficeCommand(sheets)
    const node = officeChipRule.match(text, 0, CONTEXT)
    expect(node).toEqual({ id: 'office', start: 0, end: text.length, data: { feature: 'spreadsheets' } })
  })

  it('leaves text typed after the chip visible', () => {
    const text = `${serializeOfficeCommand(sheets)} 做成表格`
    const node = officeChipRule.match(text, 0, CONTEXT)
    expect(text.slice(node!.start, node!.end)).toBe(serializeOfficeCommand(sheets))
    expect(text.slice(node!.end)).toBe(' 做成表格')
  })

  it('tolerates any whitespace between the token and the instruction', () => {
    const instruction = serializeOfficeCommand(sheets).slice('/spreadsheets'.length).trimStart()
    for (const gap of [' ', '\n', '\n\n\n']) {
      const text = `/spreadsheets${gap}${instruction}`
      expect(officeChipRule.match(text, 0, CONTEXT)).toMatchObject({ end: text.length })
    }
  })

  it('covers only the token when it was typed by hand', () => {
    for (const text of ['/spreadsheets 做成表格', 'please use /pdf now']) {
      const node = officeChipRule.match(text, 0, CONTEXT)!
      expect(text.slice(node.start, node.end)).toBe(text.includes('/pdf') ? '/pdf' : '/spreadsheets')
    }
  })

  it('ignores unknown commands and embedded slashes', () => {
    expect(officeChipRule.match('/unknown', 0, CONTEXT)).toBeUndefined()
    expect(officeChipRule.match('/spreadsheetsx', 0, CONTEXT)).toBeUndefined()
  })

  it('finds later chips after an accepted node', () => {
    const first = serializeOfficeCommand(sheets)
    const text = `${first}\n\n${serializeOfficeCommand(OFFICE_FEATURES[0]!)}`
    const second = officeChipRule.match(text, first.length, CONTEXT)!
    expect(second.data).toEqual({ feature: featureById('documents')!.id })
  })
})

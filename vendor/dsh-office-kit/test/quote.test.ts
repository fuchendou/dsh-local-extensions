import { describe, expect, it } from 'vitest'
import {
  composeQuote,
  fileNameOf,
  fillTemplate,
  normalizeSelection,
  quoteLines,
  sessionRelativePath,
} from '../src/client/quote'

const RESUME = 'dsh-resource://file/session/s1/%E7%AE%80%E5%8E%86.docx'

describe('selection normalization', () => {
  it('collapses the padding and blank lines a PDF text layer emits', () => {
    expect(normalizeSelection('  拥有10年\n\n  Android  开发\n')).toBe('拥有10年\nAndroid 开发')
  })

  it('quotes one line at a time', () => {
    expect(quoteLines('a\nb')).toBe('> a\n> b')
  })
})

describe('preview addresses', () => {
  it('names a session file', () => {
    expect(fileNameOf(RESUME)).toBe('简历.docx')
    expect(sessionRelativePath(RESUME)).toBe('简历.docx')
  })

  it('decodes nested path segments', () => {
    expect(sessionRelativePath('dsh-resource://file/session/s1/sub/dir%20a/x.pdf')).toBe('sub/dir a/x.pdf')
  })

  it('ignores resources that are not session files', () => {
    expect(sessionRelativePath('dsh-resource://file/other/x.pdf')).toBeUndefined()
    expect(sessionRelativePath(undefined)).toBeUndefined()
    expect(fileNameOf('dsh-resource://file/')).toBeUndefined()
  })
})

describe('quote message', () => {
  it('fills a localized page label', () => {
    expect(fillTemplate('第 {page} 页', { page: '3' })).toBe('第 3 页')
    expect(fillTemplate('page {page}', {})).toBe('page {page}')
  })

  it('carries the target, the quoted source, and the requirement', () => {
    expect(composeQuote({
      target: '简历.docx',
      pageLabel: '第 1 页',
      heading: '请修改这份文档：',
      originalLabel: '原文：',
      requirementLabel: '修改要求：',
      text: '拥有10年\nAndroid 开发',
      requirement: '改成 11 年',
    })).toBe([
      '请修改这份文档：简历.docx · 第 1 页',
      '',
      '原文：',
      '> 拥有10年',
      '> Android 开发',
      '',
      '修改要求：改成 11 年',
    ].join('\n'))
  })
})

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import {
  DEFAULT_CONTENT_WIDTH,
  resolveStoredContentWidth,
  normalizeContentWidth,
  parseContentWidthInput,
  exactContentWidthInput,
} from './contentWidth'

describe('contentWidth', () => {
  test('U1 resolveStoredContentWidth — 정확한 값만 받고 나머지는 기본값', () => {
    const cases: [string | null | undefined, number][] = [
      [null, 800],
      [undefined, 800],
      ['', 800],
      ['600', 600],
      ['800', 800],
      ['1600', 1600],
      ['580', 800],
      ['1620', 800],
      ['1210', 800],
      ['800.5', 800],
      ['abc', 800],
      ['1e3', 1000],
    ]
    for (const [input, expected] of cases) {
      expect(resolveStoredContentWidth(input)).toBe(expected)
    }
  })

  test('U2 normalizeContentWidth — 20 단위 반올림(가운데는 올림) 후 600~1600 으로 자른다', () => {
    const cases: [number, number][] = [
      [599, 600],
      [600, 600],
      [609, 600],
      [610, 620],
      [611, 620],
      [1210, 1220],
      [1234.5, 1240],
      [1600, 1600],
      [1601, 1600],
      [-5, 600],
      [0, 600],
    ]
    for (const [input, expected] of cases) {
      expect(normalizeContentWidth(input)).toBe(expected)
    }
  })

  test('U3 parseContentWidthInput·exactContentWidthInput', () => {
    const parseCases: [string, number | null][] = [
      ['', null],
      ['  ', null],
      ['abc', null],
      ['1e999', null],
      ['1200', 1200],
      [' 1200 ', 1200],
      ['1210', 1220],
      ['5000', 1600],
      ['100', 600],
      ['-5', 600],
      ['1e3', 1000],
    ]
    for (const [input, expected] of parseCases) {
      expect(parseContentWidthInput(input)).toBe(expected)
    }

    const exactCases: [string, number | null][] = [
      ['', null],
      ['1', null],
      ['12', null],
      ['120', null],
      ['1200', 1200],
      ['1210', null],
      ['1700', null],
      ['600', 600],
      ['980', 980],
      ['0800', 800],
    ]
    for (const [input, expected] of exactCases) {
      expect(exactContentWidthInput(input)).toBe(expected)
    }
  })

  test('U4 tokens.css — 첫 :root 블록에 --content-width 기본값과 --content-max 간접 참조', () => {
    const path = fileURLToPath(new URL('../styles/tokens.css', import.meta.url))
    const css = readFileSync(path, 'utf-8')
    const firstRootEnd = css.indexOf('\n}', css.indexOf(':root {'))
    const firstRoot = css.slice(0, firstRootEnd)
    expect(firstRoot).toContain(`--content-width: ${DEFAULT_CONTENT_WIDTH}px;`)
    expect(firstRoot).toContain('--content-max: var(--content-width);')
    expect(firstRoot).not.toContain('--content-max: 800px')
  })
})

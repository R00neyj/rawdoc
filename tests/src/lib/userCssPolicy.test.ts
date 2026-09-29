// 사용자 CSS 상수·상한·스니펫 검증·부팅 모양 A8~A10 (specs/features/F-2094.md 7.3)
import { describe, expect, test } from 'vitest'
import {
  buildUserCssBoot,
  checkSnippetName,
  checkUserCssLimits,
  USER_CSS_ALLOWED_AT_RULES,
  USER_CSS_ALLOWED_RULE_KINDS,
  USER_CSS_CHECKER_VERSION,
  USER_CSS_MAX_BODY_BYTES,
  USER_CSS_MAX_NAME_LENGTH,
  USER_CSS_MAX_SNIPPETS,
  USER_CSS_MAX_TOTAL_BYTES,
  utf8ByteLength,
  validateUserCssSnippets,
} from '../../../src/lib/userCssPolicy'
import type { UserCssCompiled, UserCssSnippet } from '../../../src/lib/userCssPolicy'

describe('F-2094 A8 상수', () => {
  test('상한 값', () => {
    expect(USER_CSS_MAX_SNIPPETS).toBe(50)
    expect(USER_CSS_MAX_TOTAL_BYTES).toBe(262_144)
    expect(USER_CSS_MAX_NAME_LENGTH).toBe(60)
    expect(USER_CSS_MAX_BODY_BYTES).toBe(2 * 262_144 + 16_384)
    expect(USER_CSS_CHECKER_VERSION).toBe(1)
  })

  test('허용 at-규칙 이름은 4.3 표와 순서까지 같다', () => {
    expect(USER_CSS_ALLOWED_AT_RULES).toEqual([
      'media', 'supports', 'container', 'layer', 'scope', 'starting-style',
      'keyframes', '-webkit-keyframes',
      'font-face',
      'page',
      'top-left-corner', 'top-left', 'top-center', 'top-right', 'top-right-corner',
      'bottom-left-corner', 'bottom-left', 'bottom-center', 'bottom-right', 'bottom-right-corner',
      'left-top', 'left-middle', 'left-bottom', 'right-top', 'right-middle', 'right-bottom',
      'charset',
    ])
  })

  test('허용 규칙 종류는 4.7 표와 같다', () => {
    expect(USER_CSS_ALLOWED_RULE_KINDS).toEqual([
      'CSSStyleRule', 'CSSNestedDeclarations', 'CSSMediaRule', 'CSSSupportsRule', 'CSSContainerRule',
      'CSSLayerBlockRule', 'CSSLayerStatementRule', 'CSSKeyframesRule', 'CSSKeyframeRule', 'CSSFontFaceRule',
      'CSSPageRule', 'CSSMarginRule', 'CSSStartingStyleRule', 'CSSScopeRule',
    ])
  })
})

describe('F-2094 A8 utf8ByteLength', () => {
  test('TextEncoder 와 같다', () => {
    const cases: [string, number][] = [['', 0], ['a', 1], ['가', 3], ['😀', 4], ['\uD800', 3], ['\uDC00a', 4], ['a가😀\uD800', 11]]
    for (const [text, bytes] of cases) {
      expect(utf8ByteLength(text)).toBe(bytes)
      expect(utf8ByteLength(text)).toBe(new TextEncoder().encode(text).length)
    }
  })
})

describe('F-2094 A8 checkSnippetName', () => {
  test('5.1 표 순서와 경계', () => {
    expect(checkSnippetName('')).toBe('empty')
    expect(checkSnippetName('가'.repeat(60))).toBeNull()
    expect(checkSnippetName('가'.repeat(61))).toBe('too-long')
    expect(checkSnippetName(' '.repeat(61))).toBe('too-long')
    expect(checkSnippetName(' a')).toBe('untrimmed')
    expect(checkSnippetName('   ')).toBe('untrimmed')
    expect(checkSnippetName('a\tb')).toBe('control')
    expect(checkSnippetName('a\u007Fb')).toBe('control')
    expect(checkSnippetName('a\u009Fb')).toBe('control')
    expect(checkSnippetName('a b')).toBeNull()
    expect(checkSnippetName('어두운 테마')).toBeNull()
  })
})

describe('F-2094 A8 checkUserCssLimits', () => {
  const many = (n: number) => Array.from({ length: n }, () => ({ css: '' }))
  test('개수', () => {
    expect(checkUserCssLimits(many(50))).toBeNull()
    expect(checkUserCssLimits(many(51))).toBe('count')
  })
  test('UTF-8 바이트 합', () => {
    const exact = [{ css: '가'.repeat(80_000) }, { css: 'a'.repeat(262_144 - 240_000) }]
    expect(checkUserCssLimits(exact)).toBeNull()
    expect(checkUserCssLimits([...exact, { css: 'a' }])).toBe('bytes')
    expect(checkUserCssLimits([{ css: '가'.repeat(87_382) }])).toBe('bytes')
  })
  test('51개이면서 초과면 count', () => {
    expect(checkUserCssLimits([...many(50), { css: 'a'.repeat(300_000) }])).toBe('count')
  })
})

const snippet = (i: number, extra: Partial<UserCssSnippet> = {}): UserCssSnippet => ({
  id: i.toString(16).padStart(16, '0'), name: `s${i}`, css: `.a${i} { color: red }`, enabled: true, updatedAt: 1000 + i, ...extra,
})

describe('F-2094 A9 validateUserCssSnippets', () => {
  const invalid = (value: unknown) => {
    const r = validateUserCssSnippets(value)
    return r.ok ? 'ok' : r.error === 'invalid' ? r.field : r.error
  }

  test('배열·길이', () => {
    expect(invalid({})).toBe('snippets')
    expect(invalid(null)).toBe('snippets')
    expect(invalid('[]')).toBe('snippets')
    expect(invalid(Array.from({ length: 51 }, (_, i) => snippet(i)))).toBe('snippets')
    expect(invalid(Array.from({ length: 50 }, (_, i) => snippet(i)))).toBe('ok')
    expect(invalid([])).toBe('ok')
  })

  test('원소 모양과 필드 순서', () => {
    expect(invalid([snippet(0), null])).toBe('snippets[1]')
    expect(invalid([snippet(0), [1]])).toBe('snippets[1]')
    expect(invalid([snippet(0), 'x'])).toBe('snippets[1]')
    expect(invalid([snippet(0), { ...snippet(1), id: 'ABCDEF0123456789' }])).toBe('snippets[1].id')
    expect(invalid([{ ...snippet(0), id: '0'.repeat(15) }])).toBe('snippets[0].id')
    expect(invalid([{ ...snippet(0), id: 1 }])).toBe('snippets[0].id')
    expect(invalid([{ ...snippet(0), id: 'x', name: '' }])).toBe('snippets[0].id')
    expect(invalid([{ ...snippet(0), name: '' }])).toBe('snippets[0].name')
    expect(invalid([{ ...snippet(0), name: 3 }])).toBe('snippets[0].name')
    expect(invalid([{ ...snippet(0), name: ' a' }])).toBe('snippets[0].name')
    expect(invalid([{ ...snippet(0), name: 'a'.repeat(61) }])).toBe('snippets[0].name')
    expect(invalid([{ ...snippet(0), name: 'a\nb', css: 1 }])).toBe('snippets[0].name')
    expect(invalid([{ ...snippet(0), css: 1 }])).toBe('snippets[0].css')
    expect(invalid([{ ...snippet(0), css: 'x', enabled: 'true' }])).toBe('snippets[0].enabled')
    expect(invalid([{ ...snippet(0), updatedAt: -1 }])).toBe('snippets[0].updatedAt')
    expect(invalid([{ ...snippet(0), updatedAt: 1.5 }])).toBe('snippets[0].updatedAt')
    expect(invalid([{ ...snippet(0), updatedAt: 2 ** 53 }])).toBe('snippets[0].updatedAt')
    expect(invalid([{ ...snippet(0), updatedAt: '1' }])).toBe('snippets[0].updatedAt')
    expect(invalid([{ ...snippet(0), updatedAt: 0 }])).toBe('ok')
    const { updatedAt: _omit, ...missing } = snippet(0)
    expect(invalid([missing])).toBe('snippets[0].updatedAt')
  })

  test('같은 id 두 번은 두 번째 원소', () => {
    expect(invalid([snippet(0), snippet(1), { ...snippet(2), id: snippet(0).id }])).toBe('snippets[2].id')
  })

  test('원소 오류가 크기 초과보다 먼저, 크기 초과는 too_large', () => {
    const big = [snippet(0, { css: 'a'.repeat(200_000) }), snippet(1, { css: 'a'.repeat(62_145) })]
    expect(invalid(big)).toBe('too_large')
    expect(invalid([...big.slice(0, 1), snippet(1, { css: 'a'.repeat(62_144) })])).toBe('ok')
    expect(invalid([...big, { ...snippet(2), name: '' }])).toBe('snippets[2].name')
  })

  test('모르는 키를 버린 새 객체, 입력 불변', () => {
    const input = [{ ...snippet(0), extra: 1, __proto__x: 2 }, snippet(1, { enabled: false })]
    const before = JSON.stringify(input)
    const r = validateUserCssSnippets(input)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.snippets).toEqual([snippet(0), snippet(1, { enabled: false })])
    expect(Object.keys(r.snippets[0])).toEqual(['id', 'name', 'css', 'enabled', 'updatedAt'])
    expect(r.snippets[0]).not.toBe(input[0])
    expect(JSON.stringify(input)).toBe(before)
  })
})

describe('F-2094 A10 buildUserCssBoot', () => {
  const compile = (source: string): UserCssCompiled => ({ css: source === 'EMPTY' ? '' : `C:${source}`, ruleCount: 1, removed: [] })
  const s = (i: number, css: string, enabled = true) => snippet(i, { css, enabled })

  test('켠 것만 목록 순서대로, 빈 결과도 자리를 지킨다', () => {
    const boot = buildUserCssBoot([s(0, 'a'), s(1, 'b', false), s(2, 'EMPTY'), s(3, 'd')], null, compile)
    expect(boot).toEqual({ v: USER_CSS_CHECKER_VERSION, local: ['C:a', '', 'C:d'], account: null })
  })

  test('계정 슬롯', () => {
    const boot = buildUserCssBoot([], { userId: 'u1', snippets: [s(0, 'x', false), s(1, 'y')] }, compile)
    expect(boot).toEqual({ v: 1, local: [], account: { userId: 'u1', sheets: ['C:y'] } })
  })
})

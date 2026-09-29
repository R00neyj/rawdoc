// 보조 검증 A11 — 가짜 시트 (specs/features/F-2094.md 7.4)
import { describe, expect, test } from 'vitest'
import { compileUserCss } from '../../../src/app/userCssCompile'
import type { CssRuleLike, CssSheetLike } from '../../../src/app/userCssCompile'
import { filterUserCss } from '../../../src/lib/userCssFilter'

const UNSTABLE = { reason: 'unstable', rule: '', property: null }

function rule(kind: string, cssText: string, children?: CssRuleLike[]): CssRuleLike {
  return { cssText, cssRules: children, [Symbol.toStringTag]: kind } as CssRuleLike
}

function fakeSheet(rules: CssRuleLike[]) {
  const received: string[] = []
  const sheet: CssSheetLike = {
    replaceSync(text: string) { received.push(text) },
    cssRules: rules,
  }
  return { sheet, received }
}

const SOURCE = '.a { color: red; background: url(http://e/x) }\r\n@media print { .b { color: blue } }\n@import "x.css";'

describe('F-2094 A11 보조 검증', () => {
  test('직렬화가 깨끗하면 원문 보존본과 최상위 규칙 수', () => {
    const { sheet, received } = fakeSheet([
      rule('CSSStyleRule', '.a { color: red; }'),
      rule('CSSMediaRule', '@media print {\n  .b { color: blue; }\n}', [rule('CSSStyleRule', '.b { color: blue; }')]),
    ])
    const filtered = filterUserCss(SOURCE)
    const out = compileUserCss(SOURCE, () => sheet)
    expect(out).toEqual({ css: filtered.css, ruleCount: 2, removed: filtered.removed })
    expect(out.removed.map((r) => r.reason)).toEqual(['url', 'import'])
    expect(received).toEqual([filtered.css])
  })

  test('브라우저 직렬화에서 금지 토큰이 보이면 통째로 버린다', () => {
    const { sheet } = fakeSheet([
      rule('CSSStyleRule', '.a { color: red; }'),
      rule('CSSStyleRule', '.d { background-image: url("http://e/x"); }'),
    ])
    const filtered = filterUserCss(SOURCE)
    expect(compileUserCss(SOURCE, () => sheet)).toEqual({ css: '', ruleCount: 0, removed: [...filtered.removed, UNSTABLE] })
  })

  test('허용 밖 규칙 종류면 버린다 — 중첩 자식에서도', () => {
    const top = fakeSheet([rule('CSSStyleRule', '.a { color: red; }'), rule('CSSFunctionRule', '@function --f() { }')])
    expect(compileUserCss('.a { color: red }', () => top.sheet)).toEqual({ css: '', ruleCount: 0, removed: [UNSTABLE] })
    const nested = fakeSheet([
      rule('CSSMediaRule', '@media print { }', [rule('CSSStyleRule', '.b { }', [rule('CSSPropertyRule', '@property --p { }')])]),
    ])
    expect(compileUserCss('.a { color: red }', () => nested.sheet)).toEqual({ css: '', ruleCount: 0, removed: [UNSTABLE] })
  })

  test('createSheet·replaceSync·cssRules 가 던져도 compileUserCss 는 던지지 않는다', () => {
    const src = '.a { background: url(http://e/x) }'
    const expected = { css: '', ruleCount: 0, removed: [...filterUserCss(src).removed, UNSTABLE] }
    expect(compileUserCss(src, () => { throw new Error('no sheet') })).toEqual(expected)
    const throwing: CssSheetLike = { replaceSync() { throw new DOMException('x') }, cssRules: [] }
    expect(compileUserCss(src, () => throwing)).toEqual(expected)
    const badRules = { replaceSync() {}, get cssRules(): ArrayLike<CssRuleLike> { throw new Error('x') } }
    expect(compileUserCss(src, () => badRules)).toEqual(expected)
  })

  test('필터 결과가 비었거나 주석뿐이면 시트를 만들지 않는다', () => {
    let made = 0
    const create = () => { made++; return fakeSheet([]).sheet }
    expect(compileUserCss('', create)).toEqual({ css: '', ruleCount: 0, removed: [] })
    expect(compileUserCss(' /* x */ \n', create)).toEqual({ css: ' /* x */ \n', ruleCount: 0, removed: [] })
    const imp = compileUserCss('@import "x.css";', create)
    expect(imp).toEqual({ css: '', ruleCount: 0, removed: filterUserCss('@import "x.css";').removed })
    expect(made).toBe(0)
  })
})

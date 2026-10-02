// F-2118 A2~A6
import { describe, expect, it } from 'vitest'
import brand from '../../../brand.config'
import { SITE_URL } from '../../../src/lib/siteMeta'
import { fenceSource, SYNTAX_GROUPS } from '../../../src/lib/markdownSyntax'
import { APP_SYNTAX_GROUPS, renderSyntaxMarkdown, syntaxJson } from '../../../cli/src/syntax'

const md = renderSyntaxMarkdown('9.9.9')

describe('F-2118 syntax 출력', () => {
  it('A2 모든 항목 원문이 들어 있고 결과 예시·사용법 글 줄은 없다', () => {
    for (const g of SYNTAX_GROUPS) for (const item of g.items) expect(md).toContain(fenceSource(item.source))
    expect(md.split('**굵게**').length - 1).toBe(1)
    expect(md).not.toContain('사용법 글:')
  })

  it('A3 이 앱의 문법이 먼저, 제목 순서는 APP_SYNTAX_GROUPS', () => {
    const a = md.indexOf('## 이 앱의 문법')
    const b = md.indexOf('## 일반 마크다운')
    expect(a).toBeGreaterThan(-1)
    expect(b).toBeGreaterThan(a)
    const titles = [...md.slice(a, b).matchAll(/^### (.+)$/gm)].map((m) => m[1])
    expect(titles).toEqual(APP_SYNTAX_GROUPS)
    const names = SYNTAX_GROUPS.map((g) => g.group)
    for (const n of APP_SYNTAX_GROUPS) expect(names).toContain(n)
    for (const g of SYNTAX_GROUPS.filter((x) => x.cliOnly)) expect(APP_SYNTAX_GROUPS).toContain(g.group)
  })

  it('A4 마지막 줄이 판 번호와 최신 문법 주소', () => {
    const last = md.trimEnd().split('\n').pop()
    expect(last).toBe(`${brand.cliName} 9.9.9 기준입니다. 최신 문법은 ${new URL('help', SITE_URL).href} 에서 봅니다.`)
  })

  it('A5 CR 없음, 끝 개행 하나, 2000자 이하, cliNote 모두 포함', () => {
    expect(md).not.toContain('\r')
    expect(md.endsWith('\n')).toBe(true)
    expect(md.endsWith('\n\n')).toBe(false)
    expect([...md].length).toBeLessThanOrEqual(2000)
    const notes = SYNTAX_GROUPS.filter((g) => g.cliNote)
    expect(notes.length).toBe(4)
    for (const g of notes) expect(md).toContain(g.cliNote!)
  })

  it('A6 json 첫 그룹은 콜아웃·appOnly', () => {
    const j = syntaxJson('9.9.9')
    expect(j.version).toBe('9.9.9')
    expect(j.groups[0].group).toBe('콜아웃')
    expect(j.groups[0].appOnly).toBe(true)
    expect(j.groups.find((g) => g.group === '제목')!.appOnly).toBe(false)
  })
})

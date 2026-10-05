// F-2118 A11~A13
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import brand from '../../../brand.config'
import { fenceSource, SYNTAX_GROUPS } from '../../../src/lib/markdownSyntax'
import { HELP_DOC_CONTENT } from '../../../src/app/helpDoc'
import { KIND_ALIASES, parseCalloutHeader } from '../../../src/lib/callout'
import { HIGHLIGHT_LANG_LABELS, isMermaidInfo } from '../../../src/lib/codeLang'

// site/guard.ts MERMAID_FENCE_RE 와 같은 패턴 (비공개라 복사)
const MERMAID_FENCE_RE = /^ {0,3}`{3,}\s*mermaid\b/im

describe('F-2118 markdownSyntax', () => {
  it('A11 도움말에 cliOnly 그룹과 mermaid 펜스가 없고 나머지 그룹·펜스는 모두 있다', () => {
    expect(HELP_DOC_CONTENT).not.toContain('## 다이어그램')
    expect(MERMAID_FENCE_RE.test(HELP_DOC_CONTENT)).toBe(false)
    for (const g of SYNTAX_GROUPS.filter((x) => !x.cliOnly)) {
      expect(HELP_DOC_CONTENT).toContain(`## ${g.group}`)
      for (const item of g.items) expect(HELP_DOC_CONTENT).toContain(fenceSource(item.source))
    }
    expect(SYNTAX_GROUPS.some((g) => g.cliOnly)).toBe(true)
  })

  it('A12 콜아웃 원문은 콜아웃으로 읽히고 cliNote 의 종류 이름은 별칭 키, 다이어그램 펜스는 mermaid', () => {
    const callout = SYNTAX_GROUPS.find((g) => g.group === '콜아웃')!
    const first = callout.items[0].source.split('\n')[0].replace(/^> /, '')
    expect(parseCalloutHeader(first)).not.toBeNull()
    const codes = [...callout.cliNote!.matchAll(/`([^`]+)`/g)].map((m) => m[1]).filter((c) => c !== ']')
    expect(codes.length).toBeGreaterThan(0)
    for (const c of codes) expect(Object.keys(KIND_ALIASES)).toContain(c)
    const diagram = SYNTAX_GROUPS.find((g) => g.group === '다이어그램')!
    expect(diagram.cliOnly).toBe(true)
    expect(isMermaidInfo(diagram.items[0].source.split('\n')[0].replace(/^`+/, ''))).toBe(true)
  })

  it('A13 markdownSyntax.ts 에 제품명 값이 없다', () => {
    const text = readFileSync(fileURLToPath(new URL('../../../src/lib/markdownSyntax.ts', import.meta.url)), 'utf-8')
    expect(text.includes(brand.name)).toBe(false)
    expect(text.includes(brand.cliName)).toBe(false)
  })

  it('F-2126 A5 코드블록 캡션이 언어 목록을 담고 도움말에 있다', () => {
    const item = SYNTAX_GROUPS.find((g) => g.group === '코드블록')!.items[0]
    expect(item.caption).toBe(
      `언어 자리에 \`ts\`·\`py\`·\`sh\`처럼 적으면 편집·원문·보기 모드와 인쇄·HTML 파일에서 구문에 색이 입혀집니다. 원문은 바뀌지 않습니다. 색을 입히는 언어: ${HIGHLIGHT_LANG_LABELS.join('·')}.`,
    )
    expect(HELP_DOC_CONTENT).toContain(item.caption!)
  })
})

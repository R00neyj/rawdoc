import { describe, expect, it } from 'vitest'
import { PALETTE_COMMANDS } from './paletteCommands'
import type { PaletteContext } from './paletteContract'
import type { TemplateEntry } from '../lib/templates'

function ctx(templates: readonly TemplateEntry[]): PaletteContext {
  return {
    canInsertTemplate: true,
    canPrint: true,
    templates,
    insertTemplate: async () => {},
    printDoc: () => {},
  }
}

describe('PALETTE_COMMANDS — U3 (F-2022.md 11.1)', () => {
  it('id 가 순서대로, 겹치지 않고, 영역.동작 모양', () => {
    const ids = PALETTE_COMMANDS.map((c) => c.id)
    expect(ids).toEqual(['template.insert', 'doc.print'])
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^[a-z]+(\.[a-z-]+)+$/)
  })

  // F-2037.md 9장 — 폴더 줄은 사용자 템플릿이 없을 때만, 변수·도움말 줄은 늘(U5)
  it('template.insert 의 hint — 폴더 줄은 사용자 템플릿이 없을 때만, 변수·도움말 줄은 늘', () => {
    const cmd = PALETTE_COMMANDS.find((c) => c.id === 'template.insert')
    if (!cmd || cmd.kind !== 'pick' || !cmd.hint) throw new Error('template.insert not found')

    const folderLine = "최상위에 '템플릿' 폴더를 만들고 문서를 넣으면 여기에 함께 나옵니다."
    const varsLine = '{{date}}·{{time}}·{{title}}은 넣을 때 오늘 날짜·지금 시각·문서 제목으로 바뀝니다. {{date:YYYY.MM.DD}}처럼 형식을 붙일 수도 있습니다.'
    const helpLine = "자세한 내용은 도움말의 '템플릿' 절에 있습니다."

    const noDocTemplates: TemplateEntry[] = [{ id: 'builtin:meeting', title: '회의록', detail: '내장', source: { kind: 'builtin', body: '' } }]
    const noDocHint = cmd.hint(ctx(noDocTemplates))
    expect(noDocHint).toBe([folderLine, varsLine, helpLine].join('\n'))
    expect(noDocHint).not.toBeNull()

    const withDocTemplate: TemplateEntry[] = [
      { id: 'doc:1', title: '주간 보고', detail: '템플릿', source: { kind: 'doc', docId: '1' } },
      ...noDocTemplates,
    ]
    const withDocHint = cmd.hint(ctx(withDocTemplate))
    expect(withDocHint).toBe([varsLine, helpLine].join('\n'))
    expect(withDocHint).not.toBeNull()
  })
})

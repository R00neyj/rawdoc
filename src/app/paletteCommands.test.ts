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

  it('template.insert 의 hint 는 사용자 템플릿이 없을 때만 뜬다', () => {
    const cmd = PALETTE_COMMANDS.find((c) => c.id === 'template.insert')
    if (!cmd || cmd.kind !== 'pick' || !cmd.hint) throw new Error('template.insert not found')

    const noDocTemplates: TemplateEntry[] = [{ id: 'builtin:meeting', title: '회의록', detail: '내장', source: { kind: 'builtin', body: '' } }]
    expect(cmd.hint(ctx(noDocTemplates))).toBe("최상위에 '템플릿' 폴더를 만들고 문서를 넣으면 여기에 함께 나옵니다.")

    const withDocTemplate: TemplateEntry[] = [
      { id: 'doc:1', title: '주간 보고', detail: '템플릿', source: { kind: 'doc', docId: '1' } },
      ...noDocTemplates,
    ]
    expect(cmd.hint(ctx(withDocTemplate))).toBeNull()
  })
})

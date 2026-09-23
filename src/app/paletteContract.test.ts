import { describe, expect, it } from 'vitest'
import { visibleCommands, filterPaletteItems, type PaletteCommand, type PaletteContext, type PaletteItem } from './paletteContract'

function ctx(overrides: Partial<PaletteContext> = {}): PaletteContext {
  return {
    canInsertTemplate: true,
    canPrint: true,
    templates: [],
    insertTemplate: async () => {},
    printDoc: () => {},
    ...overrides,
  }
}

describe('filterPaletteItems — U1 (F-2022.md 11.1)', () => {
  const items: PaletteItem[] = [
    { id: 'c', label: '새 템플릿', detail: '내장' },
    { id: 'a', label: '템플릿 삽입', keywords: ['template'] },
    { id: 'b', label: 'PDF (A4 인쇄)', keywords: ['print'] },
  ]

  it('빈 검색어는 원래 순서 전부', () => {
    expect(filterPaletteItems(items, '').map((i) => i.id)).toEqual(['c', 'a', 'b'])
  })

  it("'템플' — label 머리 일치(a)가 앞으로", () => {
    expect(filterPaletteItems(items, '템플').map((i) => i.id)).toEqual(['a', 'c'])
  })

  it("'TEMPLATE' — 대소문자 무시, keyword 매칭", () => {
    expect(filterPaletteItems(items, 'TEMPLATE').map((i) => i.id)).toEqual(['a'])
  })

  it("'pdf 인쇄' — 여러 조각 AND", () => {
    expect(filterPaletteItems(items, 'pdf 인쇄').map((i) => i.id)).toEqual(['b'])
  })

  it("'인쇄 없음' — 한 조각도 없으면 빈 배열", () => {
    expect(filterPaletteItems(items, '인쇄 없음').map((i) => i.id)).toEqual([])
  })

  it("'내장' — detail 매칭", () => {
    expect(filterPaletteItems(items, '내장').map((i) => i.id)).toEqual(['c'])
  })

  it("'템플'.normalize('NFD') — NFC 로 정규화해 같은 결과", () => {
    expect(filterPaletteItems(items, '템플'.normalize('NFD')).map((i) => i.id)).toEqual(['a', 'c'])
  })
})

describe('visibleCommands — U2 (F-2022.md 11.1)', () => {
  const insertCmd: PaletteCommand = {
    id: 'template.insert',
    kind: 'pick',
    label: '템플릿 삽입',
    when: (c) => c.canInsertTemplate,
    stageTitle: '',
    placeholder: '',
    emptyText: '',
    items: () => [],
    pick: () => {},
  }
  const printCmd: PaletteCommand = {
    id: 'doc.print',
    kind: 'action',
    label: 'PDF (A4 인쇄)',
    when: (c) => c.canPrint,
    run: () => {},
  }
  const commands = [insertCmd, printCmd]

  it('둘 다 참이면 등록 순서대로 둘 다', () => {
    expect(visibleCommands(commands, ctx({ canInsertTemplate: true, canPrint: true })).map((c) => c.id)).toEqual(['template.insert', 'doc.print'])
  })

  it('템플릿만 참', () => {
    expect(visibleCommands(commands, ctx({ canInsertTemplate: true, canPrint: false })).map((c) => c.id)).toEqual(['template.insert'])
  })

  it('인쇄만 참', () => {
    expect(visibleCommands(commands, ctx({ canInsertTemplate: false, canPrint: true })).map((c) => c.id)).toEqual(['doc.print'])
  })

  it('둘 다 거짓이면 빈 배열', () => {
    expect(visibleCommands(commands, ctx({ canInsertTemplate: false, canPrint: false }))).toEqual([])
  })
})

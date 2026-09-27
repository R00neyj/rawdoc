import { describe, expect, it } from 'vitest'
import {
  visibleCommands,
  filterPaletteItems,
  parsePaletteQuery,
  buildPaletteSections,
  type PaletteCommand,
  type PaletteContext,
  type PaletteItem,
  type PaletteDoc,
} from './paletteContract'
import { prepareDocIndex } from './paletteDocs'

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

describe('filterPaletteItems — U2 3단 순서 (F-2053.md 11.1)', () => {
  it("'pdf' — 머리(p) → 라벨 안(m) → 키워드(k)", () => {
    const items: PaletteItem[] = [
      { id: 'k', label: '인쇄 설정', keywords: ['pdf'] },
      { id: 'm', label: '새 PDF' },
      { id: 'p', label: 'PDF (A4 인쇄)' },
    ]
    expect(filterPaletteItems(items, 'pdf').map((i) => i.id)).toEqual(['p', 'm', 'k'])
  })

  it("'ㅌㅍㄹ' 초성 — 라벨 안(t) → 키워드(x)", () => {
    const items: PaletteItem[] = [
      { id: 't', label: '템플릿 삽입' },
      { id: 'x', label: '삽입', keywords: ['템플릿'] },
    ]
    expect(filterPaletteItems(items, 'ㅌㅍㄹ').map((i) => i.id)).toEqual(['t', 'x'])
  })
})

describe('parsePaletteQuery — U3 (F-2053.md 11.1)', () => {
  it.each([
    ['', { mode: 'all', text: '' }],
    ['>', { mode: 'commands', text: '' }],
    ['  > 인쇄', { mode: 'commands', text: ' 인쇄' }],
    ['>>인쇄', { mode: 'commands', text: '>인쇄' }],
    ['＞인쇄', { mode: 'all', text: '＞인쇄' }],
    ['a>b', { mode: 'all', text: 'a>b' }],
  ] as const)('%p → %p', (raw, expected) => {
    expect(parsePaletteQuery(raw)).toEqual(expected)
  })
})

describe('buildPaletteSections — U4 (F-2053.md 11.1)', () => {
  const cmd = (id: string, label: string): PaletteCommand => ({
    id,
    kind: 'action',
    label,
    when: () => true,
    run: () => {},
  })
  const commands = [cmd('a', '명령 a'), cmd('b', '명령 b'), cmd('c', '명령 c'), cmd('d', '명령 d')]
  const pinnedIds = ['c', 'zz']
  const recentIds = ['c', 'b', 'a', 'e', 'f', 'g']
  const makeDoc = (id: string, title: string): PaletteDoc => ({ id, title, folderPath: '', shared: false })
  const recentDocs = [makeDoc('r1', '최근 1'), makeDoc('r2', '최근 2')]
  const memoDocs = Array.from({ length: 8 }, (_, i) => makeDoc(`m${i + 1}`, `메모 ${i + 1}`))
  const docsIndex = prepareDocIndex(memoDocs)

  function sectionMap(sections: ReturnType<typeof buildPaletteSections>) {
    return new Map(sections.map((s) => [s.key, s]))
  }

  it('① all 빈 입력 — pinned·recent·recentDocs·commands 구역', () => {
    const sections = buildPaletteSections({
      query: { mode: 'all', text: '' },
      commands,
      pinnedIds,
      recentIds,
      docs: docsIndex,
      recentDocs,
      createPlan: null,
    })
    const map = sectionMap(sections)
    expect(map.get('pinned')!.rows.map((r) => r.key)).toEqual(['c'])
    expect(map.get('recent')!.rows.map((r) => r.key)).toEqual(['b', 'a'])
    expect(map.get('recentDocs')!.rows.map((r) => r.key)).toEqual(['doc:r1', 'doc:r2'])
    expect(map.get('commands')!.rows.map((r) => r.key)).toEqual(['d'])
    expect(sections.map((s) => s.heading)).toEqual(['고정', '최근', '최근 문서', '명령'])
    const allIds = sections.flatMap((s) => s.rows.map((r) => r.key))
    expect(new Set(allIds).size).toBe(allIds.length)
  })

  it('② commands 빈 입력 — pinned·recent·commands 만, recentDocs 없음', () => {
    const sections = buildPaletteSections({
      query: { mode: 'commands', text: '' },
      commands,
      pinnedIds,
      recentIds,
      docs: docsIndex,
      recentDocs,
      createPlan: null,
    })
    const map = sectionMap(sections)
    expect(map.get('pinned')!.rows.map((r) => r.key)).toEqual(['c'])
    expect(map.get('recent')!.rows.map((r) => r.key)).toEqual(['b', 'a'])
    expect(map.get('commands')!.rows.map((r) => r.key)).toEqual(['d'])
    expect(map.has('recentDocs')).toBe(false)
  })

  it('③ all 입력 있음(메모) — docs(6개, 입력 순서) → create, 명령 구역 없음', () => {
    const sections = buildPaletteSections({
      query: { mode: 'all', text: '메모' },
      commands,
      pinnedIds,
      recentIds,
      docs: docsIndex,
      recentDocs,
      createPlan: { title: '메모', folderId: null, folderPath: '' },
    })
    const map = sectionMap(sections)
    expect(map.get('docs')!.rows.map((r) => r.key)).toEqual(['doc:m1', 'doc:m2', 'doc:m3', 'doc:m4', 'doc:m5', 'doc:m6'])
    expect(map.get('create')!.heading).toBeNull()
    expect(map.has('commands')).toBe(false)
    expect(sections.map((s) => s.key)).toEqual(['docs', 'create'])
  })

  it('④ commands 입력 있음(메모) — commands 구역만, 명령 없으면 빈 배열', () => {
    const sections = buildPaletteSections({
      query: { mode: 'commands', text: '메모' },
      commands,
      pinnedIds,
      recentIds,
      docs: docsIndex,
      recentDocs,
      createPlan: null,
    })
    expect(sections).toEqual([])
  })

  it('⑤ all 빈 입력, docs 가 null — recentDocs 구역 없음', () => {
    const sections = buildPaletteSections({
      query: { mode: 'all', text: '' },
      commands,
      pinnedIds,
      recentIds,
      docs: null,
      recentDocs: [],
      createPlan: null,
    })
    const map = sectionMap(sections)
    expect(map.has('recentDocs')).toBe(false)
  })

  it('⑥ 명령 0개·최근 문서 0개인 all 빈 입력 — 빈 배열', () => {
    const sections = buildPaletteSections({
      query: { mode: 'all', text: '' },
      commands: [],
      pinnedIds: [],
      recentIds: [],
      docs: docsIndex,
      recentDocs: [],
      createPlan: null,
    })
    expect(sections).toEqual([])
  })

  it('⑦ all 공백만 입력 — 빈 입력과 같은 구역(pinned·recent·recentDocs·commands) (main 결정 2026-09-28)', () => {
    const sections = buildPaletteSections({
      query: { mode: 'all', text: '   ' },
      commands,
      pinnedIds,
      recentIds,
      docs: docsIndex,
      recentDocs,
      createPlan: null,
    })
    const map = sectionMap(sections)
    expect(map.get('pinned')!.rows.map((r) => r.key)).toEqual(['c'])
    expect(map.get('recent')!.rows.map((r) => r.key)).toEqual(['b', 'a'])
    expect(map.get('recentDocs')!.rows.map((r) => r.key)).toEqual(['doc:r1', 'doc:r2'])
    expect(map.has('docs')).toBe(false)
    expect(map.has('create')).toBe(false)
  })
})

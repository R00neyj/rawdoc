// 서식·단락·삽입 팔레트 명령 — specs/features/F-2055.md 10.1 U3~U5
import { describe, expect, it } from 'vitest'
import type { StateCommand } from '@codemirror/state'

import { EDITOR_COMMANDS, type EditorCommandGates } from '../../../src/app/contextMenuItems'
import { EDITOR_PALETTE_COMMANDS } from '../../../src/app/paletteEditorCommands'
import { filterPaletteItems, visibleCommands, type PaletteContext } from '../../../src/app/paletteContract'
import { insertTable } from '../../../src/editor/insertCommands'

const PALETTE_ID_RE = /^[a-z][a-z0-9]*(\.[a-z][a-zA-Z0-9-]*)+$/

function ctx(disabled?: Partial<EditorCommandGates>, ran: StateCommand[] = []): PaletteContext {
  return {
    canInsertTemplate: false,
    canPrint: false,
    templates: [],
    insertTemplate: async () => {},
    printDoc: () => {},
    editor: disabled
      ? { disabled: { clear: false, paragraph: false, insert: false, ...disabled }, run: (c: StateCommand) => ran.push(c) }
      : undefined,
  }
}

describe('EDITOR_PALETTE_COMMANDS — U3', () => {
  it('27개, action, id·라벨·단축키 규칙', () => {
    expect(EDITOR_PALETTE_COMMANDS).toHaveLength(27)
    EDITOR_PALETTE_COMMANDS.forEach((c, i) => {
      expect(c.kind).toBe('action')
      expect(c.id).toBe(`editor.${EDITOR_COMMANDS[i].id}`)
      expect(c.id).toMatch(PALETTE_ID_RE)
    })
    const label = (id: string) => EDITOR_PALETTE_COMMANDS.find((c) => c.id === id)?.label
    expect(label('editor.bold')).toBe('서식: 볼드체')
    expect(label('editor.heading2')).toBe('단락: 제목 2')
    expect(label('editor.wikilink')).toBe('삽입: 링크 추가')
    expect(label('editor.link')).toBe('삽입: 외부 링크 추가')
    expect(label('editor.codeblock')).toBe('삽입: 코드 블럭')
    expect(label('editor.paragraph')).toBe('단락: 본문')
    const withShortcut = EDITOR_PALETTE_COMMANDS.filter((c) => c.shortcut).map((c) => [c.id, c.shortcut])
    expect(withShortcut).toEqual([
      ['editor.link', 'Ctrl+K'],
      ['editor.bold', 'Ctrl+B'],
      ['editor.italic', 'Ctrl+I'],
    ])
  })
})

describe('when·run — U4', () => {
  it('editor 없음 0 / 모두 활성 27 / 단락 비활성 16 / 삽입 비활성 21 / 서식 지우기 비활성 26', () => {
    const n = (c: PaletteContext) => visibleCommands(EDITOR_PALETTE_COMMANDS, c).length
    expect(n(ctx())).toBe(0)
    expect(n(ctx({}))).toBe(27)
    expect(n(ctx({ paragraph: true }))).toBe(16)
    expect(n(ctx({ insert: true }))).toBe(21)
    expect(n(ctx({ clear: true }))).toBe(26)
  })

  it('실행하면 메뉴와 같은 함수를 넘긴다', () => {
    const ran: StateCommand[] = []
    const c = ctx({}, ran)
    const find = (id: string) => EDITOR_PALETTE_COMMANDS.find((x) => x.id === id)!
    find('editor.table').run(c)
    find('editor.heading2').run(c)
    expect(ran[0]).toBe(insertTable)
    expect(ran[1]).toBe(EDITOR_COMMANDS.find((x) => x.id === 'heading2')!.run)
  })
})

describe('거르기 — U5', () => {
  const ids = (q: string) => filterPaletteItems(EDITOR_PALETTE_COMMANDS, q).map((c) => c.id)

  it('기존 e2e 가 쓰는 검색어에 안 걸린다', () => {
    for (const q of ['댓글', '알림', '금고', 'pdf', '템플', '인쇄', '여행', '장보기', 'ㅋㅋㅋ', '단축키', '문서']) {
      expect(ids(q), q).toEqual([])
    }
  })

  it('볼드·ㅂㄷㅊ·굵게 → 볼드체, 제목 2·ㅈㅁ 2 → 제목 2, 서식 → 서식 묶음 8개', () => {
    for (const q of ['볼드', 'ㅂㄷㅊ', '굵게']) expect(ids(q)[0], q).toBe('editor.bold')
    for (const q of ['제목 2', 'ㅈㅁ 2']) expect(ids(q)[0], q).toBe('editor.heading2')
    const format = ids('서식')
    expect(format).toHaveLength(8)
    expect(format.every((id) => EDITOR_COMMANDS.find((c) => `editor.${c.id}` === id)?.group === 'format')).toBe(true)
  })
})

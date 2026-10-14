import { describe, expect, it } from 'vitest'
import { ChangeSet, Text } from '@codemirror/state'
import {
  KANBAN_NEW_DOC_TEXT,
  addCardChange,
  addLaneChange,
  editCardChange,
  isKanbanDoc,
  kanbanFlagChange,
  moveCardChanges,
  parseKanban,
  renameLaneChange,
  toggleCardChange,
  type KanbanChange,
} from '../../../src/lib/kanban'
import { fromEditorText, toEditorText } from '../../../src/lib/lineEnding'

const apply = (text: string, changes: KanbanChange | KanbanChange[] | null): string => {
  if (!changes) throw new Error('null change')
  return ChangeSet.of(changes, text.length).apply(Text.of(text.split('\n'))).toString()
}

const INITIAL = `---
kanban: true
---
# 작업 보드

## 할 일

- 칸반 프로토타입
  - 제목 + 목록 방식
- 도움말 글 쓰기

## 진행 중

- CLI webp 변환
  - 명세 먼저 (새 의존성)

## 완료

- [x] 사이드바 메뉴 폭
- [x] 가져오기 메뉴 위로 펼침
`

describe('F-2139 U1 isKanbanDoc', () => {
  it('참', () => {
    expect(isKanbanDoc('---\nkanban: true\n---\nx')).toBe(true)
    expect(isKanbanDoc('---\nkanban: True\n---\nx')).toBe(true)
    expect(isKanbanDoc('---\nkanban: true  \n---\nx')).toBe(true)
    expect(isKanbanDoc('---\ntags:\n  - a\nkanban: true\nmeta:\n  k: v\n---\nx')).toBe(true)
  })
  it('거짓', () => {
    expect(isKanbanDoc('---\nkanban: false\n---\n')).toBe(false)
    expect(isKanbanDoc('---\nkanban: "true"\n---\n')).toBe(false)
    expect(isKanbanDoc('---\n  kanban: true\n---\n')).toBe(false)
    expect(isKanbanDoc('# t\n\nkanban: true\n')).toBe(false)
    expect(isKanbanDoc('---\nkanban: true\n')).toBe(false)
  })
})

describe('F-2139 U2 parseKanban', () => {
  it('프로토타입 원문', () => {
    const lanes = parseKanban(INITIAL)
    expect(lanes.map((l) => l.title)).toEqual(['할 일', '진행 중', '완료'])
    expect(lanes.map((l) => l.cards.length)).toEqual([2, 1, 2])
    expect(lanes[0].cards[0].text).toBe('칸반 프로토타입')
    expect(lanes[0].cards[0].detail).toEqual(['- 제목 + 목록 방식'])
    expect(lanes[2].cards.map((c) => c.done)).toEqual([true, true])
    expect(lanes[0].cards[0].done).toBeNull()
    const c = lanes[2].cards[0]
    expect(INITIAL.slice(c.textFrom, c.textTo)).toBe('사이드바 메뉴 폭')
    expect(INITIAL[c.checkAt!]).toBe('x')
    expect(INITIAL.slice(lanes[0].cards[0].from, lanes[0].cards[0].to)).toBe('- 칸반 프로토타입\n  - 제목 + 목록 방식')
    expect(lanes[0].to).toBe(INITIAL.indexOf('## 진행 중'))
  })
})

describe('F-2139 U3 펜스', () => {
  it('펜스 안은 칸·카드가 아니고 들여쓴 펜스는 하위 줄', () => {
    const t = '## A\n\n- a\n  ```\n  ## x\n  - y\n  ```\n- b\n'
    const [lane] = parseKanban(t)
    expect(parseKanban(t)).toHaveLength(1)
    expect(lane.cards.map((c) => c.text)).toEqual(['a', 'b'])
    expect(lane.cards[0].detail).toEqual(['```', '## x', '- y', '```'])
    expect(lane.strayLines).toEqual([])
  })
  it('들여쓰지 않은 펜스는 strayLines', () => {
    const t = '## A\n\n- a\n```\n## x\n- y\n```\n- b\n'
    const lanes = parseKanban(t)
    expect(lanes).toHaveLength(1)
    expect(lanes[0].cards.map((c) => c.text)).toEqual(['a', 'b'])
    expect(lanes[0].strayLines).toEqual([4, 5, 6, 7])
  })
  it('물결 펜스는 백틱 줄로 닫히지 않는다', () => {
    const t = '## A\n\n~~~\n```\n## x\n~~~\n- b\n'
    const lanes = parseKanban(t)
    expect(lanes).toHaveLength(1)
    expect(lanes[0].cards.map((c) => c.text)).toEqual(['b'])
  })
})

describe('F-2139 U4 규칙 밖', () => {
  it('문단·번호·###·인용은 strayLines, # 뒤 카드는 어느 칸에도 없다', () => {
    const t = '## A\n\n- a\n문단\n1. n\n### h\n> q\n- b\n\n# 끝\n- z\n\n## B\n- c\n'
    const lanes = parseKanban(t)
    expect(lanes[0].strayLines).toEqual([4, 5, 6, 7])
    expect(lanes[0].cards.map((c) => c.text)).toEqual(['a', 'b'])
    expect(lanes.flatMap((l) => l.cards.map((c) => c.text))).not.toContain('z')
    expect(lanes[1].cards.map((c) => c.text)).toEqual(['c'])
  })
  it('빈 줄은 하위 줄이 이어질 때만 묶음에 든다', () => {
    const t = '## A\n- a\n\n  d\n\n- b\n'
    const [lane] = parseKanban(t)
    expect(lane.cards[0].detail).toEqual(['', 'd'])
    expect(t.slice(lane.cards[0].from, lane.cards[0].to)).toBe('- a\n\n  d')
  })
  it('닫는 # 열과 빈 이름', () => {
    const lanes = parseKanban('## A ##\n## \n##\n')
    expect(lanes.map((l) => l.title)).toEqual(['A', '', ''])
  })
})

const lines = (s: string) => s.split('\n')

describe('F-2139 U5 moveCardChanges', () => {
  const doc = '# t\n\n## A\n\n- a1\n- a2\n  - d\n- a3\n\n## B\n\n- b1\n\n## C\n\n## D\n'
  const cases: { name: string; text: string; from: [number, number]; to: [number, number]; expected: string }[] = [
    { name: '같은 칸 아래', text: doc, from: [0, 0], to: [0, 2], expected: '# t\n\n## A\n\n- a2\n  - d\n- a3\n- a1\n\n## B\n\n- b1\n\n## C\n\n## D\n' },
    { name: '같은 칸 위', text: doc, from: [0, 2], to: [0, 0], expected: '# t\n\n## A\n\n- a3\n- a1\n- a2\n  - d\n\n## B\n\n- b1\n\n## C\n\n## D\n' },
    { name: '다른 칸 가운데(하위 줄 있음)', text: doc, from: [0, 1], to: [1, 0], expected: '# t\n\n## A\n\n- a1\n- a3\n\n## B\n\n- a2\n  - d\n- b1\n\n## C\n\n## D\n' },
    { name: '다른 칸 끝', text: doc, from: [0, 0], to: [1, 1], expected: '# t\n\n## A\n\n- a2\n  - d\n- a3\n\n## B\n\n- b1\n- a1\n\n## C\n\n## D\n' },
    { name: '빈 칸(빈 줄 있음)', text: doc, from: [0, 0], to: [2, 0], expected: '# t\n\n## A\n\n- a2\n  - d\n- a3\n\n## B\n\n- b1\n\n## C\n\n- a1\n## D\n' },
    { name: '빈 칸(빈 줄 없음)', text: '## A\n- a\n## B\n## C\n', from: [0, 0], to: [1, 0], expected: '## A\n## B\n- a\n## C\n' },
    { name: '문서 끝 카드를 옮김', text: '## A\n- a\n## B\n- b', from: [1, 0], to: [0, 0], expected: '## A\n- b\n- a\n## B' },
    { name: '문서 끝 카드로 옮김', text: '## A\n- a\n- x\n## B\n- b', from: [0, 0], to: [1, 1], expected: '## A\n- x\n## B\n- b\n- a' },
    { name: '끝 빈 칸 제목으로(줄바꿈 없음)', text: '## A\n- a\n## B', from: [0, 0], to: [1, 0], expected: '## A\n## B\n\n- a' },
    { name: '끝 카드를 끝 빈 칸으로', text: '## A\n- a\n- z\n## B', from: [0, 1], to: [1, 0], expected: '## A\n- a\n## B\n\n- z' },
  ]
  for (const c of cases) {
    it(c.name, () => {
      const changes = moveCardChanges(c.text, { lane: c.from[0], card: c.from[1] }, { lane: c.to[0], index: c.to[1] })
      const out = apply(c.text, changes)
      expect(out).toBe(c.expected)
      const moved = c.text.slice(
        parseKanban(c.text)[c.from[0]].cards[c.from[1]].from,
        parseKanban(c.text)[c.from[0]].cards[c.from[1]].to,
      )
      const rest = (s: string) => {
        const arr = lines(s)
        const m = lines(moved)
        const i = arr.findIndex((_, k) => m.every((ml, j) => arr[k + j] === ml))
        arr.splice(i, m.length)
        return arr.filter((l) => l !== '')
      }
      expect(rest(out)).toEqual(rest(c.text))
    })
  }
  it('같은 칸 같은 자리·없는 자리는 null', () => {
    expect(moveCardChanges(doc, { lane: 0, card: 1 }, { lane: 0, index: 1 })).toBeNull()
    expect(moveCardChanges(doc, { lane: 0, card: 9 }, { lane: 0, index: 0 })).toBeNull()
    expect(moveCardChanges(doc, { lane: 0, card: 0 }, { lane: 9, index: 0 })).toBeNull()
    expect(moveCardChanges(doc, { lane: 0, card: 0 }, { lane: 0, index: 3 })).toBeNull()
  })
})

describe('F-2139 U6 CRLF', () => {
  it('CRLF 를 되돌리면 \\r 이 홀로 남지 않는다', () => {
    const crlf = '## A\r\n\r\n- a\r\n  - d\r\n- b\r\n\r\n## B\r\n\r\n'
    const ed = toEditorText(crlf)
    const out = fromEditorText(apply(ed, moveCardChanges(ed, { lane: 0, card: 0 }, { lane: 1, index: 0 })), 'crlf')
    expect(out).toBe('## A\r\n\r\n- b\r\n\r\n## B\r\n\r\n- a\r\n  - d\r\n')
    expect(/\r(?!\n)/.test(out)).toBe(false)
  })
})

describe('F-2139 U7 단건 변경', () => {
  const t = '## A ##\n\n- a\n- [ ] b\n- [x] c\n\n## B\n'
  it('addCardChange', () => {
    expect(apply(t, addCardChange(t, 0, '  new '))).toBe('## A ##\n\n- a\n- [ ] b\n- [x] c\n- new\n\n## B\n')
    expect(apply(t, addCardChange(t, 1, 'z'))).toBe('## A ##\n\n- a\n- [ ] b\n- [x] c\n\n## B\n- z\n')
    expect(addCardChange(t, 0, '   ')).toBeNull()
    expect(addCardChange(t, 5, 'x')).toBeNull()
  })
  it('addLaneChange', () => {
    expect(apply('## A\n', addLaneChange('## A\n', '새 칸'))).toBe('## A\n\n## 새 칸\n')
    expect(apply('## A', addLaneChange('## A', '새 칸'))).toBe('## A\n\n## 새 칸')
    expect(apply('## A\n\n', addLaneChange('## A\n\n', '새 칸'))).toBe('## A\n\n## 새 칸\n')
  })
  it('renameLaneChange 는 닫는 # 를 남긴다', () => {
    expect(apply(t, renameLaneChange(t, 0, 'Z'))).toBe('## Z ##\n\n- a\n- [ ] b\n- [x] c\n\n## B\n')
    expect(renameLaneChange(t, 0, 'A')).toBeNull()
    expect(renameLaneChange(t, 0, ' ')).toBeNull()
    expect(renameLaneChange(t, 7, 'x')).toBeNull()
    expect(apply('##\n', renameLaneChange('##\n', 0, 'N'))).toBe('## N\n')
  })
  it('editCardChange', () => {
    const [lane] = parseKanban(t)
    expect(apply(t, editCardChange(t, lane.cards[1].from, 'bb'))).toBe('## A ##\n\n- a\n- [ ] bb\n- [x] c\n\n## B\n')
    expect(editCardChange(t, lane.cards[1].from, 'b')).toBeNull()
    expect(editCardChange(t, lane.cards[1].from, ' ')).toBeNull()
    expect(editCardChange(t, 1, 'x')).toBeNull()
  })
  it('toggleCardChange', () => {
    const [lane] = parseKanban(t)
    expect(apply(t, toggleCardChange(t, lane.cards[1].from))).toBe('## A ##\n\n- a\n- [x] b\n- [x] c\n\n## B\n')
    expect(apply(t, toggleCardChange(t, lane.cards[2].from))).toBe('## A ##\n\n- a\n- [ ] b\n- [ ] c\n\n## B\n')
    expect(toggleCardChange(t, lane.cards[0].from)).toBeNull()
  })
})

describe('F-2139 U8 kanbanFlagChange', () => {
  const cases: [string, string][] = [
    ['프론트매터 없음', '## A\n- a\n'],
    ['키 없음', '---\ntitle: x\n---\n## A\n- a\n'],
    ['kanban: false', '---\nkanban: false\ntitle: x\n---\n## A\n'],
    ['중첩', '---\ntags:\n  - a\nmeta:\n  k: v\n---\n## A\n'],
  ]
  for (const [name, text] of cases) {
    it(name, () => {
      const out = apply(text, kanbanFlagChange(text))
      expect(isKanbanDoc(out)).toBe(true)
      expect(isKanbanDoc(text)).toBe(false)
      const strip = (s: string) => s.split('\n').filter((l) => !/^kanban:/.test(l) && l !== '---' && l !== '')
      expect(strip(out)).toEqual(strip(text))
    })
  }
})

describe('F-2139 U9 새 보드', () => {
  it('세 칸에 카드 0', () => {
    const lanes = parseKanban(KANBAN_NEW_DOC_TEXT)
    expect(lanes.map((l) => l.title)).toEqual(['할 일', '진행 중', '완료'])
    expect(lanes.every((l) => l.cards.length === 0)).toBe(true)
    expect(isKanbanDoc(KANBAN_NEW_DOC_TEXT)).toBe(true)
    expect(apply(KANBAN_NEW_DOC_TEXT, addCardChange(KANBAN_NEW_DOC_TEXT, 2, 'a')).endsWith('## 완료\n\n- a')).toBe(true)
  })
})

import { describe, expect, it } from 'vitest'
import { ChangeSet, Text } from '@codemirror/state'
import {
  KANBAN_NEW_DOC_TEXT,
  addCardChange,
  addLaneChange,
  cardDraft,
  editCardChange,
  kanbanDetailLines,
  isKanbanDoc,
  kanbanDoneChange,
  kanbanDoneLane,
  kanbanDoneChoices,
  kanbanDoneSetting,
  kanbanFlagChange,
  moveCardChanges,
  moveLaneChanges,
  removeCardChange,
  removeLaneChange,
  parseKanban,
  renameLaneChange,
  toggleCardChange,
  toggleCheckChange,
  removeCheckChange,
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
    expect(apply(t, addCardChange(t, 1, ' z ', true))).toBe('## A ##\n\n- a\n- [ ] b\n- [x] c\n\n## B\n- [ ] z\n')
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

describe('moveLaneChanges (small 2026-10-14)', () => {
  const head = '---\nkanban: true\n---\n# t\n\n앞 글\n\n'
  const doc = `${head}## A\n\n- a1\n\n## B\n- b1\n  - d\n\n## C\n\n- c1`
  const cases: { name: string; text: string; from: number; to: number; expected: string }[] = [
    { name: '첫 칸을 끝으로', text: doc, from: 0, to: 2, expected: `${head}## B\n- b1\n  - d\n\n## C\n\n- c1\n\n## A\n\n- a1` },
    { name: '끝 칸(줄바꿈 없음)을 처음으로', text: doc, from: 2, to: 0, expected: `${head}## C\n\n- c1\n\n## A\n\n- a1\n\n## B\n- b1\n  - d` },
    { name: '한 칸 오른쪽', text: doc, from: 0, to: 1, expected: `${head}## B\n- b1\n  - d\n\n## A\n\n- a1\n\n## C\n\n- c1` },
    { name: '한 칸 왼쪽(하위 줄 있음)', text: doc, from: 1, to: 0, expected: `${head}## B\n- b1\n  - d\n\n## A\n\n- a1\n\n## C\n\n- c1` },
    { name: '문서 끝 줄바꿈은 그대로', text: '## A\n- a\n## B\n- b\n', from: 1, to: 0, expected: '## B\n- b\n## A\n- a\n' },
    { name: '펜스 속 ## 는 칸이 아니다', text: '## A\n```\n## 안\n```\n## B\n- b', from: 0, to: 1, expected: '## B\n- b\n## A\n```\n## 안\n```' },
    { name: '칸 사이 # 제목은 제자리', text: '## A\n- a\n\n# 둘\n\n## B\n- b', from: 1, to: 0, expected: '## B\n- b\n\n## A\n- a\n\n# 둘' },
  ]
  for (const c of cases) {
    it(c.name, () => {
      expect(apply(c.text, moveLaneChanges(c.text, c.from, c.to))).toBe(c.expected)
    })
  }
  it('같은 자리·없는 칸은 null', () => {
    expect(moveLaneChanges(doc, 1, 1)).toBeNull()
    expect(moveLaneChanges(doc, 5, 0)).toBeNull()
    expect(moveLaneChanges(doc, 0, 3)).toBeNull()
  })
  it('CRLF 경계', () => {
    const ed = toEditorText('## A\r\n\r\n- a\r\n\r\n## B\r\n\r\n- b\r\n')
    const out = fromEditorText(apply(ed, moveLaneChanges(ed, 0, 1)), 'crlf')
    expect(out).toBe('## B\r\n\r\n- b\r\n\r\n## A\r\n\r\n- a\r\n')
  })
})

describe('removeLaneChange (small 2026-10-14)', () => {
  it('가운데 칸은 뒤 빈 줄까지 지워 빈 줄이 겹치지 않는다', () => {
    const t = '## A\n\n- a\n\n## B\n\n## C\n'
    expect(apply(t, removeLaneChange(t, 1))).toBe('## A\n\n- a\n\n## C\n')
    expect(apply(t, removeLaneChange(t, 0))).toBe('## B\n\n## C\n')
  })
  it('끝 칸은 앞 빈 줄과 함께 지우고 문서 끝 줄바꿈은 그대로', () => {
    expect(apply('# t\n\n## A\n\n- a\n\n## B\n\n- b\n', removeLaneChange('# t\n\n## A\n\n- a\n\n## B\n\n- b\n', 1))).toBe('# t\n\n## A\n\n- a\n')
    expect(apply('# t\n\n## A\n- a', removeLaneChange('# t\n\n## A\n- a', 0))).toBe('# t')
    expect(apply('## A\n- a\n', removeLaneChange('## A\n- a\n', 0))).toBe('')
  })
  it('없는 칸은 null', () => {
    expect(removeLaneChange('## A\n', 1)).toBeNull()
  })
})

describe('removeCardChange · toggleCheckChange (small 2026-10-14)', () => {
  const t = '## A\n- a\n  - d\n- [ ] b\n- [x] c\n-\n- e'
  const cards = parseKanban(t)[0].cards
  it('카드를 하위 줄과 함께 지운다', () => {
    expect(apply(t, removeCardChange(t, cards[0].from))).toBe('## A\n- [ ] b\n- [x] c\n-\n- e')
    expect(apply(t, removeCardChange(t, cards[4].from))).toBe('## A\n- a\n  - d\n- [ ] b\n- [x] c\n-')
    expect(removeCardChange(t, 1)).toBeNull()
  })
  it('체크 칸이 없으면 달고, 있으면 뒤집는다', () => {
    expect(apply(t, toggleCheckChange(t, cards[0].from))).toBe('## A\n- [ ] a\n  - d\n- [ ] b\n- [x] c\n-\n- e')
    expect(apply(t, toggleCheckChange(t, cards[1].from))).toBe('## A\n- a\n  - d\n- [x] b\n- [x] c\n-\n- e')
    expect(apply(t, toggleCheckChange(t, cards[2].from))).toBe('## A\n- a\n  - d\n- [ ] b\n- [ ] c\n-\n- e')
    expect(apply(t, toggleCheckChange(t, cards[3].from))).toBe('## A\n- a\n  - d\n- [ ] b\n- [x] c\n- [ ] \n- e')
    expect(toggleCheckChange(t, 1)).toBeNull()
  })
  it('체크 칸을 떼면 `[ ] `·`[x] ` 째 지우고 카드 글자는 그대로, 없으면 null', () => {
    expect(apply(t, removeCheckChange(t, cards[1].from))).toBe('## A\n- a\n  - d\n- b\n- [x] c\n-\n- e')
    expect(apply(t, removeCheckChange(t, cards[2].from))).toBe('## A\n- a\n  - d\n- [ ] b\n- c\n-\n- e')
    expect(removeCheckChange(t, cards[0].from)).toBeNull()
  })
})

describe('완료 칸 설정 kanban-done (small 2026-10-14)', () => {
  const body = '# t\n\n## 할 일\n- a\n\n## 진행 중\n- b\n\n## 완료\n- c\n'
  const withDone = (value: string) => `---\nkanban: true\nkanban-done: ${value}\n---\n${body}`
  const plain = `---\nkanban: true\n---\n${body}`

  it('설정이 없거나 없는 칸 이름이면 마지막 칸, 있으면 그 칸', () => {
    expect(kanbanDoneSetting(plain)).toBeNull()
    expect(kanbanDoneLane(plain)).toBe(2)
    expect(kanbanDoneSetting(withDone('진행 중'))).toBe('진행 중')
    expect(kanbanDoneLane(withDone('진행 중'))).toBe(1)
    expect(kanbanDoneLane(withDone('"진행 중"'))).toBe(1)
    expect(kanbanDoneLane(withDone('없는 칸'))).toBe(2)
    expect(kanbanDoneLane(withDone(''))).toBe(2)
    expect(kanbanDoneLane('---\nkanban: true\n---\n# 빈 보드\n')).toBe(-1)
  })

  it('설정 선택지 — 이름 있는 칸(겹치면 한 번), 마지막 칸 이름, 맞는 칸이 있을 때만 지금 값', () => {
    expect(kanbanDoneChoices(plain)).toEqual({ names: ['할 일', '진행 중', '완료'], last: '완료', value: null })
    expect(kanbanDoneChoices(withDone('진행 중'))?.value).toBe('진행 중')
    expect(kanbanDoneChoices(withDone('없는 칸'))?.value).toBeNull()
    expect(kanbanDoneChoices('---\nkanban: true\n---\n## A\n##\n## A\n## B\n')).toEqual({ names: ['A', 'B'], last: 'B', value: null })
    expect(kanbanDoneChoices('---\nkanban: true\n---\n# 빈 보드\n')).toBeNull()
  })

  it('쓰기는 줄을 더하거나 값만 바꾸고, 기본값(null)이면 줄째 지운다', () => {
    expect(apply(plain, kanbanDoneChange(plain, '진행 중'))).toBe(withDone('진행 중'))
    expect(apply(withDone('진행 중'), kanbanDoneChange(withDone('진행 중'), '할 일'))).toBe(withDone('할 일'))
    expect(apply(withDone('진행 중'), kanbanDoneChange(withDone('진행 중'), null))).toBe(plain)
    expect(kanbanDoneChange(plain, null)).toBeNull()
    expect(kanbanDoneChange(withDone('진행 중'), '진행 중')).toBeNull()
  })

  it('YAML 이 달리 읽을 이름은 따옴표로 감싸 같은 이름으로 돌아온다', () => {
    for (const name of ['#긴급', '할 일: 오늘', '"인용"', '- 목록']) {
      const out = apply(plain, kanbanDoneChange(plain, name))
      expect(kanbanDoneSetting(out)).toBe(name)
    }
  })

  it('완료 칸 이름을 바꾸면 설정도 따라 바뀐다. 다른 칸이면 설정은 그대로', () => {
    const t = withDone('진행 중')
    expect(apply(t, renameLaneChange(t, 1, '검토'))).toBe(withDone('검토').replace('## 진행 중', '## 검토'))
    expect(apply(t, renameLaneChange(t, 0, '대기'))).toBe(t.replace('## 할 일', '## 대기'))
  })
})

describe('완료 칸으로 옮기면 체크 칸을 맞춘다 (small 2026-10-14)', () => {
  const t = '---\nkanban: true\n---\n## A\n- [ ] a\n- b\n- [x] c\n\n## B\n- [ ] d\n\n## 끝\n- [x] e\n- [ ] f\n'
  const move = (from: [number, number], to: [number, number], text = t) =>
    apply(text, moveCardChanges(text, { lane: from[0], card: from[1] }, { lane: to[0], index: to[1] }))

  it('완료 칸으로 들어가면 [ ] 만 [x], 체크 칸 없는 카드는 그대로', () => {
    expect(move([0, 0], [2, 0])).toContain('## 끝\n- [x] a\n- [x] e\n')
    expect(move([0, 1], [2, 0])).toContain('## 끝\n- b\n- [x] e\n')
  })
  it('완료 칸에서 나가면 [x] 는 [ ], 다른 칸 사이·같은 칸 안은 그대로', () => {
    expect(move([2, 0], [0, 0])).toContain('## A\n- [ ] e\n- [ ] a\n')
    expect(move([2, 1], [0, 0])).toContain('## A\n- [ ] f\n')
    expect(move([0, 2], [1, 0])).toContain('## B\n- [x] c\n- [ ] d\n')
    expect(move([2, 1], [2, 0])).toContain('## 끝\n- [ ] f\n- [x] e\n')
  })
  it('kanban-done 이 가리키는 칸이 완료 칸이다', () => {
    const pinned = t.replace('kanban: true\n', 'kanban: true\nkanban-done: B\n')
    expect(move([0, 0], [1, 0], pinned)).toContain('## B\n- [x] a\n- [ ] d\n')
    expect(move([1, 0], [2, 0], pinned)).toContain('## 끝\n- [ ] d\n- [x] e\n')
  })
})

describe('카드 세부사항을 보드에서 쓴다 (small 2026-10-23)', () => {
  const t = '## A\n- a\n- [ ] b\n   - b1\n\n   - b2\n- c\n'
  const cards = () => parseKanban(t)[0].cards
  it('cardDraft 는 첫 줄 카드 글자, 다음 줄부터 들여쓰기 뗀 하위 줄', () => {
    expect(cardDraft(cards()[0])).toBe('a')
    expect(cardDraft(cards()[1])).toBe('b\n- b1\n\n- b2')
  })
  it('하위 줄 없는 카드에 세부를 쓰면 주어진 들여쓰기로 붙인다', () => {
    expect(apply(t, editCardChange(t, cards()[0].from, 'a\n- 세부\n  - 더 깊게', '    '))).toBe('## A\n- a\n    - 세부\n      - 더 깊게\n- [ ] b\n   - b1\n\n   - b2\n- c\n')
  })
  it('이미 하위 줄이 있으면 그 들여쓰기를 따르고 통째로 바꾼다', () => {
    expect(apply(t, editCardChange(t, cards()[1].from, 'bb\n- b1\n- 새 줄', '    '))).toBe('## A\n- a\n- [ ] bb\n   - b1\n   - 새 줄\n- c\n')
  })
  it('세부를 모두 지우면 하위 줄도 지운다. 앞뒤 빈 줄은 버린다', () => {
    expect(apply(t, editCardChange(t, cards()[1].from, 'b\n\n', '    '))).toBe('## A\n- a\n- [ ] b\n- c\n')
    expect(apply(t, editCardChange(t, cards()[2].from, 'c\n\n- x\n\n', '  '))).toBe('## A\n- a\n- [ ] b\n   - b1\n\n   - b2\n- c\n  - x\n')
  })
  it('바뀐 것이 없거나 첫 줄이 비면 null', () => {
    expect(editCardChange(t, cards()[1].from, 'b\n- b1\n\n- b2', '    ')).toBeNull()
    expect(editCardChange(t, cards()[1].from, ' \n- b1', '    ')).toBeNull()
  })
  it('글자만 바뀌면 카드 글자 구간만 바꾼다', () => {
    expect(editCardChange(t, cards()[1].from, 'bb\n- b1\n\n- b2', '    ')).toEqual({ from: cards()[1].textFrom, to: cards()[1].textTo, insert: 'bb' })
  })
  it('addCardChange 도 여러 줄이면 하위 줄을 붙인다', () => {
    expect(apply(t, addCardChange(t, 0, 'n\n- n1', true, '  '))).toBe('## A\n- a\n- [ ] b\n   - b1\n\n   - b2\n- c\n- [ ] n\n  - n1\n')
    expect(addCardChange(t, 0, '\n- n1', false, '  ')).toBeNull()
  })
  it('kanbanDetailLines 는 목록 줄을 불릿·체크로, 펜스 안은 글자로 나눈다', () => {
    expect(kanbanDetailLines(['- 세부', '  * 깊게', '\t+ 탭', '- [ ] 할 것', '- [x] 한 것', '그냥 글', '', '```', '- 코드', '```'])).toEqual([
      { indent: 0, kind: 'bullet', done: false, text: '세부' },
      { indent: 2, kind: 'bullet', done: false, text: '깊게' },
      { indent: 4, kind: 'bullet', done: false, text: '탭' },
      { indent: 0, kind: 'check', done: false, text: '할 것' },
      { indent: 0, kind: 'check', done: true, text: '한 것' },
      { indent: 0, kind: 'text', done: false, text: '그냥 글' },
      { indent: 0, kind: 'text', done: false, text: '' },
      { indent: 0, kind: 'text', done: false, text: '```' },
      { indent: 0, kind: 'text', done: false, text: '- 코드' },
      { indent: 0, kind: 'text', done: false, text: '```' },
    ])
  })
})

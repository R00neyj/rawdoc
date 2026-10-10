// 미완료 체크박스 `[ ]` 모으기 — 한 문서의 항목, 문서별 훑기, 패널 묶음, 순수 함수 (small 2026-10-11)
import { proseLines } from './wikiGraph'

// 패널 목록이 끝없이 길어지지 않게 — 넘으면 앞에서 자르고 안내한다
export const TODO_MAX_ITEMS = 300

const OPEN_TODO_RE = /^([ \t]*)(?:[-*+]|\d{1,9}[.)])[ \t]+\[ \][ \t]+(\S.*)$/

export type TodoItem = { line: number; text: string; level: number }
export type TodoSource = { id: string; title: string; content: string; updatedAt: number; e2ee?: 'locked' | 'open' }
export type DocTodos = { id: string; title: string; items: TodoItem[] }
export type TodoGroup = DocTodos & { total: number }

// 펜스 코드·프론트매터 밖의 `- [ ] 내용` 줄. level 은 앞 항목들보다 얼마나 깊이 들여썼는가
export function findOpenTodos(text: string): TodoItem[] {
  const items: TodoItem[] = []
  const indents: number[] = []
  for (const { line, number } of proseLines(text)) {
    const match = OPEN_TODO_RE.exec(line)
    if (!match) continue
    let width = 0
    for (const ch of match[1]) width += ch === '\t' ? 4 : 1
    while (indents.length > 0 && indents[indents.length - 1] >= width) indents.pop()
    items.push({ line: number, text: match[2].trimEnd(), level: indents.length })
    indents.push(width)
  }
  return items
}

// 저장된 문서들(지금 문서 제외)을 최근 수정순으로 훑는다. 잠긴 금고 문서는 읽지 않고 세고, 할 일 없는 문서는 뺀다
export function scanTodoSources(sources: readonly TodoSource[], excludeId: string | null): { docs: DocTodos[]; lockedCount: number } {
  const docs: DocTodos[] = []
  let lockedCount = 0
  for (const doc of [...sources].sort((a, b) => b.updatedAt - a.updatedAt)) {
    if (doc.id === excludeId) continue
    if (doc.e2ee === 'locked') {
      lockedCount++
      continue
    }
    const items = doc.content === '' ? [] : findOpenTodos(doc.content)
    if (items.length > 0) docs.push({ id: doc.id, title: doc.title, items })
  }
  return { docs, lockedCount }
}

// 지금 문서 묶음을 맨 위에 두고 전체 TODO_MAX_ITEMS 개까지. total 은 그 문서의 전체 수
export function groupTodos(current: DocTodos | null, others: readonly DocTodos[]): { groups: TodoGroup[]; truncated: boolean } {
  const groups: TodoGroup[] = []
  let room = TODO_MAX_ITEMS
  let truncated = false
  for (const doc of current && current.items.length > 0 ? [current, ...others] : others) {
    if (doc.items.length > room) truncated = true
    if (room === 0) break
    groups.push({ ...doc, items: doc.items.slice(0, room), total: doc.items.length })
    room -= Math.min(room, doc.items.length)
  }
  return { groups, truncated }
}

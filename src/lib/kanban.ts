// 칸반 원문 읽기와 변경 함수 — 순수 함수, LF 원문만 받고 위치는 CM6 위치와 같다 (specs/features/F-2139.md)
import { findFrontmatter } from './frontmatter'

export const KANBAN_NEW_DOC_TEXT = '---\nkanban: true\n---\n# 제목 없는 보드\n\n## 할 일\n\n## 진행 중\n\n## 완료'
export const NEW_LANE_TITLE = '새 칸'

export type KanbanCard = {
  from: number
  to: number
  textFrom: number
  textTo: number
  text: string
  done: boolean | null
  checkAt: number | null
  detail: string[]
}
export type KanbanLane = {
  title: string
  headingFrom: number
  titleFrom: number
  titleTo: number
  to: number
  cards: KanbanCard[]
  strayLines: number[]
}
export type KanbanChange = { from: number; to?: number; insert?: string }

const KANBAN_FLAG_RE = /^kanban:[ \t]*true[ \t]*$/i
const FLAG_LINE_RE = /^kanban:/i
const LANE_RE = /^##(?:[ \t]|$)/
const H1_RE = /^#(?:[ \t]|$)/
const ITEM_RE = /^[-*+](?:[ \t]+|$)/
const CHECK_RE = /^\[([ xX])\][ \t]+/
const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/
const FENCE_CLOSE_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/

type Fence = { char: string; len: number; mode: 'detail' | 'stray' | 'outside' }
export function isKanbanDoc(text: string): boolean {
  const fm = findFrontmatter(text)
  if (!fm) return false
  return text.slice(fm.contentFrom, fm.contentTo).split('\n').some((line) => KANBAN_FLAG_RE.test(line))
}

function openFence(line: string): { char: string; len: number } | null {
  const m = FENCE_OPEN_RE.exec(line)
  if (!m) return null
  if (m[1][0] === '`' && m[2].includes('`')) return null
  return { char: m[1][0], len: m[1].length }
}

function closesFence(line: string, fence: Fence): boolean {
  const m = FENCE_CLOSE_RE.exec(line)
  return m !== null && m[1][0] === fence.char && m[1].length >= fence.len
}

function dedent(raw: string[]): string[] {
  let indent = Infinity
  for (const line of raw) {
    if (line === '') continue
    indent = Math.min(indent, /^[ \t]*/.exec(line)![0].length)
  }
  if (indent === Infinity) return raw
  return raw.map((line) => (line === '' ? '' : line.slice(indent)))
}

// `##` 뒤 이름 구간: 앞뒤 공백과 닫는 `#` 열을 뗀다
function laneTitleRange(line: string, lineFrom: number): { from: number; to: number } {
  let from = 2
  while (from < line.length && (line[from] === ' ' || line[from] === '\t')) from++
  let to = line.length
  while (to > from && (line[to - 1] === ' ' || line[to - 1] === '\t')) to--
  let hashFrom = to
  while (hashFrom > from && line[hashFrom - 1] === '#') hashFrom--
  if (hashFrom < to && (hashFrom === from || line[hashFrom - 1] === ' ' || line[hashFrom - 1] === '\t')) {
    to = hashFrom
    while (to > from && (line[to - 1] === ' ' || line[to - 1] === '\t')) to--
  }
  return { from: lineFrom + from, to: lineFrom + to }
}

export function parseKanban(text: string): KanbanLane[] {
  const fm = findFrontmatter(text)
  const lanes: KanbanLane[] = []
  let lane: KanbanLane | null = null
  let card: KanbanCard | null = null
  let raw: string[] = []
  let pending = 0
  let fence: Fence | null = null

  const closeCard = () => {
    if (card) card.detail = dedent(raw)
    card = null
    raw = []
    pending = 0
  }
  const addDetail = (line: string, end: number) => {
    if (!card) return
    for (; pending > 0; pending--) raw.push('')
    raw.push(line)
    card.to = end
  }

  let pos = 0
  let lineNo = 0
  for (;;) {
    const nl = text.indexOf('\n', pos)
    const end = nl === -1 ? text.length : nl
    lineNo++
    if (!(fm && pos < fm.to)) {
      const line = text.slice(pos, end)
      const blank = line.trim() === ''
      if (fence) {
        if (closesFence(line, fence)) {
          const mode = fence.mode
          fence = null
          if (mode === 'detail') addDetail(line, end)
          else if (mode === 'stray' && lane) lane.strayLines.push(lineNo)
        } else if (fence.mode === 'detail') addDetail(blank ? '' : line, end)
        else if (fence.mode === 'stray' && lane && !blank) lane.strayLines.push(lineNo)
      } else {
        const fo = openFence(line)
        if (fo) {
          if (!lane) fence = { ...fo, mode: 'outside' }
          else if (card && /^[ \t]/.test(line)) {
            addDetail(line, end)
            fence = { ...fo, mode: 'detail' }
          } else {
            closeCard()
            lane.strayLines.push(lineNo)
            fence = { ...fo, mode: 'stray' }
          }
        } else if (LANE_RE.test(line)) {
          closeCard()
          if (lane) lane.to = pos
          const r = laneTitleRange(line, pos)
          lane = { title: text.slice(r.from, r.to), headingFrom: pos, titleFrom: r.from, titleTo: r.to, to: text.length, cards: [], strayLines: [] }
          lanes.push(lane)
        } else if (H1_RE.test(line)) {
          closeCard()
          if (lane) lane.to = pos
          lane = null
        } else if (lane) {
          if (blank) {
            if (card) pending++
          } else if (ITEM_RE.test(line)) {
            closeCard()
            let off = ITEM_RE.exec(line)![0].length
            let done: boolean | null = null
            let checkAt: number | null = null
            const c = CHECK_RE.exec(line.slice(off))
            if (c) {
              done = c[1] !== ' '
              checkAt = pos + off + 1
              off += c[0].length
            }
            card = { from: pos, to: end, textFrom: pos + off, textTo: end, text: line.slice(off), done, checkAt, detail: [] }
            lane.cards.push(card)
          } else if (card && /^[ \t]/.test(line)) {
            addDetail(line, end)
          } else {
            closeCard()
            lane.strayLines.push(lineNo)
          }
        }
      }
    }
    if (nl === -1) break
    pos = nl + 1
  }
  closeCard()
  return lanes
}

// 빈 칸이 아니면 마지막 카드 다음 줄, 빈 칸이면 제목(과 그 뒤 빈 줄) 다음 줄에 묶음을 넣는 변경
function insertChange(text: string, lane: KanbanLane, cards: KanbanCard[], index: number, body: string): KanbanChange {
  let p: number
  let titleLast = false
  if (index < cards.length) p = cards[index].from
  else if (cards.length > 0) p = Math.min(cards[cards.length - 1].to + 1, text.length)
  else {
    const e = text.indexOf('\n', lane.headingFrom)
    if (e === -1) {
      p = text.length
      titleLast = true
    } else {
      p = e + 1
      if (p < lane.to) {
        const e2 = text.indexOf('\n', p)
        if (text.slice(p, e2 === -1 ? text.length : e2).trim() === '') p = e2 === -1 ? text.length : e2 + 1
      }
    }
  }
  if (p === text.length && text.length > 0 && text[text.length - 1] !== '\n') {
    return { from: p, insert: (titleLast ? '\n\n' : '\n') + body }
  }
  return { from: p, insert: body + '\n' }
}

export function moveCardChanges(
  text: string,
  from: { lane: number; card: number },
  to: { lane: number; index: number },
): KanbanChange[] | null {
  const lanes = parseKanban(text)
  const src = lanes[from.lane]?.cards[from.card]
  const dst = lanes[to.lane]
  if (!src || !dst) return null
  const target = dst.cards.filter((c) => c !== src)
  if (!Number.isInteger(to.index) || to.index < 0 || to.index > target.length) return null
  if (from.lane === to.lane && to.index === from.card) return null
  const del: KanbanChange = src.to < text.length ? { from: src.from, to: src.to + 1 } : { from: src.from - 1, to: src.to }
  const ins = insertChange(text, dst, target, to.index, text.slice(src.from, src.to))
  return [del, ins].sort((a, b) => a.from - b.from)
}

export function addCardChange(text: string, lane: number, cardText: string): KanbanChange | null {
  const t = cardText.trim()
  const l = parseKanban(text)[lane]
  if (!l || t === '') return null
  return insertChange(text, l, l.cards, l.cards.length, `- ${t}`)
}

export function addLaneChange(text: string, title: string): KanbanChange {
  let trailing = 0
  while (trailing < 2 && trailing < text.length && text[text.length - 1 - trailing] === '\n') trailing++
  const prefix = text.length === 0 ? '' : '\n'.repeat(2 - trailing)
  return { from: text.length, insert: `${prefix}## ${title.trim()}${text.endsWith('\n') ? '\n' : ''}` }
}

export function renameLaneChange(text: string, lane: number, title: string): KanbanChange | null {
  const l = parseKanban(text)[lane]
  const t = title.trim()
  if (!l || t === '' || t === l.title) return null
  const spaceBefore = /[ \t]/.test(text[l.titleFrom - 1] ?? '') ? '' : ' '
  const rest = text.slice(l.titleTo, text.indexOf('\n', l.titleTo) === -1 ? text.length : text.indexOf('\n', l.titleTo))
  const spaceAfter = l.title === '' && rest.trim() !== '' ? ' ' : ''
  return { from: l.titleFrom, to: l.titleTo, insert: spaceBefore + t + spaceAfter }
}

function findCard(text: string, cardFrom: number): KanbanCard | null {
  for (const lane of parseKanban(text)) {
    const card = lane.cards.find((c) => c.from === cardFrom)
    if (card) return card
  }
  return null
}

export function editCardChange(text: string, cardFrom: number, cardText: string): KanbanChange | null {
  const card = findCard(text, cardFrom)
  const t = cardText.trim()
  if (!card || t === '' || t === card.text.trim()) return null
  const spaceBefore = card.textFrom === card.textTo && !/[ \t]/.test(text[card.textFrom - 1] ?? '') ? ' ' : ''
  return { from: card.textFrom, to: card.textTo, insert: spaceBefore + t }
}

export function toggleCardChange(text: string, cardFrom: number): KanbanChange | null {
  const card = findCard(text, cardFrom)
  if (!card || card.checkAt === null) return null
  return { from: card.checkAt, to: card.checkAt + 1, insert: card.done ? ' ' : 'x' }
}

// 체크 칸이 있으면 뒤집고, 없으면 `[ ] ` 를 단다
export function toggleCheckChange(text: string, cardFrom: number): KanbanChange | null {
  const card = findCard(text, cardFrom)
  if (!card) return null
  if (card.checkAt !== null) return toggleCardChange(text, cardFrom)
  return { from: card.textFrom, insert: /[ \t]/.test(text[card.textFrom - 1]) ? '[ ] ' : ' [ ] ' }
}

// 하위 줄까지 카드 한 덩이를 줄째 지운다 (moveCardChanges 의 지우기와 같다)
export function removeCardChange(text: string, cardFrom: number): KanbanChange | null {
  const card = findCard(text, cardFrom)
  if (!card) return null
  return card.to < text.length ? { from: card.from, to: card.to + 1 } : { from: card.from - 1, to: card.to }
}

// 칸 머리부터 마지막 내용 줄 끝(줄바꿈 앞)까지 — 그 뒤 lane.to 까지는 빈 줄뿐이다
function laneCoreEnd(text: string, lane: KanbanLane): number {
  let end = lane.headingFrom
  let pos = lane.headingFrom
  while (pos < lane.to) {
    const nl = text.indexOf('\n', pos)
    const lineEnd = nl === -1 || nl > lane.to ? lane.to : nl
    if (text.slice(pos, lineEnd).trim() !== '') end = lineEnd
    pos = lineEnd + 1
  }
  return end
}

// 칸 앞 마지막 내용 줄 끝 — 앞에 내용이 없으면 null
function contentEndBefore(text: string, pos: number): number | null {
  let start = pos
  while (start > 0) {
    const prev = start >= 2 ? text.lastIndexOf('\n', start - 2) + 1 : 0
    if (text.slice(prev, start - 1).trim() !== '') return start - 1
    start = prev
  }
  return null
}

// 칸 한 덩이와 그 구분 빈 줄 — 뒤에 칸이 있으면 뒤 빈 줄, 끝 칸이면 앞 빈 줄을 함께 든다
function laneUnit(text: string, lanes: KanbanLane[], index: number) {
  const lane = lanes[index]
  const end = laneCoreEnd(text, lane)
  const core = text.slice(lane.headingFrom, end)
  const prevEnd = index === lanes.length - 1 ? contentEndBefore(text, lane.headingFrom) : null
  if (prevEnd === null) return { core, sep: text.slice(end, lane.to), del: { from: lane.headingFrom, to: lane.to } }
  return { core, sep: text.slice(prevEnd, lane.headingFrom), del: { from: prevEnd, to: end } }
}

// 칸을 통째로 옮긴다 — to 는 옮긴 뒤 순서. 칸 사이 빈 줄은 옮기는 칸이 들고 간다
export function moveLaneChanges(text: string, from: number, to: number): KanbanChange[] | null {
  const lanes = parseKanban(text)
  if (!lanes[from] || !Number.isInteger(to) || to < 0 || to >= lanes.length || to === from) return null
  const unit = laneUnit(text, lanes, from)
  const rest = lanes.filter((_, k) => k !== from)
  const ins: KanbanChange =
    to < rest.length
      ? { from: rest[to].headingFrom, insert: unit.core + unit.sep }
      : { from: laneCoreEnd(text, rest[rest.length - 1]), insert: unit.sep + unit.core }
  return [unit.del, ins].sort((a, b) => a.from - b.from)
}

export function removeLaneChange(text: string, lane: number): KanbanChange | null {
  const lanes = parseKanban(text)
  return lanes[lane] ? laneUnit(text, lanes, lane).del : null
}

export function kanbanFlagChange(text: string): KanbanChange {
  const fm = findFrontmatter(text)
  if (!fm) return { from: 0, insert: '---\nkanban: true\n---\n' }
  let pos = fm.contentFrom
  while (pos < fm.contentTo) {
    const nl = text.indexOf('\n', pos)
    const end = nl === -1 ? fm.contentTo : nl
    const line = text.slice(pos, end)
    if (FLAG_LINE_RE.test(line)) {
      let v = pos + 'kanban:'.length
      if (v === end) return { from: v, insert: ' true' }
      while (v < end && (text[v] === ' ' || text[v] === '\t')) v++
      return v === pos + 'kanban:'.length ? { from: v, to: end, insert: ' true' } : { from: v, to: end, insert: 'true' }
    }
    pos = end + 1
  }
  return { from: fm.contentTo, insert: 'kanban: true\n' }
}

// 칸반 원문 읽기와 변경 함수 — 순수 함수, LF 원문만 받고 위치는 CM6 위치와 같다 (specs/features/F-2139.md)
import { findFrontmatter, frontmatterValueText } from '../markdown/frontmatter'

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
const DONE_LINE_RE = /^kanban-done:/i
// YAML 이 글자 그대로 읽지 않는 머리 기호·`: `·` #` — 따옴표로 감싼다
const YAML_QUOTE_RE = /^[-?:,[\]{}#&*!|>'"%@`]|:(?:[ \t]|$)|[ \t]#/
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

// 프런트매터 `kanban-done:` 줄의 [줄 머리, 줄 끝)과 값 — 없으면 null
function doneLine(text: string): { from: number; to: number; value: string } | null {
  const fm = findFrontmatter(text)
  if (!fm) return null
  let pos = fm.contentFrom
  while (pos < fm.contentTo) {
    const nl = text.indexOf('\n', pos)
    const end = nl === -1 ? fm.contentTo : nl
    const line = text.slice(pos, end)
    if (DONE_LINE_RE.test(line)) return { from: pos, to: end, value: frontmatterValueText(line.slice('kanban-done:'.length)) }
    pos = end + 1
  }
  return null
}

export function kanbanDoneSetting(text: string): string | null {
  const value = doneLine(text)?.value ?? ''
  return value === '' ? null : value
}

// 완료 칸 — `kanban-done` 과 이름이 같은 첫 칸, 없으면 마지막 칸. 칸이 없으면 -1
export function kanbanDoneLane(text: string, lanes: KanbanLane[] = parseKanban(text)): number {
  const setting = kanbanDoneSetting(text)
  const named = setting === null ? -1 : lanes.findIndex((l) => l.title === setting)
  return named >= 0 ? named : lanes.length - 1
}

export type KanbanDoneChoices = { names: string[]; last: string; value: string | null }

// 설정 선택지 — 이름 있는 칸(겹치면 한 번), 마지막 칸 이름, 맞는 칸이 있을 때만 지금 값
export function kanbanDoneChoices(text: string): KanbanDoneChoices | null {
  const lanes = parseKanban(text)
  if (lanes.length === 0) return null
  const names = [...new Set(lanes.map((l) => l.title).filter((t) => t !== ''))]
  const setting = kanbanDoneSetting(text)
  return { names, last: lanes[lanes.length - 1].title, value: setting !== null && names.includes(setting) ? setting : null }
}

function yamlValue(value: string): string {
  if (!YAML_QUOTE_RE.test(value)) return value
  return value.includes('"') ? `'${value}'` : `"${value}"`
}

// title 이 null(마지막 칸)이면 줄째 지운다
export function kanbanDoneChange(text: string, title: string | null): KanbanChange | null {
  const line = doneLine(text)
  if (title === null) return line ? { from: line.from, to: Math.min(line.to + 1, text.length) } : null
  if (line?.value === title) return null
  const entry = `kanban-done: ${yamlValue(title)}`
  if (line) return { from: line.from, to: line.to, insert: entry }
  const fm = findFrontmatter(text)
  return fm ? { from: fm.contentTo, insert: `${entry}\n` } : { from: 0, insert: `---\n${entry}\n---\n` }
}

// 완료 칸으로 들어가면 [ ] 를 [x], 완료 칸에서 나가면 [x] 를 [ ] — 체크 칸 없는 카드는 그대로
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
  const done = kanbanDoneLane(text, lanes)
  const check = from.lane === to.lane || src.checkAt === null ? null : to.lane === done && !src.done ? 'x' : from.lane === done && src.done ? ' ' : null
  let body = text.slice(src.from, src.to)
  if (check !== null && src.checkAt !== null) body = body.slice(0, src.checkAt - src.from) + check + body.slice(src.checkAt - src.from + 1)
  const del: KanbanChange = src.to < text.length ? { from: src.from, to: src.to + 1 } : { from: src.from - 1, to: src.to }
  const ins = insertChange(text, dst, target, to.index, body)
  return [del, ins].sort((a, b) => a.from - b.from)
}

// 입력칸 글 — 첫 줄은 카드 글자, 다음 줄부터 세부(앞뒤 빈 줄·줄 끝 공백 뗌) (small 2026-10-23)
function splitDraft(value: string): { first: string; detail: string[] } {
  const [head, ...rest] = value.split('\n')
  const detail = rest.map((line) => line.trimEnd())
  while (detail.length > 0 && detail[0] === '') detail.shift()
  while (detail.length > 0 && detail[detail.length - 1] === '') detail.pop()
  return { first: head.trim(), detail }
}

function detailBody(detail: string[], indent: string): string {
  return detail.map((line) => '\n' + (line === '' ? '' : indent + line)).join('')
}

export function cardDraft(card: KanbanCard): string {
  return [card.text, ...card.detail].join('\n')
}

export function addCardChange(text: string, lane: number, cardText: string, check = false, indent = '    '): KanbanChange | null {
  const { first, detail } = splitDraft(cardText)
  const l = parseKanban(text)[lane]
  if (!l || first === '') return null
  return insertChange(text, l, l.cards, l.cards.length, (check ? `- [ ] ${first}` : `- ${first}`) + detailBody(detail, indent))
}

export function addLaneChange(text: string, title: string): KanbanChange {
  let trailing = 0
  while (trailing < 2 && trailing < text.length && text[text.length - 1 - trailing] === '\n') trailing++
  const prefix = text.length === 0 ? '' : '\n'.repeat(2 - trailing)
  return { from: text.length, insert: `${prefix}## ${title.trim()}${text.endsWith('\n') ? '\n' : ''}` }
}

// 완료 칸으로 이름이 걸린 칸이면 `kanban-done` 도 새 이름으로
export function renameLaneChange(text: string, lane: number, title: string): KanbanChange | KanbanChange[] | null {
  const lanes = parseKanban(text)
  const l = lanes[lane]
  const t = title.trim()
  if (!l || t === '' || t === l.title) return null
  const spaceBefore = /[ \t]/.test(text[l.titleFrom - 1] ?? '') ? '' : ' '
  const rest = text.slice(l.titleTo, text.indexOf('\n', l.titleTo) === -1 ? text.length : text.indexOf('\n', l.titleTo))
  const spaceAfter = l.title === '' && rest.trim() !== '' ? ' ' : ''
  const change: KanbanChange = { from: l.titleFrom, to: l.titleTo, insert: spaceBefore + t + spaceAfter }
  const pinned = l.title !== '' && kanbanDoneSetting(text) === l.title && kanbanDoneLane(text, lanes) === lane
  const done = pinned ? kanbanDoneChange(text, t) : null
  return done ? [done, change] : change
}

function findCard(text: string, cardFrom: number): KanbanCard | null {
  for (const lane of parseKanban(text)) {
    const card = lane.cards.find((c) => c.from === cardFrom)
    if (card) return card
  }
  return null
}

// 세부가 바뀌면 하위 줄을 통째로 바꾼다 — 들여쓰기는 지금 하위 줄 것, 없으면 indent
export function editCardChange(text: string, cardFrom: number, cardText: string, indent = '    '): KanbanChange | null {
  const card = findCard(text, cardFrom)
  const { first, detail } = splitDraft(cardText)
  if (!card || first === '') return null
  const sameText = first === card.text.trim()
  const sameDetail = detail.length === card.detail.length && detail.every((line, i) => line === card.detail[i])
  if (sameText && sameDetail) return null
  const spaceBefore = card.textFrom === card.textTo && !/[ \t]/.test(text[card.textFrom - 1] ?? '') ? ' ' : ''
  if (sameDetail) return { from: card.textFrom, to: card.textTo, insert: spaceBefore + first }
  const rawDetail = text.slice(card.textTo + 1, card.to).split('\n').filter((line) => line.trim() !== '')
  const own = rawDetail.length > 0 ? rawDetail.map((line) => /^[ \t]*/.exec(line)![0]).reduce((a, b) => (b.length < a.length ? b : a)) : indent
  return { from: card.textFrom, to: card.to, insert: spaceBefore + first + detailBody(detail, own) }
}

export type KanbanDetailLine = { indent: number; kind: 'bullet' | 'check' | 'text'; done: boolean; text: string }

// 보드 표시용 하위 줄 — 목록 줄은 불릿·체크, 펜스 안은 글자 그대로 (small 2026-10-23)
export function kanbanDetailLines(detail: string[]): KanbanDetailLine[] {
  let fence: Fence | null = null
  return detail.map((line) => {
    const lead = /^[ \t]*/.exec(line)![0]
    const indent = [...lead].reduce((n, ch) => n + (ch === '\t' ? 4 : 1), 0)
    const plain: KanbanDetailLine = { indent: 0, kind: 'text', done: false, text: line }
    if (fence) {
      if (closesFence(line, fence)) fence = null
      return plain
    }
    const fo = openFence(line)
    if (fo) {
      fence = { ...fo, mode: 'detail' }
      return plain
    }
    const rest = line.slice(lead.length)
    const item = ITEM_RE.exec(rest)
    if (!item || rest.length === item[0].length) return { ...plain, indent, text: rest }
    const body = rest.slice(item[0].length)
    const c = CHECK_RE.exec(body)
    if (c) return { indent, kind: 'check', done: c[1] !== ' ', text: body.slice(c[0].length) }
    return { indent, kind: 'bullet', done: false, text: body }
  })
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

// 체크 칸을 `[ ] `·`[x] ` 째 떼어 체크 없는 카드로 되돌린다
export function removeCheckChange(text: string, cardFrom: number): KanbanChange | null {
  const card = findCard(text, cardFrom)
  if (!card || card.checkAt === null) return null
  return { from: card.checkAt - 1, to: card.textFrom }
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

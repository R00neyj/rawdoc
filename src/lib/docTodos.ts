// 할 일 — 옵시디언 Tasks 플러그인의 전역 필터·상태·이모지 형식·happens·기본 정렬을 따른 읽기 전용 모음, 순수 함수 (small 2026-10-11)
import { proseLines } from './wikiGraph'

// 패널 목록이 끝없이 길어지지 않게 — 넘으면 정렬한 뒤 앞에서 자르고 안내한다
export const TODO_MAX_ITEMS = 300

export type TaskPriority = 'highest' | 'high' | 'medium' | 'none' | 'low' | 'lowest'
export type TaskStatus = 'todo' | 'inProgress'
export type TodoItem = {
  line: number
  text: string
  level: number
  status: TaskStatus
  due: string | null
  scheduled: string | null
  start: string | null
  priority: TaskPriority
}
export type TaskFilter = { filters: readonly string[]; hide: boolean }
export type TodoSource = { id: string; title: string; content: string; e2ee?: 'locked' | 'open' }
export type DocTodos = { id: string; title: string; items: TodoItem[] }
export type TaskRow = TodoItem & { docId: string; docTitle: string }
export type TaskBucket = 'overdue' | 'today' | 'upcoming' | 'none'

// Tasks taskRegex — 들여쓰기(> 인용 포함)·목록 표시·[한 글자]·나머지
const TASK_LINE_RE = /^([\s>]*)([-*+]|[0-9]+[.)]) +\[(.)\] *(.*)$/u
// Tasks hashTags 의 태그 글자 밖 문자 — 태그가 여기서 끝난다
const TAG_STOP = /[\s!@#$%^&*(),.?":{}|<>]/
const BLOCK_LINK_RE = / \^[a-zA-Z0-9-]+$/

const field = (symbols: string, value: string) => new RegExp(`(?:${symbols})\\uFE0F?${value === '' ? '' : ` *${value}`}$`)
const DATE = '(\\d{4}-\\d{2}-\\d{2})'
const ID = '[a-zA-Z0-9-_]+'
const PRIORITY_RE = field('🔺|⏫|🔼|🔽|⏬', '')
const DATE_FIELDS: [RegExp, 'due' | 'scheduled' | 'start' | null][] = [
  [field('✅', DATE), null],
  [field('❌', DATE), null],
  [field('📅|📆|🗓', DATE), 'due'],
  [field('⏳|⌛', DATE), 'scheduled'],
  [field('🛫', DATE), 'start'],
  [field('➕', DATE), null],
]
const TAIL_FIELDS = [field('🔁', '([a-zA-Z0-9, !]+)'), field('🏁', '([a-zA-Z]+)')]
const TRAILING_TAG_RE = /(^|\s)#[^ !@#$%^&*(),.?":{}|<>]+$/
const ID_FIELDS = [field('🆔', `(${ID})`), field('⛔', `(${ID}( *, *${ID} *)*)`)]
const PRIORITY_BY_SYMBOL: Record<string, TaskPriority> = { '🔺': 'highest', '⏫': 'high', '🔼': 'medium', '🔽': 'low', '⏬': 'lowest' }

export function parseTaskFilters(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
}

// 태그 모양(#…)이면 태그 경계에서만 — #tasks·#task/하위 는 다른 태그다. 아니면 Tasks 처럼 부분 문자열
function matchesFilter(body: string, filter: string): boolean {
  if (!filter.startsWith('#')) return body.includes(filter)
  for (let at = body.indexOf(filter); at !== -1; at = body.indexOf(filter, at + 1)) {
    const before = at === 0 ? ' ' : body[at - 1]
    const after = body[at + filter.length] ?? ' '
    if (/\s/.test(before) && TAG_STOP.test(after)) return true
  }
  return false
}

function validDate(value: string): string | null {
  const [y, m, d] = value.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? value : null
}

// Tasks DefaultTaskSerializer 처럼 끝에서부터 필드를 떼어 낸다. 사이에 낀 태그는 모아 뒤에 다시 붙인다
function parseFields(body: string): Pick<TodoItem, 'text' | 'due' | 'scheduled' | 'start' | 'priority'> {
  let line = body.replace(BLOCK_LINK_RE, '').trim()
  const dates: Record<'due' | 'scheduled' | 'start', string | null> = { due: null, scheduled: null, start: null }
  let priority: TaskPriority = 'none'
  let trailingTags = ''
  const take = (re: RegExp): RegExpMatchArray | null => {
    const match = line.match(re)
    if (match) line = line.replace(re, '').trim()
    return match
  }
  for (let run = 0, matched = true; matched && run < 20; run++) {
    matched = false
    const p = take(PRIORITY_RE)
    if (p) {
      priority = PRIORITY_BY_SYMBOL[p[0].replace('\uFE0F', '')] ?? 'none'
      matched = true
    }
    for (const [re, key] of DATE_FIELDS) {
      const m = take(re)
      if (!m) continue
      matched = true
      if (key) dates[key] = validDate(m[1])
    }
    for (const re of TAIL_FIELDS) if (take(re)) matched = true
    const tag = take(TRAILING_TAG_RE)
    if (tag) {
      trailingTags = trailingTags === '' ? tag[0].trim() : `${tag[0].trim()} ${trailingTags}`
      matched = true
    }
    for (const re of ID_FIELDS) if (take(re)) matched = true
  }
  const text = trailingTags === '' ? line : line === '' ? trailingTags : `${line} ${trailingTags}`
  return { text, priority, ...dates }
}

// Tasks removeAsWordFrom — 앞뒤가 공백·줄 끝인 단어로 있을 때만 뗀다
function removeFilters(text: string, filters: readonly string[]): string {
  let out = text
  for (const f of filters) out = out.replace(new RegExp(`(^|\\s)${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|\\s)`, 'gu'), '$1')
  return out.replace(/\s{2,}/g, ' ').trim()
}

// 펜스 코드·프론트매터 밖의 체크박스 줄 가운데 할 일(상태 [ ]·[/]·모르는 문자)만. 전역 필터가 있으면 표시가 든 줄만
export function findOpenTodos(text: string, filter: TaskFilter): TodoItem[] {
  const items: TodoItem[] = []
  const indents: number[] = []
  for (const { line, number } of proseLines(text)) {
    const match = TASK_LINE_RE.exec(line)
    if (!match) continue
    const [, indent, , symbol, body] = match
    if (body.trim() === '' || symbol === 'x' || symbol === 'X' || symbol === '-') continue
    if (filter.filters.length > 0 && !filter.filters.some((f) => matchesFilter(body, f))) continue
    let width = 0
    for (const ch of indent) width += ch === '\t' ? 4 : ch === '>' ? 0 : 1
    while (indents.length > 0 && indents[indents.length - 1] >= width) indents.pop()
    const parsed = parseFields(body)
    items.push({
      line: number,
      level: indents.length,
      status: symbol === '/' ? 'inProgress' : 'todo',
      ...parsed,
      text: filter.hide ? removeFilters(parsed.text, filter.filters) : parsed.text,
    })
    indents.push(width)
  }
  return items
}

// 저장된 문서들(지금 문서 제외)을 훑는다. 잠긴 금고 문서는 읽지 않고 세고, 할 일 없는 문서는 뺀다
export function scanTodoSources(sources: readonly TodoSource[], excludeId: string | null, filter: TaskFilter): { docs: DocTodos[]; lockedCount: number } {
  const docs: DocTodos[] = []
  let lockedCount = 0
  for (const doc of sources) {
    if (doc.id === excludeId) continue
    if (doc.e2ee === 'locked') {
      lockedCount++
      continue
    }
    const items = doc.content === '' ? [] : findOpenTodos(doc.content, filter)
    if (items.length > 0) docs.push({ id: doc.id, title: doc.title, items })
  }
  return { docs, lockedCount }
}

// Tasks happens — 시작·예정·마감 중 가장 이른 날
export function happensDate(item: Pick<TodoItem, 'start' | 'scheduled' | 'due'>): string | null {
  const dates = [item.start, item.scheduled, item.due].filter((d): d is string => d !== null).sort()
  return dates[0] ?? null
}

function daysFrom(from: string, to: string): number {
  const utc = (s: string) => {
    const [y, m, d] = s.split('-').map(Number)
    return Date.UTC(y, m - 1, d)
  }
  return Math.round((utc(to) - utc(from)) / 86_400_000)
}

const PRIORITY_SCORE: Record<TaskPriority, number> = { highest: 9, high: 6, medium: 3.9, none: 1.95, low: 0, lowest: -1.8 }
const PRIORITY_RANK: Record<TaskPriority, number> = { highest: 0, high: 1, medium: 2, none: 3, low: 4, lowest: 5 }

// Tasks Urgency 표 — 마감은 7일 지남 12 ~ 14일 남음 2.4 사이 직선, 예정이 오늘 이전 +5, 시작이 내일 이후 -3
export function taskUrgency(item: Pick<TodoItem, 'due' | 'scheduled' | 'start' | 'priority'>, today: string): number {
  let score = PRIORITY_SCORE[item.priority]
  if (item.due) score += Math.min(12, Math.max(2.4, 8.8 - (daysFrom(today, item.due) * 3.2) / 7))
  if (item.scheduled && item.scheduled <= today) score += 5
  if (item.start && item.start > today) score -= 3
  return score
}

const BUCKETS: TaskBucket[] = ['overdue', 'today', 'upcoming', 'none']

function bucketOf(item: TodoItem, today: string): TaskBucket {
  const happens = happensDate(item)
  if (happens === null) return 'none'
  return happens < today ? 'overdue' : happens === today ? 'today' : 'upcoming'
}

// 묶음은 happens 기준. 묶음 안은 Tasks 기본 정렬(status.type → urgency → due → priority → path) 을 따르고 path 대신 문서 제목·줄
export function groupTasks(docs: readonly DocTodos[], today: string): { groups: { bucket: TaskBucket; items: TaskRow[] }[]; truncated: boolean } {
  const rows = docs.flatMap((doc) =>
    doc.items.map((item) => ({ row: { ...item, docId: doc.id, docTitle: doc.title }, bucket: BUCKETS.indexOf(bucketOf(item, today)), urgency: taskUrgency(item, today) })),
  )
  rows.sort(
    (a, b) =>
      a.bucket - b.bucket ||
      (a.row.status === b.row.status ? 0 : a.row.status === 'inProgress' ? -1 : 1) ||
      b.urgency - a.urgency ||
      (a.row.due ?? '\uffff').localeCompare(b.row.due ?? '\uffff') ||
      PRIORITY_RANK[a.row.priority] - PRIORITY_RANK[b.row.priority] ||
      a.row.docTitle.localeCompare(b.row.docTitle, 'ko') ||
      a.row.line - b.row.line,
  )
  const kept = rows.slice(0, TODO_MAX_ITEMS)
  const groups = BUCKETS.map((bucket, index) => ({ bucket, items: kept.filter((r) => r.bucket === index).map((r) => r.row) })).filter((g) => g.items.length > 0)
  return { groups, truncated: rows.length > kept.length }
}

// 템플릿 폴더 판정·목록, 변수 치환, 삽입 계획 — 순수 함수 (specs/features/F-2022.md 4장, F-2037.md 2.2)
import { normalizeForSearch, foldCase } from './docSearch'
import { screenParentResolver, descendantFolderIds, type FolderLike } from './folderTree'
import { findFrontmatter, textAfterFrontmatter, parseSimpleProperties } from './frontmatter'
import { BUILTIN_TEMPLATES } from './builtinTemplates'
import { toEditorText, fromEditorText, type LineEnding } from './lineEnding'

export type TemplateEntry = {
  id: string // 사용자: 'doc:{docId}', 내장: 'builtin:{key}'
  title: string
  detail: string // 사용자: 폴더 경로('템플릿' · '템플릿 / 회의'), 내장: '내장'
  source: { kind: 'doc'; docId: string } | { kind: 'builtin'; body: string }
}

export type TemplateDocLike = { id: string; title: string; folderId: string | null; role?: 'owner' | 'edit' | 'view' }

// 최상위 폴더 이름이 '템플릿' 또는 'templates'(대소문자 무시)인지 (4.2)
export function isTemplateFolderName(name: string): boolean {
  const n = foldCase(normalizeForSearch(name).trim())
  return n === '템플릿' || n === 'templates'
}

function pathFromRoot(root: FolderLike, folder: FolderLike, byId: Map<string, FolderLike>): string {
  const chain: string[] = []
  let cur: FolderLike | undefined = folder
  while (cur && cur.id !== root.id) {
    chain.unshift(cur.name)
    cur = cur.parentId ? byId.get(cur.parentId) : undefined
  }
  chain.unshift(root.name)
  return chain.join(' / ')
}

// 최상위 '템플릿'·'templates' 폴더(들)와 그 하위 전체의 문서 목록 → 사용자 템플릿 + 내장 4개 (4.2·4.4)
export function listTemplates(input: { folders: readonly FolderLike[]; docs: readonly TemplateDocLike[] }): TemplateEntry[] {
  const folders = [...input.folders]
  const byId = new Map(folders.map((f) => [f.id, f]))
  const screenParent = screenParentResolver(folders)
  const roots = folders.filter((f) => screenParent(f) === null && isTemplateFolderName(f.name))

  const userEntries: TemplateEntry[] = []
  const seenDocIds = new Set<string>()
  for (const root of roots) {
    const ids = new Set(descendantFolderIds(folders, root.id))
    for (const doc of input.docs) {
      if (doc.role === 'edit' || doc.role === 'view') continue
      if (!doc.folderId || !ids.has(doc.folderId)) continue
      if (seenDocIds.has(doc.id)) continue
      seenDocIds.add(doc.id)
      const folder = byId.get(doc.folderId)
      if (!folder) continue
      const title = doc.title.trim() === '' ? '제목 없는 문서' : doc.title.trim()
      userEntries.push({
        id: `doc:${doc.id}`,
        title,
        detail: pathFromRoot(root, folder, byId),
        source: { kind: 'doc', docId: doc.id },
      })
    }
  }
  userEntries.sort((a, b) => a.title.localeCompare(b.title, 'ko') || a.detail.localeCompare(b.detail, 'ko'))

  const builtinEntries: TemplateEntry[] = BUILTIN_TEMPLATES.map((t) => ({
    id: `builtin:${t.key}`,
    title: t.title,
    detail: '내장',
    source: { kind: 'builtin', body: t.body },
  }))

  return [...userEntries, ...builtinEntries]
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

// 왼쪽부터 읽으며 가장 긴 토큰을 먼저 맞춘다. [글자] 는 그대로 두고 대괄호만 뗀다. 표에 없는 글자는 그대로 (5.2)
export function formatTemplateDate(now: Date, format: string): string {
  const weekday = WEEKDAYS[now.getDay()]
  const tokens: [string, string][] = [
    ['YYYY', String(now.getFullYear())],
    ['dddd', `${weekday}요일`],
    ['ddd', weekday],
    ['YY', String(now.getFullYear()).slice(-2)],
    ['MM', pad2(now.getMonth() + 1)],
    ['DD', pad2(now.getDate())],
    ['HH', pad2(now.getHours())],
    ['mm', pad2(now.getMinutes())],
    ['ss', pad2(now.getSeconds())],
    ['M', String(now.getMonth() + 1)],
    ['D', String(now.getDate())],
    ['H', String(now.getHours())],
  ]

  let out = ''
  let i = 0
  while (i < format.length) {
    if (format[i] === '[') {
      const end = format.indexOf(']', i + 1)
      if (end !== -1) {
        out += format.slice(i + 1, end)
        i = end + 1
        continue
      }
    }
    const hit = tokens.find(([tok]) => format.startsWith(tok, i))
    if (hit) {
      out += hit[1]
      i += hit[0].length
    } else {
      out += format[i]
      i += 1
    }
  }
  return out
}

const DATE_VAR_RE = /\{\{date(?::([^}]*))?\}\}/g
const TIME_VAR_RE = /\{\{time(?::([^}]*))?\}\}/g
const TITLE_VAR_RE = /\{\{title\}\}/g

// {{date}}·{{time}}·{{date:형식}}·{{time:형식}}·{{title}} 만 받는다. 그 밖(공백·대문자 섞임·모르는 이름)은 글자 그대로 둔다 (5.2)
// emptyTitle 기본은 'fallback'(제목 없는 문서로 바꾼다). 'keep-empty' 는 빈 제목을 빈 글자 그대로 둔다 (F-2037.md 4.4)
export function expandTemplateVariables(
  text: string,
  vars: { title: string; now: Date; emptyTitle?: 'fallback' | 'keep-empty' },
): string {
  const trimmed = vars.title.trim()
  const title = trimmed === '' ? (vars.emptyTitle === 'keep-empty' ? '' : '제목 없는 문서') : trimmed
  let out = text.replace(DATE_VAR_RE, (_m, fmt: string | undefined) => formatTemplateDate(vars.now, fmt ?? 'YYYY-MM-DD'))
  out = out.replace(TIME_VAR_RE, (_m, fmt: string | undefined) => formatTemplateDate(vars.now, fmt ?? 'HH:mm'))
  out = out.replace(TITLE_VAR_RE, title)
  return out
}

export type TemplatePlan = {
  frontmatterChange: { from: number; to: number; insert: string } | null
  body: string
  frontmatterSkipped: boolean
}

// 앞뒤의 빈 줄(글자 0개인 줄)만 뗀다. 공백만 있는 줄·마지막 줄 끝 공백은 그대로 둔다 (5.3)
function trimBlankEdges(text: string): string {
  const lines = text.split('\n')
  let start = 0
  while (start < lines.length && lines[start].length === 0) start++
  let end = lines.length - 1
  while (end >= start && lines[end].length === 0) end--
  if (start > end) return ''
  return lines.slice(start, end + 1).join('\n')
}

const LIST_ITEM_RE = /^[ \t]+-[ \t]+(.*)$/
const KEY_VALUE_RE = /^([^\s:#][^:]*):[ \t]*(.*)$/

// 프론트매터 내용에서 키 → 원래 줄(키 줄 + 이어지는 들여쓴 '  - 값' 줄) 그대로. parseSimpleProperties 와 같은 순서로 읽는다 (5.4)
function extractPropertyLines(content: string): Map<string, string[]> {
  const lines = content.split(/\r\n|\r|\n/)
  const map = new Map<string, string[]>()
  let lastKey: string | null = null

  for (const rawLine of lines) {
    if (rawLine.trim() === '') continue
    if (/^[ \t]/.test(rawLine)) {
      const listMatch = LIST_ITEM_RE.exec(rawLine)
      if (!listMatch || lastKey === null) continue
      map.get(lastKey)!.push(rawLine)
      continue
    }
    if (rawLine.startsWith('#')) continue
    const match = KEY_VALUE_RE.exec(rawLine)
    if (!match) continue
    const key = match[1].trim()
    lastKey = key
    map.set(key, [rawLine])
  }
  return map
}

// 프론트매터 합치기 + 본문 자리(다듬기만, 줄 배치는 editor/insertTemplate.ts) 계획 (5.3·5.4)
export function planTemplateInsert(docText: string, templateText: string): TemplatePlan {
  if (docText.length === 0) {
    return { frontmatterChange: null, body: trimBlankEdges(templateText), frontmatterSkipped: false }
  }

  const tplFm = findFrontmatter(templateText)
  const tplBodyRaw = tplFm ? textAfterFrontmatter(templateText, tplFm) : templateText
  const body = trimBlankEdges(tplBodyRaw)

  if (!tplFm) {
    return { frontmatterChange: null, body, frontmatterSkipped: false }
  }

  const docFm = findFrontmatter(docText)
  if (!docFm) {
    const tplContent = templateText.slice(tplFm.contentFrom, tplFm.contentTo)
    const insert = `---\n${tplContent}---\n`
    return { frontmatterChange: { from: 0, to: 0, insert }, body, frontmatterSkipped: false }
  }

  const docContent = docText.slice(docFm.contentFrom, docFm.contentTo)
  const tplContent = templateText.slice(tplFm.contentFrom, tplFm.contentTo)
  const docProps = parseSimpleProperties(docContent)
  const tplProps = parseSimpleProperties(tplContent)
  if (docProps === null || tplProps === null) {
    return { frontmatterChange: null, body, frontmatterSkipped: true }
  }

  const docKeys = new Set(docProps.map((p) => p.key))
  const missing = tplProps.filter((p) => !docKeys.has(p.key))
  if (missing.length === 0) {
    return { frontmatterChange: null, body, frontmatterSkipped: false }
  }

  const lineMap = extractPropertyLines(tplContent)
  const insert = missing.map((p) => `${(lineMap.get(p.key) ?? [`${p.key}: `]).join('\n')}\n`).join('')
  return { frontmatterChange: { from: docFm.contentTo, to: docFm.contentTo, insert }, body, frontmatterSkipped: false }
}

// 새 문서 템플릿 설정 — 순수 함수 (specs/features/F-2037.md 2.2)
export const NEW_DOC_TEMPLATE_NONE = 'none'

export type NewDocTemplateResolution =
  | { kind: 'none' }
  | { kind: 'missing' }
  | { kind: 'found'; entry: TemplateEntry }

// entries 에서 id === pref 를 찾기만 한다. 'none' 만 none, 그 밖(모르는 값 포함)은 missing (3.4)
export function resolveNewDocTemplate(pref: string, entries: readonly TemplateEntry[]): NewDocTemplateResolution {
  if (pref === NEW_DOC_TEMPLATE_NONE) return { kind: 'none' }
  const entry = entries.find((e) => e.id === pref)
  return entry ? { kind: 'found', entry } : { kind: 'missing' }
}

// 원문(줄바꿈 무엇이든) → 새 문서 content. 공백·줄바꿈뿐이면 '' (4.3)
export function newDocContentFromTemplate(
  rawText: string,
  vars: { title: string; now: Date; emptyTitle?: 'fallback' | 'keep-empty' },
  lineEnding: LineEnding,
): string {
  const substituted = expandTemplateVariables(toEditorText(rawText), vars)
  if (substituted.trim() === '') return ''
  const body = planTemplateInsert('', substituted).body
  return fromEditorText(body, lineEnding)
}

export type NewDocTemplateOption = { value: string; label: string; group: 'none' | 'builtin' | 'user' | 'missing' }

// 위에서부터 없음 → 내장 → 템플릿 폴더 문서, 설정값이 목록에 없으면 맨 끝에 찾을 수 없는 템플릿 하나 (3.3)
export function newDocTemplateOptions(pref: string, entries: readonly TemplateEntry[]): NewDocTemplateOption[] {
  const builtinEntries = entries.filter((e) => e.source.kind === 'builtin')
  const userEntries = entries.filter((e) => e.source.kind === 'doc')

  const options: NewDocTemplateOption[] = [{ value: NEW_DOC_TEMPLATE_NONE, label: '없음', group: 'none' }]
  for (const e of builtinEntries) options.push({ value: e.id, label: e.title, group: 'builtin' })
  for (const e of userEntries) options.push({ value: e.id, label: `${e.title} (${e.detail})`, group: 'user' })

  if (resolveNewDocTemplate(pref, entries).kind === 'missing') {
    options.push({ value: pref, label: '찾을 수 없는 템플릿', group: 'missing' })
  }
  return options
}

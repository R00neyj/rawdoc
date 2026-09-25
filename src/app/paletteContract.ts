// 명령 팔레트 등록 계약·거르기 — 순수 함수, DOM·React 없음 (specs/features/F-2022.md 3장)
import { normalizeForSearch, foldCase } from '../lib/docSearch'
import type { TemplateEntry } from '../lib/templates'
import type { E2eeStatus } from '../e2ee/keyring'

// 목록 한 줄 — 명령이든 2단계 항목(템플릿)이든 같은 모양 (3.1)
export type PaletteItem = {
  id: string
  label: string
  detail?: string
  keywords?: readonly string[]
}

// 명령이 읽는 화면 상태와 App 이 넘기는 동작 (3.1)
export type PaletteContext = {
  canInsertTemplate: boolean
  canPrint: boolean
  templates: readonly TemplateEntry[]
  insertTemplate: (templateId: string, signal: AbortSignal) => Promise<void>
  printDoc: () => void
  // 금고 잠그기·열기 — 선택 필드. 없으면 두 명령이 안 보인다 (F-404.md 7.6)
  e2ee?: { status: E2eeStatus; lock: () => void; openUnlock: () => void }
}

type PaletteCommandBase = PaletteItem & {
  shortcut?: string
  when: (ctx: PaletteContext) => boolean
}

// 고르면 팔레트를 닫고 바로 실행
export type PaletteActionCommand = PaletteCommandBase & {
  kind: 'action'
  run: (ctx: PaletteContext) => void
}

// 고르면 2단계 목록으로 들어간다
export type PalettePickCommand = PaletteCommandBase & {
  kind: 'pick'
  stageTitle: string
  placeholder: string
  emptyText: string
  hint?: (ctx: PaletteContext) => string | null
  items: (ctx: PaletteContext) => readonly PaletteItem[]
  pick: (item: PaletteItem, ctx: PaletteContext, signal: AbortSignal) => void | Promise<void>
}

export type PaletteCommand = PaletteActionCommand | PalettePickCommand

// 등록 순서를 지키며 when 이 참인 명령만 (3.2)
export function visibleCommands(commands: readonly PaletteCommand[], ctx: PaletteContext): PaletteCommand[] {
  return commands.filter((c) => c.when(ctx))
}

function normalize(text: string): string {
  return foldCase(normalizeForSearch(text))
}

// 정규화한 검색어를 공백으로 쪼갠 조각을 label+detail+keywords 가 모두 부분 문자열로 포함하면 남긴다(AND). label 이 첫 조각으로 시작하는 항목을 앞에 둔다(안정 정렬, 3.4)
export function filterPaletteItems<T extends PaletteItem>(items: readonly T[], query: string): T[] {
  const terms = normalize(query)
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0)

  if (terms.length === 0) return [...items]

  const matched = items.filter((item) => {
    const haystack = normalize([item.label, item.detail ?? '', ...(item.keywords ?? [])].join(' '))
    return terms.every((term) => haystack.includes(term))
  })

  const firstTerm = terms[0]
  const startsWithFirst: T[] = []
  const rest: T[] = []
  for (const item of matched) {
    if (normalize(item.label).startsWith(firstTerm)) startsWithFirst.push(item)
    else rest.push(item)
  }
  return [...startsWithFirst, ...rest]
}

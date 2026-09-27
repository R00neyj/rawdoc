// 명령 팔레트 등록 계약·거르기 — 순수 함수, DOM·React 없음 (specs/features/F-2022.md 3장, F-2053.md 3·5장)
import { prepareMatchText, splitMatchTerms, matchTerm, type MatchText, type MatchTerm } from '../lib/hangulMatch'
import type { TemplateEntry } from '../lib/templates'
import type { E2eeStatus } from '../e2ee/keyring'
import { filterPaletteDocs, PALETTE_DOC_LIMIT, type PaletteDocIndex } from './paletteDocs'
import { PALETTE_RECENT_COMMAND_LIMIT } from './paletteMemory'
import type { ThemePref } from './theme'

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
  // 댓글 달기·레일 열기/닫기 — 선택 필드. 없으면 댓글 명령 둘이 안 보인다 (F-505 3.4)
  comments?: { canAdd: boolean; railOpen: boolean; add: () => void; toggleRail: () => void }
  // 알림함 열기 — 선택 필드. 없으면 명령이 안 보인다 (F-507 3.6)
  notifications?: { open: () => void }
  // 단축키 판 열기 — 선택 필드. 없으면 명령이 안 보인다 (F-2052 6.3)
  shortcuts?: { open: () => void }
  // 문서 열기·새 문서 만들기 — 선택 필드. 없으면 문서·최근 문서 구역과 만들기 줄이 없다 (F-2053 3.1)
  docs?: {
    all: readonly PaletteDoc[]
    recent: readonly PaletteDoc[]
    planCreate: (text: string) => PaletteCreatePlan | null
    open: (id: string, target: 'here' | 'newTab') => void
    create: (plan: PaletteCreatePlan) => void
  }
  // 화면 이동 — 선택 필드. 없으면 이동 명령들이 안 보인다 (F-2054 4.1)
  nav?: {
    screen: PaletteScreen
    openSearch: () => void
    goHome: () => void
    openMap: () => void
    openHelp: () => void
    openGuides: () => void
    openSettings: () => void
    openShares?: () => void
  }
  // 문서 조작 — 선택 필드. 없으면 만들기·지금 문서 명령들이 안 보인다 (F-2054 4.1)
  docActions?: {
    newDoc: () => void
    newFolder: () => void
    importDoc: () => void
    current?: {
      owned: boolean
      pinned: boolean
      openNewTab: () => void
      togglePin: () => void
      move: () => void
      remove: () => void
    }
  }
  // 보기 설정 — 선택 필드. 없으면 모드·사이드바·테마·토글 명령들이 안 보인다 (F-2054 4.1)
  view?: {
    mode: PaletteViewMode | null
    setMode: (mode: PaletteViewMode) => void
    sidebar: 'expanded' | 'collapsed' | 'narrowOpen' | 'narrowClosed'
    toggleSidebar: () => void
    theme: ThemePref
    setTheme: (theme: ThemePref) => void
    lineNumbers: boolean
    toolbar: boolean
    wikiPreview: boolean
    toggleLineNumbers: () => void
    toggleToolbar: () => void
    toggleWikiPreview: () => void
  }
  // 지금 문서 내보내기·공유 — 선택 필드. 없으면 내보내기·복사·초대 명령들이 안 보인다 (F-2054 4.1)
  output?: {
    e2ee: boolean
    exportMd: () => void
    exportTxt: () => void
    exportHtml: () => void
    copyRich: () => void
    copyLink: () => void
    copyMarkdown: () => void
    invite?: () => void
  }
}

export type PaletteScreen = 'doc' | 'home' | 'help' | 'map' | 'shares' | 'sharedLink'
export type PaletteViewMode = 'live' | 'raw' | 'view'

// 화면 하나로 정하기 — App 렌더 우선순위와 같다 (F-2054 4.2)
export function paletteScreen(s: {
  sharedLink: boolean
  shares: boolean
  help: boolean
  map: boolean
  currentDocId: string | null
}): PaletteScreen {
  if (s.sharedLink) return 'sharedLink'
  if (s.shares) return 'shares'
  if (s.help) return 'help'
  if (s.map) return 'map'
  if (s.currentDocId === null) return 'home'
  return 'doc'
}

// 문서 한 줄의 재료 — App 이 docs·folders 로 만든다 (F-2053 4.2)
export type PaletteDoc = {
  id: string
  title: string
  folderPath: string
  shared: boolean
}

// '새 문서 만들기' 줄이 만들 것 (F-2053 6장)
export type PaletteCreatePlan = {
  title: string
  folderId: string | null
  folderPath: string
}

// 입력칸 글 해석 (F-2053 5.3)
export type PaletteQuery = { mode: 'all' | 'commands'; text: string }

export type PaletteSectionKey = 'pinned' | 'recent' | 'recentDocs' | 'docs' | 'commands' | 'create'

export type PaletteRow =
  | { kind: 'command'; key: string; command: PaletteCommand; pinned: boolean }
  | { kind: 'doc'; key: string; doc: PaletteDoc }
  | { kind: 'create'; key: 'create'; plan: PaletteCreatePlan }

export type PaletteSection = {
  key: PaletteSectionKey
  heading: string | null
  rows: readonly PaletteRow[]
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

type Scored<T> = { item: T; stage: 1 | 2 | 3; loose: boolean }

// 조각마다 label→detail→keywords 각각을 순서대로 보고 처음 맞은 곳을 쓴다(3.1 필드마다 따로 비교) — 없으면 그 항목은 제외(AND) (F-2053 4.5)
function scoreItem<T extends PaletteItem>(item: T, terms: readonly MatchTerm[]): Scored<T> | null {
  const labelText = prepareMatchText(item.label)
  const detailText = prepareMatchText(item.detail ?? '')
  const keywordTexts = (item.keywords ?? []).map(prepareMatchText)
  const targets: readonly MatchText[] = [labelText, detailText, ...keywordTexts]

  let usedLoose = false
  for (const term of terms) {
    let hit = null
    for (const text of targets) {
      hit = matchTerm(term, text)
      if (hit) break
    }
    if (!hit) return null
    if (hit.loose) usedLoose = true
  }

  const firstHitOnLabel = matchTerm(terms[0], labelText)
  const stage: 1 | 2 | 3 = firstHitOnLabel?.start
    ? 1
    : terms.every((t) => matchTerm(t, labelText) !== null)
      ? 2
      : 3
  return { item, stage, loose: usedLoose }
}

// label 이 첫 조각으로 시작(①) → 모든 조각이 label 안(②) → 그 밖(③). 같은 단계 안은 느슨한 비교 안 쓴 것 먼저, 그다음 넘겨받은 순서(안정 정렬) (F-2053 4.5)
export function filterPaletteItems<T extends PaletteItem>(items: readonly T[], query: string): T[] {
  const terms = splitMatchTerms(query)
  if (terms.length === 0) return [...items]

  const scored: Scored<T>[] = []
  for (const item of items) {
    const s = scoreItem(item, terms)
    if (s) scored.push(s)
  }
  scored.sort((a, b) => a.stage - b.stage || Number(a.loose) - Number(b.loose))
  return scored.map((s) => s.item)
}

// 팔레트 입력칸 글 해석 — 앞 공백을 뗀 첫 글자가 반각 > 이면 명령 모드 (F-2053 5.3)
export function parsePaletteQuery(raw: string): PaletteQuery {
  const trimmedStart = raw.replace(/^\s+/, '')
  if (trimmedStart.startsWith('>')) {
    return { mode: 'commands', text: trimmedStart.slice(1) }
  }
  return { mode: 'all', text: raw }
}

function pinnedSection(commands: readonly PaletteCommand[], pinnedIds: readonly string[]): PaletteSection | null {
  const visibleIds = new Set(commands.map((c) => c.id))
  const byId = new Map(commands.map((c) => [c.id, c]))
  const rows: PaletteRow[] = pinnedIds
    .filter((id) => visibleIds.has(id))
    .map((id) => ({ kind: 'command', key: id, command: byId.get(id)!, pinned: true }))
  return rows.length > 0 ? { key: 'pinned', heading: '고정', rows } : null
}

function recentSection(
  commands: readonly PaletteCommand[],
  recentIds: readonly string[],
  pinnedIds: readonly string[],
  limit: number,
): PaletteSection | null {
  const visibleIds = new Set(commands.map((c) => c.id))
  const pinnedSet = new Set(pinnedIds)
  const byId = new Map(commands.map((c) => [c.id, c]))
  const rows: PaletteRow[] = recentIds
    .filter((id) => visibleIds.has(id) && !pinnedSet.has(id))
    .slice(0, limit)
    .map((id) => ({ kind: 'command', key: id, command: byId.get(id)!, pinned: false }))
  return rows.length > 0 ? { key: 'recent', heading: '최근', rows } : null
}

function recentDocsSection(recentDocs: readonly PaletteDoc[]): PaletteSection | null {
  if (recentDocs.length === 0) return null
  return {
    key: 'recentDocs',
    heading: '최근 문서',
    rows: recentDocs.map((doc) => ({ kind: 'doc', key: `doc:${doc.id}`, doc })),
  }
}

function docsSection(docs: readonly PaletteDoc[]): PaletteSection | null {
  if (docs.length === 0) return null
  return {
    key: 'docs',
    heading: '문서',
    rows: docs.map((doc) => ({ kind: 'doc', key: `doc:${doc.id}`, doc })),
  }
}

function createSection(plan: PaletteCreatePlan | null): PaletteSection | null {
  if (!plan) return null
  return { key: 'create', heading: null, rows: [{ kind: 'create', key: 'create', plan }] }
}

function remainingCommandsSection(
  commands: readonly PaletteCommand[],
  pinnedIds: readonly string[],
  recentIds: readonly string[],
  recentLimit: number,
  heading: string,
): PaletteSection | null {
  const pinnedSet = new Set(pinnedIds)
  const shownRecentIds = new Set(
    recentIds.filter((id) => commands.some((c) => c.id === id) && !pinnedSet.has(id)).slice(0, recentLimit),
  )
  const rows: PaletteRow[] = commands
    .filter((c) => !pinnedSet.has(c.id) && !shownRecentIds.has(c.id))
    .map((c) => ({ kind: 'command', key: c.id, command: c, pinned: false }))
  return rows.length > 0 ? { key: 'commands', heading, rows } : null
}

function filteredCommandsSection(commands: readonly PaletteCommand[], text: string, pinnedIds: readonly string[]): PaletteSection | null {
  const pinnedSet = new Set(pinnedIds)
  const filtered = filterPaletteItems(commands as readonly PaletteCommand[], text)
  const rows: PaletteRow[] = filtered.map((c) => ({ kind: 'command', key: c.id, command: c, pinned: pinnedSet.has(c.id) }))
  return rows.length > 0 ? { key: 'commands', heading: '명령', rows } : null
}

// 1단계 구역 목록 (F-2053 5장). 빈 구역은 넣지 않는다
export function buildPaletteSections(input: {
  query: PaletteQuery
  commands: readonly PaletteCommand[]
  pinnedIds: readonly string[]
  recentIds: readonly string[]
  docs: PaletteDocIndex | null
  recentDocs: readonly PaletteDoc[]
  createPlan: PaletteCreatePlan | null
}): PaletteSection[] {
  const { query, commands, pinnedIds, recentIds, recentDocs, createPlan } = input
  const sections: (PaletteSection | null)[] = []

  // 공백만 있으면 빈 입력으로 본다 — 고정·최근·최근 문서 구역이 보여야 한다 (main 결정 2026-09-28)
  if (query.text.trim() === '') {
    if (query.mode === 'all') {
      sections.push(
        pinnedSection(commands, pinnedIds),
        recentSection(commands, recentIds, pinnedIds, PALETTE_RECENT_COMMAND_LIMIT),
        input.docs ? recentDocsSection(recentDocs) : null,
        remainingCommandsSection(commands, pinnedIds, recentIds, PALETTE_RECENT_COMMAND_LIMIT, '명령'),
      )
    } else {
      sections.push(
        pinnedSection(commands, pinnedIds),
        recentSection(commands, recentIds, pinnedIds, PALETTE_RECENT_COMMAND_LIMIT),
        remainingCommandsSection(commands, pinnedIds, recentIds, PALETTE_RECENT_COMMAND_LIMIT, '명령'),
      )
    }
  } else if (query.mode === 'all') {
    const docsList = input.docs ? filterPaletteDocs(input.docs, query.text, PALETTE_DOC_LIMIT) : []
    sections.push(
      input.docs ? docsSection(docsList) : null,
      filteredCommandsSection(commands, query.text, pinnedIds),
      createSection(createPlan),
    )
  } else {
    sections.push(filteredCommandsSection(commands, query.text, pinnedIds))
  }

  return sections.filter((s): s is PaletteSection => s !== null)
}

// 설치 앱 문서 탭 상태 기계 — 순수 함수. 키는 문자열이라 문서 id 밖의 항목(file:… 등)도 같은 자리에 든다 (small 2026-10-21)

export type DocTab = { key: string; pinned: boolean; title: string; shared?: true }
export type DocTabsState = { tabs: DocTab[]; active: string | null }
export type OpenMode = 'preview' | 'pinned'
export type TabMeta = { title: string; shared: boolean }

export const EMPTY_TABS: DocTabsState = { tabs: [], active: null }

function withMeta(key: string, pinned: boolean, title: string, shared?: boolean): DocTab {
  return shared ? { key, pinned, title, shared: true } : { key, pinned, title }
}

export function openTab(s: DocTabsState, entry: { key: string; title: string; shared?: boolean }, mode: OpenMode): DocTabsState {
  const existing = s.tabs.findIndex((tab) => tab.key === entry.key)
  if (existing >= 0) {
    const next = mode === 'pinned' ? pinTab(s, entry.key) : s
    return next.active === entry.key ? next : { ...next, active: entry.key }
  }
  const tab = withMeta(entry.key, mode === 'pinned', entry.title, entry.shared)
  const previewAt = mode === 'preview' ? s.tabs.findIndex((t) => !t.pinned) : -1
  if (previewAt >= 0) {
    const tabs = s.tabs.slice()
    tabs[previewAt] = tab
    return { tabs, active: entry.key }
  }
  const activeAt = s.tabs.findIndex((t) => t.key === s.active)
  const at = activeAt >= 0 ? activeAt + 1 : s.tabs.length
  return { tabs: [...s.tabs.slice(0, at), tab, ...s.tabs.slice(at)], active: entry.key }
}

export function pinTab(s: DocTabsState, key: string): DocTabsState {
  const tab = s.tabs.find((t) => t.key === key)
  if (!tab || tab.pinned) return s
  return { ...s, tabs: s.tabs.map((t) => (t.key === key ? { ...t, pinned: true } : t)) }
}

// 닫힌 활성 탭의 다음 활성은 원래 자리 기준 오른쪽, 없으면 왼쪽
export function closeTabs(s: DocTabsState, keys: readonly string[]): DocTabsState {
  const closing = new Set(keys)
  if (!s.tabs.some((t) => closing.has(t.key))) return s
  const tabs = s.tabs.filter((t) => !closing.has(t.key))
  if (s.active === null || !closing.has(s.active)) return { tabs, active: s.active }
  const activeAt = s.tabs.findIndex((t) => t.key === s.active)
  const right = s.tabs.slice(activeAt + 1).find((t) => !closing.has(t.key))
  const left = s.tabs.slice(0, activeAt).reverse().find((t) => !closing.has(t.key))
  return { tabs, active: (right ?? left)?.key ?? null }
}

export function closeOtherTabs(s: DocTabsState, key: string): DocTabsState {
  const next = closeTabs(s, s.tabs.filter((t) => t.key !== key).map((t) => t.key))
  return next.tabs.length === 1 && next.active !== key ? { ...next, active: key } : next
}

export function closeTabsToRight(s: DocTabsState, key: string): DocTabsState {
  const at = s.tabs.findIndex((t) => t.key === key)
  if (at < 0) return s
  return closeTabs(s, s.tabs.slice(at + 1).map((t) => t.key))
}

export function moveTab(s: DocTabsState, key: string, toIndex: number): DocTabsState {
  const from = s.tabs.findIndex((t) => t.key === key)
  if (from < 0) return s
  const rest = s.tabs.filter((t) => t.key !== key)
  const to = Math.max(0, Math.min(toIndex, rest.length))
  if (to === from) return s
  return { ...s, tabs: [...rest.slice(0, to), s.tabs[from], ...rest.slice(to)] }
}

export function stepTab(s: DocTabsState, dir: 1 | -1): string | null {
  const n = s.tabs.length
  if (n === 0) return null
  const at = s.tabs.findIndex((t) => t.key === s.active)
  if (at < 0) return s.tabs[dir === 1 ? 0 : n - 1].key
  return s.tabs[(at + dir + n) % n].key
}

// 목록에 있는 문서만 제목·공유 표시를 맞춘다. 목록에서 사라진 공유 문서 탭은 마지막 제목을 그대로 쓴다
export function syncTabMeta(s: DocTabsState, lookup: (key: string) => TabMeta | undefined): DocTabsState {
  let changed = false
  const tabs = s.tabs.map((tab) => {
    const meta = lookup(tab.key)
    if (!meta || (meta.title === tab.title && meta.shared === Boolean(tab.shared))) return tab
    changed = true
    return withMeta(tab.key, tab.pinned, meta.title, meta.shared)
  })
  return changed ? { ...s, tabs } : s
}

export function restoreTabs(s: DocTabsState, exists: (key: string) => boolean): DocTabsState {
  return closeTabs(s, s.tabs.filter((t) => !t.shared && !exists(t.key)).map((t) => t.key))
}

// 목록에서 사라진 내 문서 탭 — 지금 문서로 남아 있으면(다른 창에서 지워짐 화면) 닫지 않는다
export function removedTabKeys(input: {
  tabs: readonly DocTab[]
  prevIds: ReadonlySet<string>
  nextIds: ReadonlySet<string>
  currentKey: string | null
}): string[] {
  const { tabs, prevIds, nextIds, currentKey } = input
  return tabs.filter((t) => !t.shared && t.key !== currentKey && prevIds.has(t.key) && !nextIds.has(t.key)).map((t) => t.key)
}

export function chooseOpenMode(input: { key: string; pendingPinKey: string | null; pinIntent: boolean; isNewDoc: boolean }): OpenMode {
  return input.pendingPinKey === input.key || input.pinIntent || input.isNewDoc ? 'pinned' : 'preview'
}

type StoredMap = Record<string, unknown>

function readMap(raw: string): StoredMap | null {
  if (!raw) return {}
  try {
    const value: unknown = JSON.parse(raw)
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as StoredMap) : null
  } catch {
    return null
  }
}

export function parseStoredTabs(raw: string, scope: string): DocTabsState | null {
  const entry = readMap(raw)?.[scope] as { tabs?: unknown; active?: unknown } | undefined
  if (!entry || !Array.isArray(entry.tabs)) return null
  const seen = new Set<string>()
  let previewSeen = false
  const tabs: DocTab[] = []
  for (const item of entry.tabs as Array<Record<string, unknown>>) {
    if (!item || typeof item.key !== 'string' || seen.has(item.key)) continue
    seen.add(item.key)
    const pinned = item.pinned !== false || previewSeen
    if (!pinned) previewSeen = true
    tabs.push(withMeta(item.key, pinned, typeof item.title === 'string' ? item.title : '', item.shared === true))
  }
  const active = typeof entry.active === 'string' && seen.has(entry.active) ? entry.active : null
  return { tabs, active }
}

export function storeTabs(raw: string, scope: string, s: DocTabsState): string {
  return JSON.stringify({ ...(readMap(raw) ?? {}), [scope]: { tabs: s.tabs, active: s.active } })
}

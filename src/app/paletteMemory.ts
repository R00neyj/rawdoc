// 팔레트 최근·고정 명령 id 목록 — 순수 함수, localStorage 접근은 CommandPalette.tsx 가 prefs.ts 를 거쳐 한다 (specs/features/F-2053.md 7장)

export const PALETTE_RECENT_STORE_LIMIT = 10
export const PALETTE_RECENT_COMMAND_LIMIT = 5

// JSON 이 아니거나 배열이 아니면 []. 문자열이 아닌 원소·빈 문자열·known 에 없는 id·중복(두 번째부터)은 뺀다 (7.4)
export function parseCommandIds(raw: string, known: ReadonlySet<string>): string[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []

  const seen = new Set<string>()
  const result: string[] = []
  for (const item of parsed) {
    if (typeof item !== 'string' || item === '' || !known.has(item) || seen.has(item)) continue
    seen.add(item)
    result.push(item)
  }
  return result
}

// 맨 앞에 넣고, 뒤에 같은 id 가 있으면 뺀다. 상한 10 (7.1)
export function pushRecentCommand(ids: readonly string[], id: string): string[] {
  return [id, ...ids.filter((x) => x !== id)].slice(0, PALETTE_RECENT_STORE_LIMIT)
}

// 있으면 빼고, 없으면 맨 뒤에 더한다 (7.2)
export function togglePinnedCommand(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]
}

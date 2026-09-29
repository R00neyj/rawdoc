// 사용자 CSS 두 슬롯 읽기·로컬 슬롯 쓰기·부팅 값 쓰기·같은 탭 변경 알림 (specs/features/F-2095.md 6장)
import { getPref, trySetPref } from './prefs'
import { compileCached } from './userCssApply'
import { USER_CSS_BOOT_KEY } from './bootPaint'
import {
  USER_CSS_CHECKER_VERSION,
  USER_CSS_MAX_SNIPPETS,
  buildUserCssBoot,
  checkUserCssLimits,
  validateUserCssSnippets,
  type UserCssCompiled,
  type UserCssSnippet,
} from '../lib/userCssPolicy'
import { diffPending } from './userCssSync'

export const USER_CSS_KEY = 'md.userCss'
export const USER_CSS_ACCOUNT_KEY = 'md.userCssAccount'

export type UserCssSources = { local: UserCssSnippet[]; account: { userId: string; snippets: UserCssSnippet[] } | null }
export type UserCssOrigin = 'self' | 'remote'

function parseObject(raw: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(raw)
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function validSnippets(value: unknown): UserCssSnippet[] | null {
  const result = validateUserCssSnippets(value)
  return result.ok ? result.snippets : null
}

export function readUserCssSources(): UserCssSources {
  const local = validSnippets(parseObject(getPref(USER_CSS_KEY, ''))?.snippets) ?? []
  const slot = parseObject(getPref(USER_CSS_ACCOUNT_KEY, ''))
  const userId = slot?.userId
  const snippets = validSnippets(slot?.snippets)
  const account = typeof userId === 'string' && userId !== '' && snippets ? { userId, snippets } : null
  return { local, account }
}

export function selectSlot(sources: UserCssSources, accountId: string | null): UserCssSnippet[] {
  if (accountId === null) return sources.local
  return sources.account && sources.account.userId === accountId ? sources.account.snippets : []
}

// 부팅 스크립트 3~5단계와 같은 규칙으로 부팅이 붙일 목록, 못 붙이면 []
function bootSheets(raw: string, accountId: string | null): unknown[] {
  const boot = parseObject(raw)
  if (!boot || boot.v !== USER_CSS_CHECKER_VERSION) return []
  const account = boot.account as { userId?: unknown; sheets?: unknown } | null
  let list: unknown = null
  if (accountId === null) list = boot.local
  else if (account && typeof account === 'object' && account.userId === accountId) list = account.sheets
  if (!Array.isArray(list) || list.length > USER_CSS_MAX_SNIPPETS || list.some((s) => typeof s !== 'string')) return []
  return list
}

export function isBootCurrent(raw: string, accountId: string | null, texts: readonly string[]): boolean {
  const list = bootSheets(raw, accountId)
  return list.length === texts.length && list.every((text, i) => text === texts[i])
}

export function writeUserCssBoot(sources: UserCssSources, compile: (s: string) => UserCssCompiled = compileCached): boolean {
  return trySetPref(USER_CSS_BOOT_KEY, JSON.stringify(buildUserCssBoot(sources.local, sources.account, compile)))
}

export function saveLocalSnippets(
  snippets: readonly UserCssSnippet[],
  compile: (s: string) => UserCssCompiled = compileCached,
): 'ok' | 'count' | 'bytes' | 'invalid' | 'quota' {
  const limit = checkUserCssLimits(snippets)
  if (limit) return limit
  const local = validSnippets(snippets)
  if (!local) return 'invalid'
  if (!trySetPref(USER_CSS_KEY, JSON.stringify({ snippets: local }))) return 'quota'
  // 낡은 결과를 부팅에 두느니 비워서 앱이 한 번 늦게 칠하게 한다 (6장)
  if (!writeUserCssBoot({ local, account: readUserCssSources().account }, compile)) trySetPref(USER_CSS_BOOT_KEY, '')
  notifyUserCssChanged('self')
  return 'ok'
}

export type UserCssPending = { upserts: string[]; deletes: string[] }
export type UserCssAccountSlot = {
  userId: string
  rev: number
  snippets: UserCssSnippet[]
  pending: UserCssPending
  mergedLocal: boolean
  fetchedAt: number
  etag: string
}

const SNIPPET_ID = /^[0-9a-f]{16}$/

function idList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && SNIPPET_ID.test(v)) : []
}

export function readAccountSlot(): UserCssAccountSlot | null {
  const slot = parseObject(getPref(USER_CSS_ACCOUNT_KEY, ''))
  const userId = slot?.userId
  const snippets = validSnippets(slot?.snippets)
  if (!slot || typeof userId !== 'string' || userId === '' || !snippets) return null
  const pending = slot.pending as { upserts?: unknown; deletes?: unknown } | null
  const isObj = typeof pending === 'object' && pending !== null
  return {
    userId,
    rev: typeof slot.rev === 'number' && Number.isSafeInteger(slot.rev) && slot.rev >= 0 ? slot.rev : 0,
    snippets,
    pending: { upserts: idList(isObj ? pending.upserts : null), deletes: idList(isObj ? pending.deletes : null) },
    mergedLocal: slot.mergedLocal === true,
    fetchedAt: typeof slot.fetchedAt === 'number' && Number.isFinite(slot.fetchedAt) ? slot.fetchedAt : 0,
    etag: typeof slot.etag === 'string' ? slot.etag : '',
  }
}

export function emptyAccountSlot(userId: string): UserCssAccountSlot {
  return { userId, rev: 0, snippets: [], pending: { upserts: [], deletes: [] }, mergedLocal: false, fetchedAt: 0, etag: '' }
}

export function writeAccountSlot(
  slot: UserCssAccountSlot,
  origin: UserCssOrigin,
  compile: (s: string) => UserCssCompiled = compileCached,
): boolean {
  if (!trySetPref(USER_CSS_ACCOUNT_KEY, JSON.stringify(slot))) return false
  if (!writeUserCssBoot(readUserCssSources(), compile)) trySetPref(USER_CSS_BOOT_KEY, '')
  notifyUserCssChanged(origin)
  return true
}

export function editableSnippets(accountId: string | null): UserCssSnippet[] {
  if (accountId === null) return readUserCssSources().local
  const slot = readUserCssSources().account
  return slot && slot.userId === accountId ? slot.snippets : []
}

export function saveUserCssSnippets(
  accountId: string | null,
  next: readonly UserCssSnippet[],
  compile: (s: string) => UserCssCompiled = compileCached,
): 'ok' | 'count' | 'bytes' | 'invalid' | 'quota' {
  if (accountId === null) return saveLocalSnippets(next, compile)
  const limit = checkUserCssLimits(next)
  if (limit) return limit
  const snippets = validSnippets(next)
  if (!snippets) return 'invalid'
  const found = readAccountSlot()
  const slot = found && found.userId === accountId ? found : emptyAccountSlot(accountId)
  const pending = diffPending(slot.snippets, snippets, slot.pending)
  return writeAccountSlot({ ...slot, snippets, pending }, 'self', compile) ? 'ok' : 'quota'
}

const listeners = new Set<(origin: UserCssOrigin) => void>()

export function notifyUserCssChanged(origin: UserCssOrigin): void {
  for (const listener of [...listeners]) listener(origin)
}

export function subscribeUserCss(listener: (origin: UserCssOrigin) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

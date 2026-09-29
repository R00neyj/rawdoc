// 사용자 CSS 계정 동기화 — 순수 함수, 받기·보내기 엔진, 훅 (specs/features/F-2099.md)
import { useEffect } from 'react'
import { newSnippetId, userCssSaveMessage } from './userCssEdit'
import {
  emptyAccountSlot,
  readAccountSlot,
  readUserCssSources,
  subscribeUserCss,
  writeAccountSlot,
  type UserCssAccountSlot,
  type UserCssPending,
} from './userCssStore'
import {
  USER_CSS_MAX_NAME_LENGTH,
  checkUserCssLimits,
  validateUserCssSnippets,
  type UserCssSnippet,
} from '../lib/userCssPolicy'

export const USER_CSS_PUSH_DELAY_MS = 2_000
export const USER_CSS_PULL_GAP_MS = 600_000
const MAX_PUTS = 3
const BROWSER_SUFFIX = ' (이 브라우저)'

const sameSnippet = (a: UserCssSnippet, b: UserCssSnippet) =>
  a.name === b.name && a.css === b.css && a.enabled === b.enabled && a.updatedAt === b.updatedAt

export function diffPending(prev: readonly UserCssSnippet[], next: readonly UserCssSnippet[], pending: UserCssPending): UserCssPending {
  const prevById = new Map(prev.map((s) => [s.id, s]))
  const nextIds = new Set(next.map((s) => s.id))
  const upserts = pending.upserts.filter((id) => nextIds.has(id))
  for (const s of next) {
    const before = prevById.get(s.id)
    if ((!before || !sameSnippet(before, s)) && !upserts.includes(s.id)) upserts.push(s.id)
  }
  const deletes = pending.deletes.filter((id) => !nextIds.has(id))
  for (const s of prev) if (!nextIds.has(s.id) && !deletes.includes(s.id)) deletes.push(s.id)
  return { upserts, deletes }
}

export function rebaseUserCss(server: readonly UserCssSnippet[], local: readonly UserCssSnippet[], pending: UserCssPending): UserCssSnippet[] {
  const localById = new Map(local.map((s) => [s.id, s]))
  const upserts = new Set(pending.upserts)
  const deletes = new Set(pending.deletes)
  const seen = new Set(server.map((s) => s.id))
  const out: UserCssSnippet[] = []
  for (const s of server) {
    if (deletes.has(s.id)) continue
    out.push(upserts.has(s.id) ? (localById.get(s.id) ?? s) : s)
  }
  for (const s of local) if (upserts.has(s.id) && !seen.has(s.id)) out.push(s)
  return out
}

function suffixedName(name: string): string {
  const full = `${name}${BROWSER_SUFFIX}`
  if (full.length <= USER_CSS_MAX_NAME_LENGTH) return full
  let base = name.slice(0, USER_CSS_MAX_NAME_LENGTH - BROWSER_SUFFIX.length)
  const last = base.charCodeAt(base.length - 1)
  if (last >= 0xd800 && last <= 0xdbff) base = base.slice(0, -1)
  return `${base.trimEnd()}${BROWSER_SUFFIX}`
}

export function mergeLocalIntoAccount(
  account: readonly UserCssSnippet[],
  local: readonly UserCssSnippet[],
  newId: () => string,
  now: number,
): { snippets: UserCssSnippet[]; added: string[] } {
  const snippets = [...account]
  const added: string[] = []
  for (const s of local) {
    if (snippets.some((a) => a.name === s.name && a.css === s.css)) continue
    const name = snippets.some((a) => a.name === s.name) ? suffixedName(s.name) : s.name
    const candidate = [...snippets, { id: newId(), name, css: s.css, enabled: s.enabled, updatedAt: now }]
    if (checkUserCssLimits(candidate)) continue
    snippets.push(candidate[candidate.length - 1])
    added.push(candidate[candidate.length - 1].id)
  }
  return { snippets, added }
}

export function settlePending(sent: readonly UserCssSnippet[], sentPending: UserCssPending, current: UserCssAccountSlot): UserCssPending {
  const sentById = new Map(sent.map((s) => [s.id, s]))
  const currentById = new Map(current.snippets.map((s) => [s.id, s]))
  const upserts = current.pending.upserts.filter((id) => {
    if (!sentPending.upserts.includes(id)) return true
    const a = sentById.get(id)
    const b = currentById.get(id)
    return !a || !b || !sameSnippet(a, b)
  })
  return { upserts, deletes: current.pending.deletes.filter((id) => !sentPending.deletes.includes(id)) }
}

export type UserCssSyncError = '' | 'offline' | 'conflict' | 'count' | 'bytes' | 'invalid'

export function userCssSyncMessage(error: Exclude<UserCssSyncError, ''>): string {
  if (error === 'offline') return '계정에 저장하지 못했습니다. 연결되면 다시 보냅니다.'
  if (error === 'conflict') return '다른 기기에서 바뀐 내용과 합치지 못했습니다. 다시 열어 확인해 주세요.'
  return userCssSaveMessage(error)
}

let syncError: UserCssSyncError = ''
const errorListeners = new Set<() => void>()

function setSyncError(next: UserCssSyncError): void {
  if (next === syncError) return
  syncError = next
  for (const listener of [...errorListeners]) listener()
}

export function getUserCssSyncError(): UserCssSyncError {
  return syncError
}

export function subscribeUserCssSyncError(listener: () => void): () => void {
  errorListeners.add(listener)
  return () => {
    errorListeners.delete(listener)
  }
}

export type UserCssSyncDeps = {
  fetch?: typeof fetch
  now?: () => number
  newId?: () => string
}

const isRev = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json()
  } catch {
    return null
  }
}

export function createUserCssSyncEngine(deps: UserCssSyncDeps = {}) {
  const doFetch: typeof fetch = deps.fetch ?? ((input, init) => globalThis.fetch(input, init))
  const now = deps.now ?? (() => Date.now())
  const newId = deps.newId ?? (() => newSnippetId(crypto.getRandomValues(new Uint8Array(8))))
  let accountId: string | null = null
  let blocked = false
  let chain: Promise<void> = Promise.resolve()
  let timer: ReturnType<typeof setTimeout> | undefined

  const run = (task: () => Promise<void>): Promise<void> => {
    chain = chain.then(task).catch(() => {})
    return chain
  }
  const clearTimer = () => {
    clearTimeout(timer)
    timer = undefined
  }
  const currentSlot = (): UserCssAccountSlot | null => {
    const slot = readAccountSlot()
    return slot && slot.userId === accountId ? slot : null
  }

  async function pullTask(useEtag: boolean, thenPush: boolean): Promise<boolean> {
    const id = accountId
    if (id === null) return false
    if (!currentSlot()) writeAccountSlot(emptyAccountSlot(id), 'remote')
    const etag = useEtag ? (currentSlot()?.etag ?? '') : ''
    let res: Response
    try {
      res = await doFetch('/api/user-css', {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: etag ? { 'If-None-Match': etag } : {},
      })
    } catch {
      return false
    }
    const slot = currentSlot()
    if (!slot || accountId !== id) return false
    if (res.status === 304) {
      writeAccountSlot({ ...slot, fetchedAt: now() }, 'remote')
      if (thenPush) await pushTask()
      return true
    }
    if (!res.ok) return false
    const body = (await readJson(res)) as { snippets?: unknown; rev?: unknown } | null
    const valid = body ? validateUserCssSnippets(body.snippets) : null
    if (!body || !valid || !valid.ok || !isRev(body.rev)) return false
    let snippets = rebaseUserCss(valid.snippets, slot.snippets, slot.pending)
    let pending = slot.pending
    let mergedLocal = slot.mergedLocal
    if (!mergedLocal) {
      const merged = mergeLocalIntoAccount(snippets, readUserCssSources().local, newId, now())
      snippets = merged.snippets
      pending = { upserts: [...pending.upserts, ...merged.added], deletes: pending.deletes }
      mergedLocal = true
    }
    writeAccountSlot({ ...slot, snippets, pending, mergedLocal, rev: body.rev, etag: res.headers.get('etag') ?? '', fetchedAt: now() }, 'remote')
    if (thenPush) await pushTask()
    return true
  }

  async function pushTask(): Promise<void> {
    const id = accountId
    for (let attempt = 0; attempt < MAX_PUTS; attempt++) {
      const slot = currentSlot()
      if (id === null || !slot || (slot.pending.upserts.length === 0 && slot.pending.deletes.length === 0) || blocked) return
      const limit = checkUserCssLimits(slot.snippets)
      if (limit) return setSyncError(limit)
      let res: Response
      try {
        res = await doFetch('/api/user-css', {
          method: 'PUT',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ snippets: slot.snippets, baseRev: slot.rev }),
        })
      } catch {
        return setSyncError('offline')
      }
      if (res.status === 200) {
        const body = (await readJson(res)) as { rev?: unknown } | null
        if (!body || !isRev(body.rev)) return setSyncError('offline')
        const cur = currentSlot()
        if (cur) writeAccountSlot({ ...cur, rev: body.rev, etag: '', pending: settlePending(slot.snippets, slot.pending, cur) }, 'remote')
        return setSyncError('')
      }
      if (res.status === 409) {
        if (attempt === MAX_PUTS - 1) return setSyncError('conflict')
        if (!(await pullTask(false, false))) return setSyncError('offline')
        continue
      }
      if (res.status === 413) return setSyncError('bytes')
      if (res.status === 400) return setSyncError('invalid')
      if (res.status === 401) return
      return setSyncError('offline')
    }
  }

  return {
    start(id: string | null): Promise<void> {
      accountId = id
      clearTimer()
      setSyncError('')
      if (id === null) return Promise.resolve()
      return run(async () => void (await pullTask(true, true)))
    },
    setBlocked(next: boolean): void {
      blocked = next
    },
    pull(): Promise<void> {
      return accountId === null ? Promise.resolve() : run(async () => void (await pullTask(true, true)))
    },
    flush(): Promise<void> {
      clearTimer()
      return accountId === null ? Promise.resolve() : run(pushTask)
    },
    onOnline(): Promise<void> {
      return accountId === null ? Promise.resolve() : run(pushTask)
    },
    onVisible(): Promise<void> {
      if (accountId === null) return Promise.resolve()
      const fetchedAt = currentSlot()?.fetchedAt ?? 0
      return now() - fetchedAt >= USER_CSS_PULL_GAP_MS ? run(async () => void (await pullTask(true, true))) : Promise.resolve()
    },
    onSelfChange(): void {
      const slot = currentSlot()
      if (accountId === null || !slot || (slot.pending.upserts.length === 0 && slot.pending.deletes.length === 0)) return
      clearTimer()
      timer = setTimeout(() => {
        timer = undefined
        void run(pushTask)
      }, USER_CSS_PUSH_DELAY_MS)
    },
  }
}

const engine = createUserCssSyncEngine()

export function requestUserCssPull(): void {
  void engine.pull()
}

export function flushUserCssPush(): void {
  void engine.flush()
}

export function useUserCssSync({ accountId, blocked }: { accountId: string | null; blocked: boolean }): void {
  useEffect(() => {
    engine.setBlocked(blocked)
  }, [blocked])

  useEffect(() => {
    void engine.start(accountId)
    if (accountId === null) return
    const onOnline = () => void engine.onOnline()
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void engine.onVisible()
    }
    const unsubscribe = subscribeUserCss((origin) => {
      if (origin === 'self') engine.onSelfChange()
    })
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      unsubscribe()
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisibility)
      void engine.start(null)
    }
  }, [accountId])
}

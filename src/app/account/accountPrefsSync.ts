// 계정 설정 동기화 — 시작·다시 보일 때 받고, 바꾸면 올린다. 마지막에 쓴 값이 이긴다 (small 2026-11-04)
import { useEffect } from 'react'
import { getPref, setPref } from '../prefs'
import { changeLineBreaks, subscribeLineBreaks } from '../appearance/lineBreaksPref'
import { ACCOUNT_PREF_KEYS, pickAccountPrefs, type AccountPrefKey, type AccountPrefs } from '../../lib/account/accountPrefsPolicy'

export const ACCOUNT_PREFS_PULL_GAP_MS = 60_000

export function mergePulled(server: AccountPrefs, local: AccountPrefs, dirty: readonly AccountPrefKey[]): { apply: AccountPrefs; push: AccountPrefs } {
  const apply: Record<string, unknown> = {}
  const push: Record<string, unknown> = {}
  for (const key of ACCOUNT_PREF_KEYS) {
    if (dirty.includes(key) && local[key] !== undefined) push[key] = local[key]
    else if (server[key] !== undefined) apply[key] = server[key]
    else if (local[key] !== undefined) push[key] = local[key]
  }
  return { apply: apply as AccountPrefs, push: push as AccountPrefs }
}

export type AccountPrefsSyncDeps = {
  fetch?: typeof fetch
  now?: () => number
  readLocal: () => AccountPrefs
  applyRemote: (prefs: AccountPrefs) => void
  readDirty: () => AccountPrefKey[]
  writeDirty: (keys: AccountPrefKey[]) => void
}

const URL = '/api/user-prefs'
const hasAny = (prefs: AccountPrefs) => Object.keys(prefs).length > 0

async function readPrefs(res: Response): Promise<AccountPrefs | null> {
  try {
    const body = (await res.json()) as { prefs?: unknown }
    return pickAccountPrefs(body.prefs)
  } catch {
    return null
  }
}

export function createAccountPrefsSync(deps: AccountPrefsSyncDeps) {
  const doFetch: typeof fetch = deps.fetch ?? ((input, init) => globalThis.fetch(input, init))
  const now = deps.now ?? (() => Date.now())
  let accountId: string | null = null
  let pulledAt = -Infinity
  let chain: Promise<void> = Promise.resolve()

  const run = (task: () => Promise<void>): Promise<void> => {
    chain = chain.then(task).catch(() => {})
    return chain
  }

  async function push(prefs: AccountPrefs): Promise<void> {
    const id = accountId
    if (id === null || !hasAny(prefs)) return
    const res = await doFetch(URL, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prefs }),
    })
    if (!res.ok || accountId !== id) return
    const local = deps.readLocal()
    deps.writeDirty(deps.readDirty().filter((key) => prefs[key] === undefined || local[key] !== prefs[key]))
  }

  async function pull(): Promise<void> {
    const id = accountId
    if (id === null) return
    const res = await doFetch(URL, { credentials: 'same-origin', cache: 'no-store' })
    if (!res.ok || accountId !== id) return
    const server = await readPrefs(res)
    if (!server || accountId !== id) return
    pulledAt = now()
    const merged = mergePulled(server, deps.readLocal(), deps.readDirty())
    if (hasAny(merged.apply)) deps.applyRemote(merged.apply)
    await push(merged.push)
  }

  const dirtyPrefs = (): AccountPrefs => {
    const local = deps.readLocal() as Record<string, unknown>
    return Object.fromEntries(deps.readDirty().filter((k) => local[k] !== undefined).map((k) => [k, local[k]])) as AccountPrefs
  }

  return {
    start(id: string | null): Promise<void> {
      accountId = id
      pulledAt = -Infinity
      return id === null ? Promise.resolve() : run(pull)
    },
    onLocalChange(key: AccountPrefKey): Promise<void> {
      if (accountId === null) return Promise.resolve()
      const dirty = deps.readDirty()
      if (!dirty.includes(key)) deps.writeDirty([...dirty, key])
      return run(() => push(dirtyPrefs()))
    },
    onOnline(): Promise<void> {
      return accountId === null ? Promise.resolve() : run(() => push(dirtyPrefs()))
    },
    onVisible(): Promise<void> {
      return accountId !== null && now() - pulledAt >= ACCOUNT_PREFS_PULL_GAP_MS ? run(pull) : Promise.resolve()
    },
  }
}

function readDirty(): AccountPrefKey[] {
  try {
    const keys: unknown = JSON.parse(getPref('md.accountPrefsDirty', '[]'))
    return Array.isArray(keys) ? ACCOUNT_PREF_KEYS.filter((k) => keys.includes(k)) : []
  } catch {
    return []
  }
}

const engine = createAccountPrefsSync({
  readLocal: () => pickAccountPrefs({ lineBreaks: getPref('md.lineBreaks', '') }),
  applyRemote: (prefs) => {
    if (prefs.lineBreaks) changeLineBreaks(prefs.lineBreaks === 'on', 'remote')
  },
  readDirty,
  writeDirty: (keys) => setPref('md.accountPrefsDirty', JSON.stringify(keys)),
})

export function useAccountPrefsSync(accountId: string | null): void {
  useEffect(() => {
    void engine.start(accountId)
    if (accountId === null) return
    const onOnline = () => void engine.onOnline()
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void engine.onVisible()
    }
    const unsubscribe = subscribeLineBreaks((origin) => {
      if (origin === 'self') void engine.onLocalChange('lineBreaks')
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

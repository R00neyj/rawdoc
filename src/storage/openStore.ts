// 저장소 고르기 — 로그인 상태면 서버 저장소, 그 외엔 IndexedDB, 실패하면 메모리 (specs/features/F-207.md 2.6)
import { createIdbStore, type IdbStoreHandlers } from './idbStore'
import { createMemoryStore } from './memoryStore'
import { createServerStore, type ServerStoreHandlers } from './serverStore'
import type { Store } from '../types'

export type OpenStoreAccount = { state: 'in'; id: string } | { state: 'out' } | { state: 'offline' }

export type OpenStoreHandlers = IdbStoreHandlers &
  ServerStoreHandlers & {
    account: OpenStoreAccount
  }

// md.account 는 architecture.md 4장 문서화된 키다 — storage 는 app 을 import 하지 않으므로 직접 읽는다
function readStoredAccountId(): string | null {
  try {
    const raw = localStorage.getItem('md.account')
    if (!raw) return null
    const parsed = JSON.parse(raw) as { id?: unknown }
    return typeof parsed.id === 'string' ? parsed.id : null
  } catch {
    return null
  }
}

// handlers 는 createIdbStore·createServerStore 에 그대로 전달한다
export async function openStore({ account, onConflict, onNotice, dbName, ...idbHandlers }: OpenStoreHandlers): Promise<Store> {
  if (account.state === 'in') {
    return createServerStore(account.id, { onConflict, onNotice, dbName })
  }
  if (account.state === 'offline') {
    const storedId = readStoredAccountId()
    if (storedId) return createServerStore(storedId, { onConflict, onNotice, dbName })
  }
  if (typeof indexedDB === 'undefined') {
    return createMemoryStore()
  }
  try {
    return await createIdbStore(undefined, idbHandlers)
  } catch {
    return createMemoryStore()
  }
}

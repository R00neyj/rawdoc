// 금고 키 묶음 출처 — 로컬(기기)·계정(서버 + 기기 캐시) (specs/features/F-404.md 5.3)
import { deleteE2eeRow, readE2eeRow, writeE2eeRow } from '../storage/idbStore'
import { deleteKeys, getKeys, putKeys } from './keysApi'

export type E2eeBundleRead =
  | { kind: 'found'; bundle: string; rev: number }
  | { kind: 'none' }
  | { kind: 'error'; reason: 'offline' | 'failed' }
export type E2eeBundleWrite =
  | { kind: 'ok' }
  | { kind: 'conflict' }
  | { kind: 'not-empty'; docs: number; folders: number } // remove 만
  | { kind: 'error'; reason: 'offline' | 'rate-limited' | 'account-blocked' | 'failed' }

export type E2eeBundleSource = {
  read(): Promise<E2eeBundleRead>
  create(bundle: string): Promise<E2eeBundleWrite> // 없을 때만
  replace(bundle: string, expected: { bundle: string; rev: number }): Promise<E2eeBundleWrite>
  remove(): Promise<E2eeBundleWrite>
}

export function createLocalBundleSource(dbName?: string): E2eeBundleSource {
  const id = 'local' as const

  return {
    async read() {
      try {
        const row = await readE2eeRow(id, dbName)
        if (!row) return { kind: 'none' }
        return { kind: 'found', bundle: row.bundle, rev: 0 }
      } catch {
        return { kind: 'error', reason: 'failed' }
      }
    },
    async create(bundle) {
      try {
        const ok = await writeE2eeRow({ id, bundle, updatedAt: Date.now() }, { absent: true }, dbName)
        return ok ? { kind: 'ok' } : { kind: 'conflict' }
      } catch {
        return { kind: 'error', reason: 'failed' }
      }
    },
    async replace(bundle, expected) {
      try {
        const ok = await writeE2eeRow({ id, bundle, updatedAt: Date.now() }, { bundle: expected.bundle }, dbName)
        return ok ? { kind: 'ok' } : { kind: 'conflict' }
      } catch {
        return { kind: 'error', reason: 'failed' }
      }
    },
    async remove() {
      try {
        await deleteE2eeRow(id, dbName)
        return { kind: 'ok' }
      } catch {
        return { kind: 'error', reason: 'failed' }
      }
    },
  }
}

export function createAccountBundleSource(userId: string, dbName?: string): E2eeBundleSource {
  const id = `account:${userId}` as const

  return {
    async read() {
      const result = await getKeys()
      if (result.kind === 'found') {
        try {
          await writeE2eeRow({ id, bundle: result.bundle, rev: result.rev, updatedAt: Date.now() }, null, dbName)
        } catch {
          // 캐시 쓰기 실패는 삼킨다 — 방금 받은 값은 그대로 돌려준다
        }
        return { kind: 'found', bundle: result.bundle, rev: result.rev }
      }
      if (result.kind === 'none') {
        try {
          await deleteE2eeRow(id, dbName)
        } catch {
          // 무시
        }
        return { kind: 'none' }
      }
      // error — unauthorized 도 캐시로 연다(세션 만료와 금고 키를 아는지는 무관, F-404.md 5.3)
      let cached: { bundle: string; rev: number } | null = null
      try {
        const row = await readE2eeRow(id, dbName)
        if (row && 'rev' in row) cached = { bundle: row.bundle, rev: row.rev }
      } catch {
        cached = null
      }
      if (cached) return { kind: 'found', bundle: cached.bundle, rev: cached.rev }
      return { kind: 'error', reason: result.reason === 'offline' ? 'offline' : 'failed' }
    },
    async create(bundle) {
      const result = await putKeys(bundle, 0)
      if (result.kind === 'ok') {
        try {
          await writeE2eeRow({ id, bundle, rev: result.rev, updatedAt: Date.now() }, null, dbName)
        } catch {
          // 무시
        }
        return { kind: 'ok' }
      }
      if (result.kind === 'conflict') return { kind: 'conflict' }
      return { kind: 'error', reason: result.reason === 'unauthorized' ? 'failed' : result.reason }
    },
    async replace(bundle, expected) {
      const result = await putKeys(bundle, expected.rev)
      if (result.kind === 'ok') {
        try {
          await writeE2eeRow({ id, bundle, rev: result.rev, updatedAt: Date.now() }, null, dbName)
        } catch {
          // 무시
        }
        return { kind: 'ok' }
      }
      if (result.kind === 'conflict') return { kind: 'conflict' }
      return { kind: 'error', reason: result.reason === 'unauthorized' ? 'failed' : result.reason }
    },
    async remove() {
      const result = await deleteKeys()
      if (result.kind === 'ok') {
        try {
          await deleteE2eeRow(id, dbName)
        } catch {
          // 무시
        }
        return { kind: 'ok' }
      }
      if (result.kind === 'not-empty') return { kind: 'not-empty', docs: result.docs, folders: result.folders }
      return { kind: 'error', reason: result.reason === 'unauthorized' ? 'failed' : result.reason }
    },
  }
}

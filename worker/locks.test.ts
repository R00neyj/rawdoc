import { describe, expect, it } from 'vitest'
import { acquireLock, getActiveLock, isValidSessionId } from './locks'

type LockRow = { doc_id: string; user_id: string; email: string; session_id: string; expires_at: number }

function makeEnv(initial: LockRow[] = []): Env {
  const locks = new Map<string, LockRow>(initial.map((l) => [l.doc_id, l]))

  const DB = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first<T>() {
              if (sql.startsWith('SELECT * FROM doc_locks')) {
                const [docId] = args as [string]
                return (locks.get(docId) as T) ?? null
              }
              throw new Error(`unhandled sql: ${sql}`)
            },
            async run() {
              if (sql.startsWith('INSERT INTO doc_locks')) {
                const [docId, userId, email, sessionId, expiresAt, now, sessionIdAgain] = args as [
                  string,
                  string,
                  string,
                  string,
                  number,
                  number,
                  string,
                ]
                const existing = locks.get(docId)
                const canWrite = !existing || existing.expires_at < now || existing.session_id === sessionIdAgain
                if (canWrite) {
                  locks.set(docId, { doc_id: docId, user_id: userId, email, session_id: sessionId, expires_at: expiresAt })
                  return { meta: { changes: 1 } }
                }
                return { meta: { changes: 0 } }
              }
              if (sql.startsWith('DELETE FROM doc_locks')) {
                const [docId, sessionId] = args as [string, string]
                const existing = locks.get(docId)
                if (existing && existing.session_id === sessionId) locks.delete(docId)
                return { meta: { changes: 0 } }
              }
              throw new Error(`unhandled sql: ${sql}`)
            },
          }
        },
      }
    },
  }

  return { DB } as unknown as Env
}

const USER = { id: 'u1', email: 'user@example.com' }

describe('F-213 A1 isValidSessionId', () => {
  it('빈 문자열은 무효', () => {
    expect(isValidSessionId('')).toBe(false)
  })
  it('문자열이면 유효', () => {
    expect(isValidSessionId('session-1')).toBe(true)
  })
  it('문자열이 아니면 무효', () => {
    expect(isValidSessionId(123)).toBe(false)
  })
})

describe('F-213 A1 acquireLock', () => {
  it('잠금이 없으면 잡는다', async () => {
    const env = makeEnv([])
    const result = await acquireLock(env, 'd1', USER, 's1')
    expect(result.ok).toBe(true)
  })

  it('만료된 잠금은 다른 세션도 잡는다', async () => {
    const env = makeEnv([{ doc_id: 'd1', user_id: 'other', email: 'other@example.com', session_id: 's-old', expires_at: Date.now() - 1000 }])
    const result = await acquireLock(env, 'd1', USER, 's1')
    expect(result.ok).toBe(true)
  })

  it('같은 세션이면 유효한 잠금도 연장한다', async () => {
    const env = makeEnv([{ doc_id: 'd1', user_id: USER.id, email: USER.email, session_id: 's1', expires_at: Date.now() + 30_000 }])
    const result = await acquireLock(env, 'd1', USER, 's1')
    expect(result.ok).toBe(true)
  })

  it('다른 세션이 유효하게 잡고 있으면 423 정보를 돌려준다', async () => {
    const env = makeEnv([{ doc_id: 'd1', user_id: 'other', email: 'other@example.com', session_id: 's-other', expires_at: Date.now() + 30_000 }])
    const result = await acquireLock(env, 'd1', USER, 's1')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.email).toBe('other@example.com')
    }
  })
})

describe('F-213 A1 getActiveLock', () => {
  it('잠금이 없으면 null', async () => {
    const env = makeEnv([])
    expect(await getActiveLock(env, 'd1')).toBeNull()
  })

  it('만료된 잠금은 null', async () => {
    const env = makeEnv([{ doc_id: 'd1', user_id: 'u', email: 'e@example.com', session_id: 's', expires_at: Date.now() - 1000 }])
    expect(await getActiveLock(env, 'd1')).toBeNull()
  })

  it('유효한 잠금은 돌려준다', async () => {
    const env = makeEnv([{ doc_id: 'd1', user_id: 'u', email: 'e@example.com', session_id: 's', expires_at: Date.now() + 30_000 }])
    const lock = await getActiveLock(env, 'd1')
    expect(lock?.session_id).toBe('s')
  })
})

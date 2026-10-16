// gateMcpWrite·limitsUrl (F-3031 2장)
import { describe, expect, it, vi } from 'vitest'
import { limitsUrl, gateMcpWrite } from '../../worker/mcpWriteGate'
import type { McpCall } from '../../worker/mcpCall'
import { asD1, openTestDb } from '../../worker/testD1'

function makeCall(limiter?: { limit: () => Promise<{ success: boolean }> }) {
  const sqlDb = openTestDb()
  sqlDb.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').run('u1', 'u1@example.com', 1)
  const env = { DB: asD1(sqlDb), ...(limiter ? { WRITE_LIMITER: limiter } : {}) } as unknown as Env
  const call = {
    request: new Request('https://example.test/mcp', { method: 'POST' }),
    env,
    ctx: {} as ExecutionContext,
    caller: { user: { id: 'u1', email: 'u1@example.com' }, clientId: 'c', clientName: 'n' },
  } as unknown as McpCall
  return { sqlDb, call }
}

describe('F-3031 gateMcpWrite', () => {
  it('limitsUrl 은 F-2147 질의 이름을 쓴다', () => {
    expect(limitsUrl('https://x.test', 'day', 30)).toBe('https://x.test/limits?scope=day&retry=30')
  })

  it('통과하면 null', async () => {
    const { call } = makeCall()
    expect(await gateMcpWrite(call)).toBeNull()
  })

  it('분 한도는 rate_limited minute', async () => {
    const { call } = makeCall({ limit: vi.fn(async () => ({ success: false })) })
    const result = await gateMcpWrite(call)
    expect(result?.isError).toBe(true)
    expect(result?.structuredContent).toMatchObject({ error: 'rate_limited', scope: 'minute', retryAfter: 60, limitsUrl: 'https://example.test/limits?scope=minute&retry=60' })
  })

  it('막힌 계정은 account_blocked', async () => {
    const { sqlDb, call } = makeCall()
    sqlDb.prepare('UPDATE users SET blocked_at = ? WHERE id = ?').run(Date.now(), 'u1')
    const result = await gateMcpWrite(call)
    expect(result?.structuredContent).toMatchObject({ error: 'account_blocked' })
  })
})

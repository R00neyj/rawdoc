// apiTokensApi 단위 — fetch 를 대체해 상태별 분류를 확인한다 (F-222.md 2.2)
import { describe, expect, it, vi, afterEach } from 'vitest'
import { listTokens, createToken, revokeToken } from './apiTokensApi'

function mockFetch(impl: () => Promise<Response> | Response) {
  vi.stubGlobal('fetch', vi.fn(impl))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('listTokens', () => {
  it('200 이면 목록을 돌려준다', async () => {
    mockFetch(() => new Response(JSON.stringify([{ id: 't1', name: 'a', prefix: 'rd_aaaaaaaa', createdAt: 1, lastUsedAt: null }]), { status: 200 }))
    const tokens = await listTokens()
    expect(tokens).toHaveLength(1)
  })

  it('401 이면 unauthorized', async () => {
    mockFetch(() => new Response('{}', { status: 401 }))
    await expect(listTokens()).rejects.toMatchObject({ kind: 'unauthorized' })
  })
})

describe('createToken', () => {
  it('201 이면 원문 토큰을 포함한 결과를 돌려준다', async () => {
    mockFetch(() => new Response(JSON.stringify({ id: 't1', name: 'a', prefix: 'rd_aaaaaaaa', createdAt: 1, lastUsedAt: null, token: 'rd_xxx' }), { status: 201 }))
    const result = await createToken('a')
    expect(result.token).toBe('rd_xxx')
  })

  it('400 이면 invalid', async () => {
    mockFetch(() => new Response(JSON.stringify({ error: 'invalid', field: 'name' }), { status: 400 }))
    await expect(createToken('')).rejects.toMatchObject({ kind: 'invalid' })
  })

  it('409 이면 too_many, limit 을 담는다', async () => {
    mockFetch(() => new Response(JSON.stringify({ error: 'too_many', limit: 10 }), { status: 409 }))
    await expect(createToken('a')).rejects.toMatchObject({ kind: 'too_many', limit: 10 })
  })

  it('네트워크 실패면 network', async () => {
    mockFetch(() => {
      throw new Error('offline')
    })
    await expect(createToken('a')).rejects.toMatchObject({ kind: 'network' })
  })
})

describe('revokeToken', () => {
  it('204 이면 성공', async () => {
    mockFetch(() => new Response(null, { status: 204 }))
    await expect(revokeToken('t1')).resolves.toBeUndefined()
  })

  it('404 이면 not_found', async () => {
    mockFetch(() => new Response('{}', { status: 404 }))
    await expect(revokeToken('t1')).rejects.toMatchObject({ kind: 'not_found' })
  })
})

// 금고 키 묶음 서버 API (specs/features/F-404.md 10.1 U9, fetch 흉내)
import { afterEach, describe, expect, it, vi } from 'vitest'
import { deleteKeys, getKeys, putKeys } from './keysApi'

function mockFetch(impl: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => Promise.resolve(impl(url, init))),
  )
}

function jsonRes(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('U9 — getKeys', () => {
  it('fetch 가 던지면 offline', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('network'))),
    )
    expect(await getKeys()).toEqual({ kind: 'error', reason: 'offline' })
  })

  it('200 { bundle, rev } → found', async () => {
    mockFetch(() => jsonRes(200, { bundle: 'abc', rev: 3 }))
    expect(await getKeys()).toEqual({ kind: 'found', bundle: 'abc', rev: 3 })
  })

  it('404 { error: no_vault } → none', async () => {
    mockFetch(() => jsonRes(404, { error: 'no_vault' }))
    expect(await getKeys()).toEqual({ kind: 'none' })
  })

  it('그 밖 404 → failed', async () => {
    mockFetch(() => jsonRes(404, { error: 'not_found' }))
    expect(await getKeys()).toEqual({ kind: 'error', reason: 'failed' })
  })

  it('401 → unauthorized', async () => {
    mockFetch(() => jsonRes(401, {}))
    expect(await getKeys()).toEqual({ kind: 'error', reason: 'unauthorized' })
  })

  it('403 account_blocked → account-blocked', async () => {
    mockFetch(() => jsonRes(403, { error: 'account_blocked' }))
    expect(await getKeys()).toEqual({ kind: 'error', reason: 'account-blocked' })
  })

  it('429 → rate-limited', async () => {
    mockFetch(() => jsonRes(429, {}))
    expect(await getKeys()).toEqual({ kind: 'error', reason: 'rate-limited' })
  })

  it('그 밖(500) → failed', async () => {
    mockFetch(() => jsonRes(500, {}))
    expect(await getKeys()).toEqual({ kind: 'error', reason: 'failed' })
  })
})

describe('U9 — putKeys', () => {
  it('메서드·경로·몸통', async () => {
    let seenUrl = ''
    let seenInit: RequestInit | undefined
    mockFetch((url, init) => {
      seenUrl = url
      seenInit = init
      return jsonRes(200, { rev: 1 })
    })
    await putKeys('bundle-json', 0)
    expect(seenUrl).toBe('/api/e2ee/keys')
    expect(seenInit?.method).toBe('PUT')
    expect(JSON.parse(seenInit?.body as string)).toEqual({ bundle: 'bundle-json', baseRev: 0 })
  })

  it('200 { rev } → ok', async () => {
    mockFetch(() => jsonRes(200, { rev: 5 }))
    expect(await putKeys('b', 4)).toEqual({ kind: 'ok', rev: 5 })
  })

  it('409 { error: conflict, rev } → conflict', async () => {
    mockFetch(() => jsonRes(409, { error: 'conflict', rev: 2 }))
    expect(await putKeys('b', 1)).toEqual({ kind: 'conflict', rev: 2 })
  })

  it('401 → unauthorized, 429 → rate-limited, 403 account_blocked → account-blocked', async () => {
    mockFetch(() => jsonRes(401, {}))
    expect(await putKeys('b', 0)).toEqual({ kind: 'error', reason: 'unauthorized' })
    mockFetch(() => jsonRes(429, {}))
    expect(await putKeys('b', 0)).toEqual({ kind: 'error', reason: 'rate-limited' })
    mockFetch(() => jsonRes(403, { error: 'account_blocked' }))
    expect(await putKeys('b', 0)).toEqual({ kind: 'error', reason: 'account-blocked' })
  })

  it('offline', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('network'))),
    )
    expect(await putKeys('b', 0)).toEqual({ kind: 'error', reason: 'offline' })
  })
})

describe('U9 — deleteKeys', () => {
  it('204 → ok', async () => {
    mockFetch(() => new Response(null, { status: 204 }))
    expect(await deleteKeys()).toEqual({ kind: 'ok' })
  })

  it('409 vault_not_empty → not-empty', async () => {
    mockFetch(() => jsonRes(409, { error: 'vault_not_empty', docs: 2, folders: 1 }))
    expect(await deleteKeys()).toEqual({ kind: 'not-empty', docs: 2, folders: 1 })
  })

  it('401·429·403', async () => {
    mockFetch(() => jsonRes(401, {}))
    expect(await deleteKeys()).toEqual({ kind: 'error', reason: 'unauthorized' })
    mockFetch(() => jsonRes(429, {}))
    expect(await deleteKeys()).toEqual({ kind: 'error', reason: 'rate-limited' })
    mockFetch(() => jsonRes(403, { error: 'account_blocked' }))
    expect(await deleteKeys()).toEqual({ kind: 'error', reason: 'account-blocked' })
  })
})

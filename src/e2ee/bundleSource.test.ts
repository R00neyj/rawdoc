// 금고 키 묶음 출처 — 로컬·계정 (specs/features/F-404.md 10.1 U10·U11)
import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAccountBundleSource, createLocalBundleSource } from './bundleSource'

let dbCounter = 0
function freshDbName() {
  dbCounter += 1
  return `test-md-docs-bundle-${Date.now()}-${dbCounter}`
}

function jsonRes(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('U10 — 로컬 출처', () => {
  it('read·create·replace·remove', async () => {
    const dbName = freshDbName()
    const source = createLocalBundleSource(dbName)

    expect(await source.read()).toEqual({ kind: 'none' })

    expect(await source.create('bundle-1')).toEqual({ kind: 'ok' })
    expect(await source.create('bundle-2')).toEqual({ kind: 'conflict' })
    expect(await source.read()).toEqual({ kind: 'found', bundle: 'bundle-1', rev: 0 })

    expect(await source.replace('bundle-2', { bundle: 'bundle-1', rev: 0 })).toEqual({ kind: 'ok' })
    expect(await source.replace('bundle-3', { bundle: 'bundle-1', rev: 0 })).toEqual({ kind: 'conflict' })

    expect(await source.remove()).toEqual({ kind: 'ok' })
    expect(await source.read()).toEqual({ kind: 'none' })
  })
})

describe('U11 — 계정 출처', () => {
  it('GET 200 → found, 캐시에 같은 bundle·rev', async () => {
    const dbName = freshDbName()
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonRes(200, { bundle: 'server-bundle', rev: 3 }))),
    )
    const source = createAccountBundleSource('u1', dbName)
    expect(await source.read()).toEqual({ kind: 'found', bundle: 'server-bundle', rev: 3 })

    // 이어 fetch 가 던지면 캐시로 found
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('network'))),
    )
    expect(await source.read()).toEqual({ kind: 'found', bundle: 'server-bundle', rev: 3 })
  })

  it('401 도 캐시로 found', async () => {
    const dbName = freshDbName()
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonRes(200, { bundle: 'server-bundle', rev: 1 }))),
    )
    const source = createAccountBundleSource('u2', dbName)
    await source.read()

    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonRes(401, {}))),
    )
    expect(await source.read()).toEqual({ kind: 'found', bundle: 'server-bundle', rev: 1 })
  })

  it('GET 404 no_vault → none, 캐시 행이 사라진다', async () => {
    const dbName = freshDbName()
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonRes(200, { bundle: 'server-bundle', rev: 1 }))),
    )
    const source = createAccountBundleSource('u3', dbName)
    await source.read()

    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonRes(404, { error: 'no_vault' }))),
    )
    expect(await source.read()).toEqual({ kind: 'none' })

    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('network'))),
    )
    expect(await source.read()).toEqual({ kind: 'error', reason: 'offline' })
  })

  it('캐시 없이 fetch 가 던지면 error offline', async () => {
    const dbName = freshDbName()
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('network'))),
    )
    const source = createAccountBundleSource('u4', dbName)
    expect(await source.read()).toEqual({ kind: 'error', reason: 'offline' })
  })

  it('create 409 → conflict, 캐시 그대로', async () => {
    const dbName = freshDbName()
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonRes(200, { bundle: 'server-bundle', rev: 1 }))),
    )
    const source = createAccountBundleSource('u5', dbName)
    await source.read()

    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonRes(409, { error: 'conflict', rev: 2 }))),
    )
    expect(await source.create('new-bundle')).toEqual({ kind: 'conflict' })

    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('network'))),
    )
    expect(await source.read()).toEqual({ kind: 'found', bundle: 'server-bundle', rev: 1 })
  })
})

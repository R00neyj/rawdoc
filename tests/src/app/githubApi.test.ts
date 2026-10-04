import { afterEach, describe, expect, it, vi } from 'vitest'
import { deleteDocGithub, fetchGithubStatus, fetchGithubTree, getDocGithub, postDocGithubBlob, postDocGithubPlan, postDocGithubPull, postDocGithubPush, postDocGithubSynced, postGithubFile } from '../../../src/app/githubApi'

afterEach(() => vi.unstubAllGlobals())

const stub = (impl: () => Promise<Response> | Response) => {
  const fn = vi.fn(async () => impl())
  vi.stubGlobal('fetch', fn)
  return fn
}

describe('F-2128 A6', () => {
  it('네트워크 예외는 status 0', async () => {
    stub(() => { throw new TypeError('offline') })
    expect(await fetchGithubStatus()).toEqual({ ok: false, status: 0, error: null, body: null })
  })
  it('HTML 200 은 ok:false', async () => {
    stub(() => new Response('<html></html>', { status: 200 }))
    const r = await fetchGithubStatus()
    expect(r.ok).toBe(false)
  })
  it('4xx 는 error 코드를 싣는다', async () => {
    stub(() => new Response(JSON.stringify({ error: 'github_reconnect' }), { status: 401 }))
    expect(await postGithubFile({ repo: 'o/r', branch: 'main', path: 'a.md' })).toMatchObject({ ok: false, status: 401, error: 'github_reconnect' })
  })
  it('404 와 204', async () => {
    stub(() => new Response(JSON.stringify({ error: 'not_found' }), { status: 404 }))
    expect(await getDocGithub('d1')).toMatchObject({ ok: false, status: 404 })
    stub(() => new Response(null, { status: 204 }))
    expect(await deleteDocGithub('d1')).toEqual({ ok: true, value: true })
  })
  it('질의를 인코딩한다', async () => {
    const fn = stub(() => new Response(JSON.stringify({ entries: [], truncated: false }), { status: 200 }))
    const r = await fetchGithubTree('o/r', 'main', '문서 폴더/하위')
    expect(r.ok).toBe(true)
    const url = String((fn.mock.calls[0] as unknown[])[0])
    expect(url).toBe('/api/github/tree?repo=o%2Fr&branch=main&dir=%EB%AC%B8%EC%84%9C+%ED%8F%B4%EB%8D%94%2F%ED%95%98%EC%9C%84')
  })
})

describe('F-2129 A6 당기기·synced', () => {
  it('pull 은 POST /api/docs/{id}/github/pull, 몸통 없음, { sha, size, content } 를 돌려준다', async () => {
    const fn = stub(() => new Response(JSON.stringify({ sha: 'S2', size: 3, content: 'YWJj' }), { status: 200 }))
    expect(await postDocGithubPull('d 1')).toEqual({ ok: true, value: { sha: 'S2', size: 3, content: 'YWJj' } })
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/docs/d%201/github/pull')
    expect(init.method).toBe('POST')
    expect(init.body).toBeUndefined()
  })
  it('pull 응답 꼴이 틀리면 ok:false, 404 는 error 코드를 싣는다', async () => {
    stub(() => new Response(JSON.stringify({ sha: 'S2' }), { status: 200 }))
    expect((await postDocGithubPull('d1')).ok).toBe(false)
    stub(() => new Response(JSON.stringify({ error: 'github_not_found' }), { status: 404 }))
    expect(await postDocGithubPull('d1')).toMatchObject({ ok: false, status: 404, error: 'github_not_found' })
  })
  it('synced 는 POST JSON { sha, bom }, 204 → ok', async () => {
    const fn = stub(() => new Response(null, { status: 204 }))
    expect(await postDocGithubSynced('d1', { sha: 'S2', bom: true })).toEqual({ ok: true, value: true })
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/docs/d1/github/synced')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ sha: 'S2', bom: true })
  })
  it('네트워크 예외 → ok:false status 0', async () => {
    stub(() => { throw new TypeError('offline') })
    expect(await postDocGithubSynced('d1', { sha: 'S2', bom: false })).toEqual({ ok: false, status: 0, error: null, body: null })
    expect(await postDocGithubPull('d1')).toEqual({ ok: false, status: 0, error: null, body: null })
  })
})

describe('F-2130 A2 푸시 세 함수', () => {
  it('경로·메서드·Content-Type, blob 은 문자열 그대로, 409 몸통이 남는다', async () => {
    const fn = stub(() => new Response(JSON.stringify({ missing: [], skipped: [] }), { status: 200 }))
    await postDocGithubPlan('d 1', ['a.png'])
    let [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/docs/d%201/github/push-plan')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect(init.body).toBe(JSON.stringify({ attachments: ['a.png'] }))

    const fn2 = stub(() => new Response(JSON.stringify({ sha: 's' }), { status: 200 }))
    await postDocGithubBlob('d1', '{"raw":1}')
    ;[url, init] = fn2.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/docs/d1/github/blobs')
    expect(init.method).toBe('POST')
    expect(init.body).toBe('{"raw":1}')

    const fn3 = stub(() => new Response(JSON.stringify({ error: 'github_conflict', remoteSha: 'x' }), { status: 409 }))
    const r = await postDocGithubPush('d1', { message: 'm', mdSha: 's', images: [] })
    ;[url, init] = fn3.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/docs/d1/github/push')
    expect(init.method).toBe('POST')
    expect(r).toMatchObject({ ok: false, status: 409, error: 'github_conflict', body: { remoteSha: 'x' } })
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { deleteDocGithub, fetchGithubStatus, fetchGithubTree, getDocGithub, postGithubFile } from '../../../src/app/githubApi'

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

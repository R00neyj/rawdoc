import { describe, expect, it } from 'vitest'
import { runGithubImport, type GithubImportDeps } from '../../../src/app/githubImport'
import type { Doc } from '../../../src/types'

const b64 = (bytes: number[]) => btoa(String.fromCharCode(...bytes)).replace(/(.{60})/g, '$1\n')
const utf8 = (s: string) => Array.from(new TextEncoder().encode(s))
const FILE = { repo: 'o/r', branch: 'main', path: 'docs/메모.markdown', size: 20 }

function make(over: Partial<GithubImportDeps> = {}, content = b64([0xef, 0xbb, 0xbf, ...utf8('# 제목\n본문\n')])) {
  const calls: string[] = []
  const puts: unknown[] = []
  const notices: string[] = []
  const created: unknown[] = []
  const deps: GithubImportDeps = {
    postFile: async () => { calls.push('postFile'); return { ok: true, value: { sha: 'S1', size: 20, content, linkedDocId: null } } },
    create: async (i) => { calls.push('create'); created.push(i); return { id: 'n1', title: i.title } as unknown as Doc },
    flushOutbox: async () => { calls.push('flushOutbox') },
    hasPendingChanges: async () => { calls.push('hasPendingChanges'); return false },
    putLink: async (_id, put) => { calls.push('putLink'); puts.push(put); return { ok: true, value: {} as never } },
    remove: async () => { calls.push('remove') },
    open: (id) => { calls.push(`open:${id}`) },
    notify: (n) => { notices.push(n.message) },
    ...over,
  }
  return { deps, calls, puts, notices, created }
}

describe('F-2128 A5 runGithubImport', () => {
  it('크기 초과면 postFile 0번', async () => {
    const t = make()
    expect(await runGithubImport({ ...FILE, size: 1_000_004 }, t.deps)).toBe('failed')
    expect(t.calls).toEqual([])
    expect(t.notices).toEqual(['GitHub 파일이 너무 큽니다 (최대 1MB)'])
  })
  it('linkedDocId 가 있으면 만들지 않고 연 문서를 연다', async () => {
    const t = make({ postFile: async () => ({ ok: true, value: { sha: 's', size: 1, content: '', linkedDocId: 'old' } }) })
    expect(await runGithubImport(FILE, t.deps)).toBe('opened-existing')
    expect(t.calls).toEqual(['open:old'])
  })
  it('UTF-8 이 아니면 create 0번', async () => {
    const t = make({}, b64([0xff, 0xfe, 0xfd]))
    expect(await runGithubImport(FILE, t.deps)).toBe('failed')
    expect(t.calls).toEqual(['postFile'])
    expect(t.notices[0]).toBe('"메모.markdown" 을(를) 가져오지 못했습니다. UTF-8 텍스트 파일이 아닙니다.')
  })
  it('성공 순서·PUT 몸통·제목', async () => {
    const t = make()
    expect(await runGithubImport(FILE, t.deps)).toBe('imported')
    expect(t.calls).toEqual(['postFile', 'create', 'flushOutbox', 'hasPendingChanges', 'putLink', 'open:n1'])
    expect(t.puts).toEqual([{ repo: 'o/r', branch: 'main', path: 'docs/메모.markdown', sha: 'S1', bom: true }])
    expect(t.created[0]).toMatchObject({ title: '메모', content: '# 제목\n본문\n', folderId: null })
    expect(t.notices).toEqual(['"메모.markdown" 을(를) GitHub에서 가져왔습니다.'])
  })
  it('PUT 실패면 만든 문서를 지우고 열지 않는다', async () => {
    const t = make({ putLink: async () => ({ ok: false, status: 403, error: 'github_forbidden', body: null }) })
    expect(await runGithubImport(FILE, t.deps)).toBe('failed')
    expect(t.calls.filter((c) => c === 'remove')).toHaveLength(1)
    expect(t.calls.some((c) => c.startsWith('open'))).toBe(false)
    expect(t.notices[0]).toBe('가져오지 못했습니다. GitHub에서 이 저장소에 쓸 수 없습니다')
  })
  it('대기가 남으면 실패', async () => {
    const t = make({ hasPendingChanges: async () => true })
    expect(await runGithubImport(FILE, t.deps)).toBe('failed')
    expect(t.calls.filter((c) => c === 'remove')).toHaveLength(1)
    expect(t.calls.some((c) => c === 'putLink' || c.startsWith('open'))).toBe(false)
    expect(t.notices[0]).toBe('가져오지 못했습니다. 잠시 뒤에 다시 해 주세요')
  })
})

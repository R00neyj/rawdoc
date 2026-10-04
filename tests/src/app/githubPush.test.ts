import { describe, expect, it } from 'vitest'
import type { GithubResult } from '../../../src/app/githubApi'
import {
  blobBody, planSummary, pushedNotice, pushFailureMessage, pushImageNames, pushMdBytes, readConflict, runGithubPush, PUSH_MAX_REFS,
  type PushDeps, type PushStep,
} from '../../../src/app/githubPush'

const fail = (status: number, error: string | null = null, body: unknown = null): GithubResult<never> => ({ ok: false, status, error, body })
const ok = <T,>(value: T): GithubResult<T> => ({ ok: true, value })

describe('F-2130 pushImageNames', () => {
  it('처음 나온 순서, 중복 없이, 확장자 넷, attachments/ 아닌 경로 무시', () => {
    const t = '![](attachments/0123456789abcdef.png) ![](attachments/aaaaaaaaaaaaaaaa.jpg) ![](attachments/0123456789abcdef.png) ![](x/bbbbbbbbbbbbbbbb.gif) ![](attachments/cccccccccccccccc.webp) ![](attachments/dddddddddddddddd.gif)'
    expect(pushImageNames(t)).toEqual(['0123456789abcdef.png', 'aaaaaaaaaaaaaaaa.jpg', 'cccccccccccccccc.webp', 'dddddddddddddddd.gif'])
  })
})

describe('F-2130 pushMdBytes', () => {
  it('BOM 있음 → 앞 3바이트', () => {
    const b = pushMdBytes('한글', true)
    expect([...b.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(new TextDecoder().decode(b.slice(3))).toBe('한글')
  })
  it('BOM 없음 → 본문 UTF-8 그대로', () => {
    expect([...pushMdBytes('한글', false)]).toEqual([...new TextEncoder().encode('한글')])
  })
})

describe('F-2130 blobBody', () => {
  it.each([0, 3, 8193])('%i B 가 base64 로 되돌아온다', (n) => {
    const src = Uint8Array.from({ length: n }, (_, i) => (i * 7) % 256)
    const parsed = JSON.parse(blobBody(src)) as { encoding: string; content: string }
    expect(parsed.encoding).toBe('base64')
    expect([...Uint8Array.from(atob(parsed.content), (c) => c.charCodeAt(0))]).toEqual([...src])
  })
})

describe('F-2130 readConflict', () => {
  it('remoteSha 문자열 → gone false, null → true, 키 없음 → false, 다른 오류 → null', () => {
    expect(readConflict({ status: 409, error: 'github_conflict', body: { remoteSha: 'x' } })).toEqual({ gone: false })
    expect(readConflict({ status: 409, error: 'github_conflict', body: { remoteSha: null } })).toEqual({ gone: true })
    expect(readConflict({ status: 409, error: 'github_conflict', body: {} })).toEqual({ gone: false })
    expect(readConflict({ status: 409, error: 'github_empty_repo', body: {} })).toBeNull()
  })
})

describe('F-2130 pushFailureMessage', () => {
  it('세 갈래', () => {
    expect(pushFailureMessage({ status: 409, error: 'github_empty_repo', body: null })).toBe('빈 저장소에는 푸시할 수 없습니다. GitHub에서 파일을 하나 만든 뒤 다시 해 주세요')
    expect(pushFailureMessage({ status: 403, error: 'github_forbidden', body: null })).toBe('GitHub에서 이 브랜치에 쓸 수 없습니다. 브랜치 보호 규칙과 권한을 확인해 주세요')
    expect(pushFailureMessage({ status: 413, error: 'too_large', body: null })).toBe('GitHub 파일이 너무 큽니다 (최대 1MB)')
  })
})

describe('F-2130 planSummary·pushedNotice', () => {
  const missing = (n: number) => Array.from({ length: n }, (_, i) => `${i}.png`)
  it('새 그림 경계', () => {
    expect(planSummary({ missing: missing(0), skipped: [] })).toEqual({ newLine: '새 그림 없음', skippedLine: null })
    expect(planSummary({ missing: missing(1), skipped: [] }).newLine).toBe('새 그림 1장')
    expect(planSummary({ missing: missing(50), skipped: [] }).newLine).toBe('새 그림 50장')
    expect(planSummary({ missing: missing(51), skipped: [] }).newLine).toBe('새 그림 51장 — 이번에 50장, 나머지는 다음 푸시에 올라갑니다')
  })
  it('올리지 않는 그림', () => {
    expect(planSummary({ missing: [], skipped: ['a.png', 'b.png'] }).skippedLine).toBe('올리지 않는 그림 2장 (금고 그림이거나 아직 서버에 올라가지 않은 그림)')
  })
  it('알림', () => {
    expect(pushedNotice({ kind: 'pushed', sha: 's', commitUrl: null, left: 0 })).toBe('GitHub 파일과 같습니다')
    expect(pushedNotice({ kind: 'pushed', sha: 's', commitUrl: 'u', left: 1 })).toBe('푸시했습니다. 남은 그림 1장은 한 번 더 푸시하면 올라갑니다')
    expect(pushedNotice({ kind: 'pushed', sha: 's', commitUrl: 'u', left: 0 })).toBe('푸시했습니다')
  })
})

type Calls = { plan: string[][]; blob: string[]; push: unknown[]; steps: PushStep[]; read: string[] }
function makeDeps(over: (calls: Calls) => Partial<PushDeps> = () => ({}), missing: string[] = [], skipped: string[] = []) {
  const calls: Calls = { plan: [], blob: [], push: [], steps: [], read: [] }
  const deps: PushDeps = {
    plan: async (names) => { calls.plan.push(names); return ok({ missing, skipped }) },
    blob: async (body) => { calls.blob.push(body); return ok({ sha: `sha${calls.blob.length}` }) },
    push: async (b) => { calls.push.push(b); return ok({ sha: 'new', commitSha: 'c', commitUrl: 'url' }) },
    readAttachment: async (name) => { calls.read.push(name); return new Uint8Array([1, 2, 3]) },
    progress: (s) => { calls.steps.push(s) },
    ...over(calls),
  }
  return { deps, calls }
}
const input = { md: new Uint8Array([65]), names: ['a.png', 'b.png'], message: '  첫 푸시\n' }

describe('F-2130 runGithubPush', () => {
  it('정상: plan → blob(md) → blob(그림 순서) → push, 진행 순서', async () => {
    const { deps, calls } = makeDeps(undefined, ['a.png', 'b.png'])
    const o = await runGithubPush(input, deps)
    expect(o).toEqual({ kind: 'pushed', sha: 'new', commitUrl: 'url', left: 0 })
    expect(calls.read).toEqual(['a.png', 'b.png'])
    expect(calls.push).toEqual([{ message: '첫 푸시', mdSha: 'sha1', images: [{ name: 'a.png', sha: 'sha2' }, { name: 'b.png', sha: 'sha3' }] }])
    expect(calls.steps).toEqual([{ kind: 'md' }, { kind: 'image', index: 1, total: 2 }, { kind: 'image', index: 2, total: 2 }, { kind: 'commit' }])
  })
  it('md blob 502 → 같은 몸통 한 번 더, 성공', async () => {
    let n = 0
    const { deps, calls } = makeDeps((c) => ({ blob: async (b) => { c.blob.push(b); return ++n === 1 ? fail(502) : ok({ sha: 's' }) } }))
    const o = await runGithubPush(input, deps)
    expect(o.kind).toBe('pushed')
    expect(calls.blob).toHaveLength(2)
    expect(calls.blob[0]).toBe(calls.blob[1])
  })
  it('status 0 도 한 번 재시도, 두 번 실패하면 failed (push 0)', async () => {
    const { deps, calls } = makeDeps((c) => ({ blob: async (b) => { c.blob.push(b); return fail(0) } }))
    const o = await runGithubPush(input, deps)
    expect(o.kind).toBe('failed')
    expect(calls.blob).toHaveLength(2)
    expect(calls.push).toHaveLength(0)
  })
  it('push 502 → 한 번만 부르고 failed', async () => {
    const { deps, calls } = makeDeps((c) => ({ push: async (b) => { c.push.push(b); return fail(502) } }))
    expect((await runGithubPush(input, deps)).kind).toBe('failed')
    expect(calls.push).toHaveLength(1)
  })
  it('plan 409 remoteSha → conflict (blob 0)', async () => {
    const { deps, calls } = makeDeps(() => ({ plan: async () => fail(409, 'github_conflict', { remoteSha: 'x' }) }))
    expect(await runGithubPush(input, deps)).toEqual({ kind: 'conflict', gone: false })
    expect(calls.blob).toHaveLength(0)
  })
  it('push 409 (키 없음) → conflict gone false', async () => {
    const { deps } = makeDeps(() => ({ push: async () => fail(409, 'github_conflict', {}) }))
    expect(await runGithubPush(input, deps)).toEqual({ kind: 'conflict', gone: false })
  })
  it('51장 → blob 1+50, left 1', async () => {
    const missing = Array.from({ length: 51 }, (_, i) => `${i}.png`)
    const { deps, calls } = makeDeps(undefined, missing)
    const o = await runGithubPush(input, deps)
    expect(calls.blob).toHaveLength(51)
    expect(o).toMatchObject({ kind: 'pushed', left: 1 })
  })
  it('둘째 그림 읽기 null → failed 에 이름, push 0', async () => {
    const { deps, calls } = makeDeps(() => ({ readAttachment: async (n) => (n === 'b.png' ? null : new Uint8Array([1])) }), ['a.png', 'b.png'])
    const o = await runGithubPush(input, deps)
    expect(o).toEqual({ kind: 'failed', message: '그림을 읽지 못해 푸시하지 않았습니다 (b.png)' })
    expect(calls.push).toHaveLength(0)
  })
  it('1,001개 → 요청 0', async () => {
    const { deps, calls } = makeDeps()
    const names = Array.from({ length: PUSH_MAX_REFS + 1 }, (_, i) => `${i}.png`)
    const o = await runGithubPush({ ...input, names }, deps)
    expect(o).toEqual({ kind: 'failed', message: '그림이 너무 많아 푸시할 수 없습니다 (최대 1,000장)' })
    expect(calls.plan).toHaveLength(0)
  })
})

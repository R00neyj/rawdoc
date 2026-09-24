// F-2021 U16 (specs/features/F-2021.md 13.1, 4.7)
import { describe, expect, it, vi } from 'vitest'
import { main, type MainDeps } from './main'
import { cliCallbackUrl, parseCliLoginHash } from '../../src/lib/cliLoginUrl'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function baseDeps(overrides: Partial<MainDeps> = {}): MainDeps & { stdoutLog: string[]; stderrLog: string[] } {
  const stdoutLog: string[] = []
  const stderrLog: string[] = []
  const deps: MainDeps = {
    argv: [],
    env: {},
    fetchImpl: (async () => jsonResponse([])) as unknown as typeof fetch,
    out: { stdout: (s) => stdoutLog.push(s), stderr: (s) => stderrLog.push(s) },
    platform: 'linux',
    hostname: 'test-host',
    homedir: '/home/test',
    readFile: vi.fn(async () => new Uint8Array()),
    writeFile: vi.fn(async () => {}),
    readStdin: vi.fn(async () => new Uint8Array()),
    stdinIsTTY: false,
    openBrowserFn: vi.fn(),
    now: () => 0,
    wait: () => new Promise(() => {}),
    packageVersion: '0.1.0',
    nodeVersion: 'v22.0.0',
    ...overrides,
  }
  return Object.assign(deps, { stdoutLog, stderrLog })
}

describe('F-2021 U16 main()', () => {
  it('ls --json + 토큰 환경 변수 + 가짜 fetch → 표준 출력 JSON, 종료 0', async () => {
    const docs = [{ id: 'd1', title: 't', lineEnding: 'lf', folderId: null, pinnedAt: null, version: 1, createdAt: 0, updatedAt: 0 }]
    const deps = baseDeps({
      argv: ['ls', '--json'],
      env: { RAWDOC_TOKEN: 'rd_' + 'a'.repeat(43) },
      fetchImpl: (async () => jsonResponse(docs)) as unknown as typeof fetch,
    })
    const code = await main(deps)
    expect(code).toBe(0)
    expect(deps.stdoutLog.join('')).toBe(`${JSON.stringify(docs)}\n`)
  })

  it('토큰 없음 → 종료 3, 표준 출력 비움', async () => {
    const deps = baseDeps({ argv: ['ls'] })
    const code = await main(deps)
    expect(code).toBe(3)
    expect(deps.stdoutLog.join('')).toBe('')
    expect(deps.stderrLog.join('')).toContain('로그인이 필요합니다')
  })

  it('--version → cli/package.json 값', async () => {
    const deps = baseDeps({ argv: ['--version'], packageVersion: '0.1.0' })
    const code = await main(deps)
    expect(code).toBe(0)
    expect(deps.stdoutLog.join('')).toBe('0.1.0\n')
  })

  it('명령 없음 → 도움말이 표준 오류, 종료 2', async () => {
    const deps = baseDeps({ argv: [] })
    const code = await main(deps)
    expect(code).toBe(2)
    expect(deps.stdoutLog.join('')).toBe('')
    expect(deps.stderrLog.join('')).toContain('rawdoc')
  })

  it('명령 함수는 out 객체로만 쓴다 — fetchImpl 호출 횟수로 간접 확인', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([]))
    const deps = baseDeps({ argv: ['ls', '--json'], env: { RAWDOC_TOKEN: 'rd_' + 'a'.repeat(43) }, fetchImpl: fetchImpl as unknown as typeof fetch })
    await main(deps)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(deps.stdoutLog.length).toBeGreaterThan(0)
  })

  it('whoami --json', async () => {
    const deps = baseDeps({
      argv: ['whoami', '--json'],
      env: { RAWDOC_TOKEN: 'rd_' + 'a'.repeat(43) },
      fetchImpl: (async () => jsonResponse({ id: 'u1', email: 'a@b.com' })) as unknown as typeof fetch,
    })
    const code = await main(deps)
    expect(code).toBe(0)
    expect(JSON.parse(deps.stdoutLog.join(''))).toEqual({ id: 'u1', email: 'a@b.com', server: 'https://rawdoc.app' })
  })

  it('get 문서 원문을 그대로 표준 출력에 쓴다 (끝 줄바꿈 없음)', async () => {
    const deps = baseDeps({
      argv: ['get', 'd1'],
      env: { RAWDOC_TOKEN: 'rd_' + 'a'.repeat(43) },
      fetchImpl: (async () =>
        jsonResponse({ id: 'd1', content: '줄1\r\n줄2', title: 't', lineEnding: 'crlf', folderId: null, pinnedAt: null, version: 1, createdAt: 0, updatedAt: 0 })) as unknown as typeof fetch,
    })
    const code = await main(deps)
    expect(code).toBe(0)
    expect(deps.stdoutLog.join('')).toBe('줄1\r\n줄2')
  })

  it('알 수 없는 명령 → usage, 종료 2', async () => {
    const deps = baseDeps({ argv: ['frobnicate'] })
    const code = await main(deps)
    expect(code).toBe(2)
  })

  it('U2 --server 가 RAWDOC_SERVER·기본값보다 우선한다', async () => {
    let calledUrl = ''
    const deps = baseDeps({
      argv: ['whoami', '--json', '--server', 'http://localhost:8790'],
      env: { RAWDOC_TOKEN: 'rd_' + 'a'.repeat(43), RAWDOC_SERVER: 'https://other.example.com' },
      fetchImpl: (async (url: string) => {
        calledUrl = url
        return jsonResponse({ id: 'u1', email: 'a@b.com' })
      }) as unknown as typeof fetch,
    })
    const code = await main(deps)
    expect(code).toBe(0)
    expect(calledUrl).toBe('http://localhost:8790/v1/me')
  })

  it('U2 RAWDOC_SERVER 가 기본값(SITE_URL)보다 우선한다', async () => {
    let calledUrl = ''
    const deps = baseDeps({
      argv: ['whoami', '--json'],
      env: { RAWDOC_TOKEN: 'rd_' + 'a'.repeat(43), RAWDOC_SERVER: 'http://127.0.0.1:8790' },
      fetchImpl: (async (url: string) => {
        calledUrl = url
        return jsonResponse({ id: 'u1', email: 'a@b.com' })
      }) as unknown as typeof fetch,
    })
    const code = await main(deps)
    expect(code).toBe(0)
    expect(calledUrl).toBe('http://127.0.0.1:8790/v1/me')
  })

  it('U2 http://example.com → 거절 (localhost 가 아닌 http)', async () => {
    const deps = baseDeps({ argv: ['whoami', '--server', 'http://example.com'], env: { RAWDOC_TOKEN: 'rd_' + 'a'.repeat(43) } })
    const code = await main(deps)
    expect(code).toBe(2)
    expect(deps.stderrLog.join('')).toContain('http 주소는 localhost 에서만')
  })

  it('U2 http://localhost:8790·http://127.0.0.1:8790 은 허용한다', async () => {
    for (const server of ['http://localhost:8790', 'http://127.0.0.1:8790']) {
      const deps = baseDeps({
        argv: ['whoami', '--json', '--server', server],
        env: { RAWDOC_TOKEN: 'rd_' + 'a'.repeat(43) },
        fetchImpl: (async () => jsonResponse({ id: 'u1', email: 'a@b.com' })) as unknown as typeof fetch,
      })
      const code = await main(deps)
      expect(code).toBe(0)
    }
  })

  it('서버 응답 409 → 종료 5, --json 오류 모양', async () => {
    const deps = baseDeps({
      argv: ['put', 'd1', 'a.md', '--json', '--base-version', '1'],
      env: { RAWDOC_TOKEN: 'rd_' + 'a'.repeat(43) },
      readFile: vi.fn(async () => new TextEncoder().encode('new content')),
      fetchImpl: (async () => jsonResponse({ error: 'conflict', doc: { version: 9 } }, 409)) as unknown as typeof fetch,
    })
    const code = await main(deps)
    expect(code).toBe(5)
    const parsed = JSON.parse(deps.stderrLog.join(''))
    expect(parsed.error).toBe('conflict')
    expect(parsed.currentVersion).toBe(9)
  })

  it('F-2023 U5 login — v2 주소, 취소 콜백 → 종료 1, 파일 시스템 안 건드림', async () => {
    let capturedUrl = ''
    const deps = baseDeps({
      argv: ['login'],
      hostname: 'test-host',
      openBrowserFn: vi.fn((url: string) => {
        capturedUrl = url
        const parsed = parseCliLoginHash(new URL(url).hash)
        if (parsed && parsed.version === 2) {
          void fetch(cliCallbackUrl(parsed.port, { state: parsed.publicKey, error: 'denied' }))
        }
      }),
    })

    const code = await main(deps)

    expect(code).toBe(1)
    const parsed = parseCliLoginHash(new URL(capturedUrl).hash)
    expect(parsed).not.toBeNull()
    expect(parsed?.version).toBe(2)
    if (parsed?.version === 2) {
      expect(parsed.host).toBe('test-host')
    }
    expect(capturedUrl.length).toBeLessThanOrEqual(107)
    const stderr = deps.stderrLog.join('')
    expect(stderr).toContain(capturedUrl)
    expect(capturedUrl).not.toContain('\n')
    expect(deps.writeFile).not.toHaveBeenCalled()
    expect(deps.readFile).not.toHaveBeenCalled()
  })

  it('F-2031 A13 진입점 — 429 하루 한도 → 종료 8, --json 오류 한 줄', async () => {
    const deps = baseDeps({
      argv: ['mkdir', 'x', '--json'],
      env: { RAWDOC_TOKEN: 'rd_' + 'a'.repeat(43) },
      fetchImpl: (async () => jsonResponse({ error: 'rate_limited', scope: 'day', limit: 5000, retryAfter: 32400 }, 429)) as unknown as typeof fetch,
    })
    const code = await main(deps)
    expect(code).toBe(8)
    expect(deps.stdoutLog.join('')).toBe('')
    const parsed = JSON.parse(deps.stderrLog.join(''))
    expect(parsed.error).toBe('rate_limited')
    expect(typeof parsed.retryAfter).toBe('number')
  })

  it('F-2031 A14 진입점 — 403 account_blocked 사람용 문구', async () => {
    const deps = baseDeps({
      argv: ['new', 'a.md'],
      env: { RAWDOC_TOKEN: 'rd_' + 'a'.repeat(43) },
      readFile: vi.fn(async () => new TextEncoder().encode('내용')),
      fetchImpl: (async () => jsonResponse({ error: 'account_blocked' }, 403)) as unknown as typeof fetch,
    })
    const code = await main(deps)
    expect(code).toBe(4)
    expect(deps.stderrLog.join('')).toBe('이 계정은 운영자가 쓰기를 막았습니다. 읽기만 할 수 있습니다.\n')
  })
})

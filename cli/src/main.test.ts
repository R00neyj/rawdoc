// F-2021 U16 (specs/features/F-2021.md 13.1, 4.7)
import { describe, expect, it, vi } from 'vitest'
import { isEntryScript, main, type MainDeps } from './main'
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

  it('F-2050 C10 --yes 없으면 요청 0, 종료 2', async () => {
    for (const argv of [['rm', 'd1'], ['rmdir', 'f1'], ['rmdir', 'f1', '--all']]) {
      const fetchImpl = vi.fn(async () => jsonResponse({}))
      const deps = baseDeps({ argv, fetchImpl: fetchImpl as unknown as typeof fetch })
      const code = await main(deps)
      expect(code, argv.join(' ')).toBe(2)
      expect(fetchImpl, argv.join(' ')).not.toHaveBeenCalled()
      expect(deps.stderrLog.join(''), argv.join(' ')).toContain('--help 를 보세요.')
    }
  })

  it('F-2050 C11 rm --yes 성공 경로', async () => {
    const deps = baseDeps({
      argv: ['rm', 'd1', '--yes'],
      env: { RAWDOC_TOKEN: 'rd_' + 'a'.repeat(43) },
      fetchImpl: (async () => jsonResponse({ id: 'd1', title: '내 문서' })) as unknown as typeof fetch,
    })
    const code = await main(deps)
    expect(code).toBe(0)
    expect(deps.stdoutLog.join('')).toBe('d1\n')
    expect(deps.stderrLog.join('')).toBe('문서를 지웠습니다: 내 문서\n')
  })

  it('F-2050 C11 rm --yes --json', async () => {
    const deps = baseDeps({
      argv: ['rm', 'd1', '--yes', '--json'],
      env: { RAWDOC_TOKEN: 'rd_' + 'a'.repeat(43) },
      fetchImpl: (async () => jsonResponse({ id: 'd1', title: '내 문서' })) as unknown as typeof fetch,
    })
    const code = await main(deps)
    expect(code).toBe(0)
    expect(JSON.parse(deps.stdoutLog.join(''))).toEqual({ id: 'd1', title: '내 문서' })
  })

  it('F-2050 C11 rmdir --yes --json 은 표준 출력이 V1DeletedFolder 한 줄, 표준 오류에 안내', async () => {
    const deps = baseDeps({
      argv: ['rmdir', 'f1', '--yes', '--json'],
      env: { RAWDOC_TOKEN: 'rd_' + 'a'.repeat(43) },
      fetchImpl: (async () => jsonResponse({ id: 'f1', contents: 'move-up', parentId: null, docs: 2, folders: 0 })) as unknown as typeof fetch,
    })
    const code = await main(deps)
    expect(code).toBe(0)
    expect(JSON.parse(deps.stdoutLog.join(''))).toEqual({ id: 'f1', contents: 'move-up', parentId: null, docs: 2, folders: 0 })
    expect(deps.stderrLog.join('')).toBe('폴더를 지웠습니다. 문서 2개는 맨 위로 옮겼습니다.\n')
  })

  it('F-2050 C11 ls --shared 빈 목록', async () => {
    const deps = baseDeps({
      argv: ['ls', '--shared'],
      env: { RAWDOC_TOKEN: 'rd_' + 'a'.repeat(43) },
      fetchImpl: (async () => jsonResponse([])) as unknown as typeof fetch,
    })
    const code = await main(deps)
    expect(code).toBe(0)
    expect(deps.stdoutLog.join('')).toBe('')
    expect(deps.stderrLog.join('')).toBe('공유받은 문서가 없습니다.\n')
  })

  it('F-2050 C12 진입점 금고 — mv --root + 403 e2ee_doc', async () => {
    const deps = baseDeps({
      argv: ['mv', 'd1', '--root'],
      env: { RAWDOC_TOKEN: 'rd_' + 'a'.repeat(43) },
      fetchImpl: (async () => jsonResponse({ error: 'e2ee_doc' }, 403)) as unknown as typeof fetch,
    })
    const code = await main(deps)
    expect(code).toBe(4)
    expect(deps.stderrLog.join('')).toBe('금고 문서는 명령줄 도구로 다룰 수 없습니다. 웹에서 하세요.\n')
    expect(deps.stdoutLog.join('')).toBe('')
  })

  it('F-2050 C13 도움말에 mv·rm·rmdir 줄이 순서대로', async () => {
    const deps = baseDeps({ argv: ['--help'] })
    const code = await main(deps)
    expect(code).toBe(0)
    const text = deps.stdoutLog.join('')
    const order = ['put', 'mv', 'rm', 'folders', 'mkdir', 'rmdir', 'upload', 'link'].map((name) => text.indexOf(`  ${name}\t`))
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1], `${order}`).toBeLessThan(order[i])
    }
  })
})

// 리뷰 C1 — npm/npx 의 .bin 심볼릭 링크로 실행하면 argv[1] 이 링크 경로라 문자열 비교가 거짓이었다
describe('isEntryScript (리뷰 C1)', () => {
  const real = '/usr/lib/node_modules/rawdoc/dist/rawdoc.js'
  const links: Record<string, string> = { '/usr/bin/rawdoc': real, [real]: real, '/usr/bin/other': '/usr/bin/other' }
  const realpath = (p: string) => {
    const r = links[p]
    if (!r) throw new Error('ENOENT')
    return r
  }

  it('같은 경로면 참', () => {
    expect(isEntryScript(real, real, realpath)).toBe(true)
  })

  it('심볼릭 링크로 실행해도 참', () => {
    expect(isEntryScript('/usr/bin/rawdoc', real, realpath)).toBe(true)
  })

  it('다른 파일이거나 argv[1] 이 없거나 경로를 풀 수 없으면 거짓', () => {
    expect(isEntryScript('/usr/bin/other', real, realpath)).toBe(false)
    expect(isEntryScript('/nowhere', real, realpath)).toBe(false)
    expect(isEntryScript(undefined, real, realpath)).toBe(false)
  })
})

// 리뷰 C2·C3 — 로그인 대기 타이머를 풀지 않아 최대 5분간 프로세스가 남았고, SIGINT 를 늘 가로채 Ctrl+C 가 안 먹었다
describe('로그인 대기 정리 (리뷰 C2·C3)', () => {
  function deniedLoginDeps(overrides: Partial<MainDeps>) {
    return baseDeps({
      argv: ['login'],
      openBrowserFn: vi.fn((url: string) => {
        const parsed = parseCliLoginHash(new URL(url).hash)
        if (parsed && parsed.version === 2) {
          void fetch(cliCallbackUrl(parsed.port, { state: parsed.publicKey, error: 'denied' }))
        }
      }),
      ...overrides,
    })
  }

  it('로그인이 끝나면 시간 제한 대기를 취소한다 (C2)', async () => {
    let waitSignal: AbortSignal | undefined
    const deps = deniedLoginDeps({
      wait: (_ms: number, signal?: AbortSignal) => {
        waitSignal = signal
        return new Promise(() => {})
      },
    })
    expect(await main(deps)).toBe(1)
    expect(waitSignal?.aborted).toBe(true)
  })

  it('SIGINT 는 브라우저 로그인을 기다리는 동안에만 가로챈다 (C3)', async () => {
    const stop = vi.fn()
    const watchSigint = vi.fn(() => ({ interrupted: new Promise<void>(() => {}), stop }))
    const deps = deniedLoginDeps({ watchSigint })
    expect(await main(deps)).toBe(1)
    expect(watchSigint).toHaveBeenCalledTimes(1)
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('브라우저 로그인 중 SIGINT → 종료 130, 대기·가로채기 정리 (C2·C3)', async () => {
    const stop = vi.fn()
    let waitSignal: AbortSignal | undefined
    const deps = baseDeps({
      argv: ['login', '--no-browser'],
      wait: (_ms: number, signal?: AbortSignal) => {
        waitSignal = signal
        return new Promise(() => {})
      },
      watchSigint: () => ({ interrupted: Promise.resolve(), stop }),
    })
    expect(await main(deps)).toBe(130)
    expect(stop).toHaveBeenCalledTimes(1)
    expect(waitSignal?.aborted).toBe(true)
  })

  it('다른 명령은 SIGINT 를 가로채지 않는다 (C3)', async () => {
    const watchSigint = vi.fn(() => ({ interrupted: new Promise<void>(() => {}), stop: () => {} }))
    const deps = baseDeps({ argv: ['ls'], env: { RAWDOC_TOKEN: 'rd_' + 'a'.repeat(43) }, watchSigint })
    expect(await main(deps)).toBe(0)
    expect(watchSigint).not.toHaveBeenCalled()
  })
})

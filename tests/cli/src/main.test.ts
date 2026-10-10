// F-2021 U16 (specs/features/F-2021.md 13.1, 4.7)
import { describe, expect, it, vi } from 'vitest'
import { isEntryScript, main, type MainDeps } from '../../../cli/src/main'
import { syntaxJson } from '../../../cli/src/syntax'
import { cliCallbackUrl, parseCliLoginHash } from '../../../src/lib/cliLoginUrl'

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

  it('put --help 가 get 먼저·판 번호·--force 위험을 안내한다', async () => {
    const deps = baseDeps({ argv: ['put', '--help'] })
    const code = await main(deps)
    expect(code).toBe(0)
    const text = deps.stdoutLog.join('')
    expect(text).toContain('--base-version <n>')
    expect(text).toContain('종료 코드 5')
    expect(text).toContain('--force')
    expect(text).toContain('확인 없이 덮어씁니다')
    expect(text).toContain('get <id> -o 파일.md')
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

describe('F-2118 syntax 명령', () => {
  it('A1 서버·토큰·fetch 없이 마크다운을 출력하고 종료 0', async () => {
    const fetchImpl = vi.fn()
    const deps = baseDeps({ argv: ['syntax'], env: { RAWDOC_SERVER: 'http://example.com' }, fetchImpl: fetchImpl as unknown as typeof fetch })
    const code = await main(deps)
    expect(code).toBe(0)
    expect(deps.stdoutLog.join('').startsWith('# Rawdoc 마크다운 문법\n')).toBe(true)
    expect(deps.stderrLog.join('')).toBe('')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('A6 --json 은 syntaxJson 한 줄', async () => {
    const deps = baseDeps({ argv: ['syntax', '--json'], packageVersion: '0.3.1' })
    expect(await main(deps)).toBe(0)
    const out = deps.stdoutLog.join('')
    expect(out.endsWith('\n') && out.split('\n').length).toBe(2)
    expect(JSON.parse(out)).toEqual(syntaxJson('0.3.1'))
  })

  it('A7 위치 인자·모르는 옵션은 종료 2', async () => {
    for (const argv of [['syntax', 'foo'], ['syntax', '--x']]) {
      const deps = baseDeps({ argv })
      expect(await main(deps)).toBe(2)
      expect(deps.stderrLog.join('')).toContain('rawdoc syntax --help 를 보세요.')
    }
  })

  it('A8 --help 에 syntax 줄이 link 뒤, 마지막 줄은 안내 문구', async () => {
    const deps = baseDeps({ argv: ['--help'] })
    await main(deps)
    const out = deps.stdoutLog.join('')
    expect(out.indexOf('  syntax\t')).toBeGreaterThan(out.indexOf('  link\t'))
    expect(out.trimEnd().split('\n').pop()).toBe(
      'AI 도구가 문서를 쓰기 전에 rawdoc syntax 로 콜아웃·위키링크 같은 문법을 확인하게 하세요.',
    )
  })

  it('A9 syntax --help 는 한 줄 설명', async () => {
    const deps = baseDeps({ argv: ['syntax', '--help'] })
    expect(await main(deps)).toBe(0)
    expect(deps.stdoutLog.join('')).toBe('rawdoc syntax — 문서에 쓰는 마크다운 문법(콜아웃·위키링크·수식 등)을 출력합니다\n')
  })
})

describe('F-2119 A5·A7~A9 main()', () => {
  const tokenEnv = { RAWDOC_TOKEN: 'rd_' + 'a'.repeat(43) }
  const mk = (id: string, folderId: string | null, title: string, extra: object = {}) => ({
    id, title, folderId, lineEnding: 'lf', pinnedAt: null, version: 2, createdAt: 1000, updatedAt: 2000, ...extra,
  })
  const docs = [mk('d1', null, '바이브 회의록'), mk('d2', 'f1', '일지'), mk('d3', 'gone', '유령'), mk('d4', null, '', { e2ee: true })]
  const folders = [{ id: 'f1', name: '수업', parentId: null, createdAt: 0, updatedAt: 0 }]
  const shared = [{ ...mk('s1', 'other', '공유'), role: 'view', ownerEmail: 'o@x.com' }]

  function run(argv: string[], failFolders = false) {
    const urls: string[] = []
    const deps = baseDeps({
      argv,
      env: tokenEnv,
      fetchImpl: (async (url: string) => {
        urls.push(new URL(url).pathname)
        if (url.endsWith('/v1/docs')) return jsonResponse(docs)
        if (url.endsWith('/v1/folders')) return failFolders ? jsonResponse({ error: 'x' }, 500) : jsonResponse(folders)
        if (url.endsWith('/v1/shared')) return jsonResponse(shared)
        return jsonResponse({}, 404)
      }) as unknown as typeof fetch,
    })
    return { deps, urls }
  }

  it('A5 ls 는 1회·3열, ls --path 는 2회·4열, --json 은 folderPath 만 더한다', async () => {
    const plain = run(['ls'])
    expect(await main(plain.deps)).toBe(0)
    expect(plain.urls).toEqual(['/v1/docs'])
    expect(plain.deps.stdoutLog.join('').split('\n')[0].split('\t')).toHaveLength(3)

    const withPath = run(['ls', '--path'])
    expect(await main(withPath.deps)).toBe(0)
    expect(withPath.urls.sort()).toEqual(['/v1/docs', '/v1/folders'])
    const rows = withPath.deps.stdoutLog.join('').trim().split('\n').map((l) => l.split('\t'))
    expect(rows.map((r) => r[2])).toEqual(['/', '수업', '?', '/'])
    expect(rows.every((r) => r.length === 4)).toBe(true)

    const json = run(['ls', '--path', '--json'])
    await main(json.deps)
    const parsed = JSON.parse(json.deps.stdoutLog.join(''))
    expect(parsed.map((d: { folderPath: unknown }) => d.folderPath)).toEqual([[], ['수업'], null, []])
    expect(parsed.map((d: Record<string, unknown>) => Object.fromEntries(Object.entries(d).filter(([k]) => k !== 'folderPath')))).toEqual(docs)
  })

  it('A7 find 0건: 종료 0, 표준 출력 비움, 표준 오류 문구. --json 은 []', async () => {
    const r = run(['find', '없는제목'])
    expect(await main(r.deps)).toBe(0)
    expect(r.deps.stdoutLog.join('')).toBe('')
    expect(r.deps.stderrLog.join('')).toBe('제목으로 찾은 문서가 없습니다: 없는제목\n')
    const j = run(['find', '없는제목', '--json'])
    expect(await main(j.deps)).toBe(0)
    expect(j.deps.stdoutLog.join('')).toBe('[]\n')
    const hit = run(['find', '회의록'])
    await main(hit.deps)
    expect(hit.deps.stdoutLog.join('')).toBe('d1\t1970-01-01T00:00:02Z\t바이브 회의록\n')
    expect(hit.urls).toEqual(['/v1/docs'])
  })

  it('A8 info: 내 문서·공유·없음·폴더 500', async () => {
    const mine = run(['info', 'd2'])
    expect(await main(mine.deps)).toBe(0)
    expect(mine.deps.stdoutLog.join('')).toContain('folder\t수업\n')
    const sh = run(['info', 's1'])
    expect(await main(sh.deps)).toBe(0)
    expect(sh.urls).toHaveLength(3)
    expect(sh.deps.stdoutLog.join('')).toContain('role\t보기\n')
    const none = run(['info', 'zzz'])
    expect(await main(none.deps)).toBe(4)
    expect(none.deps.stderrLog.join('')).toBe('찾을 수 없습니다. id 를 확인하세요: zzz\n')
    const bad = run(['info', 'd1'], true)
    expect(await main(bad.deps)).toBe(1)
    expect(bad.deps.stdoutLog.join('')).toBe('')
  })

  it('A9 --help 순서와 ls --help 상세', async () => {
    const h = baseDeps({ argv: ['--help'] })
    await main(h)
    const t = h.stdoutLog.join('')
    expect(t.indexOf('  find\t')).toBeGreaterThan(t.indexOf('  ls\t'))
    expect(t.indexOf('  info\t')).toBeGreaterThan(t.indexOf('  find\t'))
    expect(t.indexOf('  get\t')).toBeGreaterThan(t.indexOf('  info\t'))
    const l = baseDeps({ argv: ['ls', '--help'] })
    await main(l)
    const lt = l.stdoutLog.join('')
    expect(lt).toContain('사용: rawdoc ls [--folder <폴더id|경로> | --root | --shared] [--path]')
    expect(lt).toContain('  --path             제목 앞에 폴더 경로 열을 넣습니다. 맨 위 문서는 /')
    expect(lt).toContain('시각은 UTC(ISO 8601)입니다. --json 의 시각 필드는 1970년부터의 밀리초입니다.')
  })
})

describe('F-2132 main() — 폴더 경로·put 미리 보기·help', () => {
  const tokenEnv = { RAWDOC_TOKEN: 'rd_' + 'a'.repeat(43) }
  const F1 = '11111111-1111-4111-8111-111111111111'
  const F2 = '22222222-2222-4222-8222-222222222222'
  const F3 = '33333333-3333-4333-8333-333333333333'
  const folder = (id: string, name: string, parentId: string | null) => ({ id, name, parentId, createdAt: 0, updatedAt: 0 })
  const mkDoc = (id: string, folderId: string | null, content = 'a\r\nb', lineEnding = 'crlf', version = 5) => ({
    id, title: id, content, lineEnding, folderId, pinnedAt: null, version, createdAt: 0, updatedAt: 0,
  })
  const tree = [folder(F1, '수업자료', null), folder(F2, '1주차', F1)]

  function setup(argv: string[], opts: { folders?: unknown[]; serverDoc?: ReturnType<typeof mkDoc>; readFile?: string } = {}) {
    const calls: Array<{ method: string; path: string; body: unknown }> = []
    const folders = opts.folders ?? tree
    const serverDoc = opts.serverDoc ?? mkDoc('d1', null)
    const deps = baseDeps({
      argv,
      env: tokenEnv,
      readFile: vi.fn(async () => new TextEncoder().encode(opts.readFile ?? 'x\ny')),
      fetchImpl: (async (url: string, init?: RequestInit) => {
        const path = new URL(url).pathname
        const method = init?.method ?? 'GET'
        calls.push({ method, path, body: init?.body ? JSON.parse(init.body as string) : undefined })
        if (path === '/v1/folders' && method === 'GET') return jsonResponse(folders)
        if (path === '/v1/folders') return jsonResponse(folder(F3, 'n', null), 201)
        if (path === '/v1/docs' && method === 'GET') return jsonResponse([mkDoc('in', F2), mkDoc('deep', F3), mkDoc('top', null)])
        if (path === '/v1/docs') return jsonResponse(mkDoc('new', F2), 201)
        if (path.endsWith('/folder')) return jsonResponse(mkDoc('d1', F2))
        return jsonResponse(serverDoc)
      }) as unknown as typeof fetch,
    })
    return { deps, calls }
  }

  it('A3 new --folder 경로: GET folders → POST docs(folderId)', async () => {
    const r = setup(['new', 'a.md', '--folder', '수업자료/1주차'])
    expect(await main(r.deps)).toBe(0)
    expect(r.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /v1/folders', 'POST /v1/docs'])
    expect(r.calls[1].body).toMatchObject({ folderId: F2 })
  })

  it('A3 UUID 값이면 요청 1회', async () => {
    const r = setup(['new', 'a.md', '--folder', F2])
    expect(await main(r.deps)).toBe(0)
    expect(r.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /v1/docs'])
  })

  it('A3 없는 경로: 종료 2, 표준 출력 비움, 쓰기 없음. Git Bash 변환 값이면 문장이 붙음', async () => {
    const r = setup(['new', 'a.md', '--folder', '없는/경로'])
    expect(await main(r.deps)).toBe(2)
    expect(r.deps.stdoutLog.join('')).toBe('')
    expect(r.deps.stderrLog.join('')).toBe('폴더를 찾을 수 없습니다: 없는/경로. rawdoc folders 로 폴더 id 와 경로를 확인하세요.\n')
    expect(r.calls.some((c) => c.method !== 'GET')).toBe(false)
    const bash = setup(['new', 'a.md', '--folder', 'C:/Program Files/Git/x'])
    await main(bash.deps)
    expect(bash.deps.stderrLog.join('')).toContain('Git Bash 가 Windows 경로로 바꿉니다')
  })

  it('A3 여러 폴더: 종료 2, --json 에 folderIds', async () => {
    const dup = [folder(F1, 'x', null), folder(F2, 'x', null)]
    const r = setup(['new', 'a.md', '--folder', 'x', '--json'], { folders: dup })
    expect(await main(r.deps)).toBe(2)
    expect(JSON.parse(r.deps.stderrLog.join(''))).toMatchObject({ error: 'folder_ambiguous', folder: 'x', folderIds: [F1, F2] })
    expect(r.calls.some((c) => c.method === 'POST')).toBe(false)
  })

  it('A3 mv --folder 경로·mkdir --parent 경로', async () => {
    const mv = setup(['mv', 'd1', '--folder', '수업자료/1주차'])
    expect(await main(mv.deps)).toBe(0)
    expect(mv.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /v1/folders', 'PUT /v1/docs/d1/folder'])
    expect(mv.calls[1].body).toEqual({ folderId: F2 })
    const mk = setup(['mkdir', 'x', '--parent', '수업자료'])
    expect(await main(mk.deps)).toBe(0)
    expect(mk.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /v1/folders', 'POST /v1/folders'])
    expect(mk.calls[1].body).toEqual({ name: 'x', parentId: F1 })
  })

  it('A4 ls·find --folder 경로는 요청 2회, 바로 든 문서만', async () => {
    for (const argv of [['ls', '--folder', '수업자료/1주차'], ['ls', '--folder', '수업자료/1주차', '--path'], ['find', 'i', '--folder', '수업자료/1주차']]) {
      const r = setup(argv)
      expect(await main(r.deps)).toBe(0)
      expect(r.calls.map((c) => c.path).sort()).toEqual(['/v1/docs', '/v1/folders'])
      const rows = r.deps.stdoutLog.join('').trim().split('\n')
      expect(rows).toHaveLength(1)
      expect(rows[0].startsWith('in\t')).toBe(true)
    }
  })

  it('A7 put --dry-run: GET 1회, PUT 없음, 키 순서 줄', async () => {
    const r = setup(['put', 'd1', 'a.md', '--dry-run'], { readFile: 'a\nX' })
    expect(await main(r.deps)).toBe(0)
    expect(r.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /v1/docs/d1'])
    expect(r.deps.stdoutLog.join('')).toBe(
      'id\td1\nversion\t5\nlineEnding\tcrlf\nfileLineEnding\tlf\ntitleChanged\tfalse\ncontentChanged\ttrue\nlinesAdded\t1\nlinesRemoved\t1\nfirstChangedLine\t2\n',
    )
    expect(r.deps.stderrLog.join('')).toBe('"a.md" 줄바꿈(LF)이 서버 문서(CRLF)와 달라 서버 문서에 맞춰 저장됩니다.\n')
    const j = setup(['put', 'd1', 'a.md', '--dry-run', '--json'], { readFile: 'a\nX' })
    await main(j.deps)
    expect(JSON.parse(j.deps.stdoutLog.join(''))).toMatchObject({ dryRun: true, id: 'd1', version: 5, linesAdded: 1, firstChangedLine: 2 })
  })

  it('A7 --base-version 불일치+변경 → 종료 5, 표준 출력 비움', async () => {
    const r = setup(['put', 'd1', 'a.md', '--dry-run', '--base-version', '3', '--json'], { readFile: 'q\nr' })
    expect(await main(r.deps)).toBe(5)
    expect(r.deps.stdoutLog.join('')).toBe('')
    expect(JSON.parse(r.deps.stderrLog.join(''))).toMatchObject({ error: 'conflict', currentVersion: 5 })
  })

  it('A7 바뀌는 것 없음 → 종료 0, 표준 오류 안내', async () => {
    const r = setup(['put', 'd1', 'a.md', '--dry-run'], { readFile: 'a\nb' })
    expect(await main(r.deps)).toBe(0)
    expect(r.deps.stderrLog.join('')).toContain('바뀌는 내용이 없습니다.\n')
  })

  it('A8 쓰기 put: 서버 방식이 다르면 성공 뒤 안내, 같거나 한 줄·제목만이면 없음', async () => {
    const differ = setup(['put', 'd1', 'a.md', '--force'], { readFile: 'a\nb' })
    expect(await main(differ.deps)).toBe(0)
    expect(differ.deps.stderrLog.join('')).toBe('"a.md" 줄바꿈(LF)이 서버 문서(CRLF)와 달라 서버 문서에 맞춰 저장했습니다.\n')
    const same = setup(['put', 'd1', 'a.md', '--force'], { readFile: 'a\r\nb' })
    await main(same.deps)
    expect(same.deps.stderrLog.join('')).toBe('')
    const one = setup(['put', 'd1', 'a.md', '--force'], { readFile: 'ab' })
    await main(one.deps)
    expect(one.deps.stderrLog.join('')).toBe('')
    const title = setup(['put', 'd1', '--title', 't', '--force'])
    await main(title.deps)
    expect(title.deps.stderrLog.join('')).toBe('')
  })

  it('A9 help <명령> 은 <명령> --help 와 같고 help nope 은 종료 2', async () => {
    const a = baseDeps({ argv: ['help', 'new'] })
    const b = baseDeps({ argv: ['new', '--help'] })
    expect(await main(a)).toBe(0)
    await main(b)
    expect(a.stdoutLog.join('')).toBe(b.stdoutLog.join(''))
    const bad = baseDeps({ argv: ['help', 'nope'] })
    expect(await main(bad)).toBe(2)
    expect(bad.stderrLog.join('')).toBe('알 수 없는 명령입니다: nope\n')
  })
})

describe('new --url·파일 읽기 오류 (tweak)', () => {
  const tokenEnv = { RAWDOC_TOKEN: 'rd_' + 'a'.repeat(43) }
  const created = { id: 'd 1', title: 't', content: '', lineEnding: 'lf', folderId: null, pinnedAt: null, version: 1, createdAt: 0, updatedAt: 0 }
  const newDeps = (argv: string[], readFile?: MainDeps['readFile']) =>
    baseDeps({
      argv,
      env: { ...tokenEnv, RAWDOC_SERVER: 'http://localhost:8790' },
      readFile: readFile ?? vi.fn(async () => new TextEncoder().encode('x')),
      fetchImpl: (async () => jsonResponse(created, 201)) as unknown as typeof fetch,
    })

  it('--url 없으면 id 한 줄, 있으면 id 다음 줄에 앱 주소', async () => {
    const plain = newDeps(['new', 'a.md'])
    expect(await main(plain)).toBe(0)
    expect(plain.stdoutLog.join('')).toBe('d 1\n')
    const withUrl = newDeps(['new', 'a.md', '--url'])
    expect(await main(withUrl)).toBe(0)
    expect(withUrl.stdoutLog.join('')).toBe('d 1\nhttp://localhost:8790/#/d/d%201\n')
  })

  it('--url --json 은 url 필드를 더하고, --url 없는 --json 엔 url 이 없다', async () => {
    const withUrl = newDeps(['new', 'a.md', '--url', '--json'])
    await main(withUrl)
    expect(JSON.parse(withUrl.stdoutLog.join(''))).toMatchObject({ id: 'd 1', url: 'http://localhost:8790/#/d/d%201' })
    const plain = newDeps(['new', 'a.md', '--json'])
    await main(plain)
    expect(JSON.parse(plain.stdoutLog.join(''))).not.toHaveProperty('url')
  })

  it('읽기 실패는 OS 오류 코드로 문구가 갈리고, 주소 모양 경로엔 표준 입력 안내가 붙는다', async () => {
    const enoent = vi.fn(async () => {
      throw Object.assign(new Error('nope'), { code: 'ENOENT' })
    })
    const missing = newDeps(['new', 'local://a.md'], enoent)
    expect(await main(missing)).toBe(1)
    expect(missing.stderrLog.join('')).toBe('파일이 없습니다: local://a.md. 파일 경로가 아니라면 내용을 - (표준 입력)으로 넘기세요.\n')
    const plainMissing = newDeps(['new', 'a.md'], enoent)
    await main(plainMissing)
    expect(plainMissing.stderrLog.join('')).toBe('파일이 없습니다: a.md.\n')
  })
})

describe('search main()', () => {
  const tokenEnv = { RAWDOC_TOKEN: 'rd_' + 'a'.repeat(43) }
  const found = {
    docs: [{ id: 'd1', title: '회의', folderId: null, version: 1, updatedAt: 0, lines: [{ line: 3, text: 'the needle' }], matchedLines: 1 }],
    truncated: false,
    e2eeSkipped: 2,
  }
  const empty = { docs: [], truncated: false, e2eeSkipped: 0 }

  function run(argv: string[], body: unknown) {
    const urls: string[] = []
    const deps = baseDeps({
      argv,
      env: tokenEnv,
      fetchImpl: (async (url: string) => {
        const u = new URL(url)
        urls.push(u.pathname)
        if (u.pathname === '/v1/search') return jsonResponse(body)
        if (u.pathname === '/v1/folders') return jsonResponse([])
        return jsonResponse({}, 404)
      }) as unknown as typeof fetch,
    })
    return { deps, urls }
  }

  it('찾으면 표준 출력에 문서·줄, 표준 오류에 합계, 종료 0', async () => {
    const r = run(['search', 'needle'], found)
    expect(await main(r.deps)).toBe(0)
    expect(r.urls.sort()).toEqual(['/v1/folders', '/v1/search'])
    expect(r.deps.stdoutLog.join('')).toBe('d1\t/회의\n  3: the needle\n')
    expect(r.deps.stderrLog.join('')).toBe('문서 1개, 금고 문서 2개는 찾지 못함\n')
  })

  it('0건: 종료 0, 표준 출력 비움, 표준 오류 문구. --json 은 결과 객체', async () => {
    const r = run(['search', '없는글자'], empty)
    expect(await main(r.deps)).toBe(0)
    expect(r.deps.stdoutLog.join('')).toBe('')
    expect(r.deps.stderrLog.join('')).toBe('제목·본문에서 찾은 문서가 없습니다: 없는글자\n')
    const j = run(['search', '없는글자', '--json'], empty)
    expect(await main(j.deps)).toBe(0)
    expect(JSON.parse(j.deps.stdoutLog.join(''))).toEqual(empty)
    expect(j.deps.stderrLog.join('')).toBe('')
  })

  it('전체 도움말에서 search 는 find 바로 뒤', async () => {
    const h = baseDeps({ argv: ['--help'] })
    await main(h)
    const rows = h.stdoutLog.join('').split('\n').filter((l) => l.startsWith('  '))
    const at = rows.findIndex((l) => l.startsWith('  find\t'))
    expect(rows[at + 1]).toBe('  search\t제목·본문에 그 글자가 든 내 문서와 줄을 찾습니다 (금고 문서 제외)')
  })
})

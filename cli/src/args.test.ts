// F-2021 U1 (specs/features/F-2021.md 13.1, 4.2)
import { describe, expect, it } from 'vitest'
import { parseArgs } from './args'

describe('F-2021 U1 args.ts — 명령마다 해석', () => {
  it('login', () => {
    const r = parseArgs(['login', '--force', '--with-token', '--no-browser', '--server', 'http://localhost:8790'])
    expect(r).toEqual({
      kind: 'run',
      command: {
        name: 'login',
        global: { server: 'http://localhost:8790', json: false },
        force: true,
        withToken: true,
        noBrowser: true,
      },
    })
  })

  it('logout·whoami·folders — 옵션 없이', () => {
    for (const name of ['logout', 'whoami', 'folders'] as const) {
      const r = parseArgs([name, '--json'])
      expect(r).toEqual({ kind: 'run', command: { name, global: { server: null, json: true } } })
    }
  })

  it('ls --folder', () => {
    const r = parseArgs(['ls', '--folder', 'f1'])
    expect(r).toEqual({ kind: 'run', command: { name: 'ls', global: { server: null, json: false }, folder: 'f1' } })
  })

  it('get <id> -o out.md', () => {
    const r = parseArgs(['get', 'd1', '-o', 'out.md'])
    expect(r).toEqual({
      kind: 'run',
      command: { name: 'get', global: { server: null, json: false }, id: 'd1', output: 'out.md' },
    })
  })

  it('get 인자 없으면 usage', () => {
    const r = parseArgs(['get'])
    expect(r.kind).toBe('usage')
  })

  it('new <file> --title --folder', () => {
    const r = parseArgs(['new', 'a.md', '--title', '제목', '--folder', 'f1'])
    expect(r).toEqual({
      kind: 'run',
      command: { name: 'new', global: { server: null, json: false }, source: 'a.md', title: '제목', folder: 'f1' },
    })
  })

  it('new - (표준 입력)', () => {
    const r = parseArgs(['new', '-', '--title', 't'])
    expect(r.kind).toBe('run')
    if (r.kind === 'run' && r.command.name === 'new') expect(r.command.source).toBe('-')
  })

  it('new 원문도 --title 도 없으면 usage', () => {
    const r = parseArgs(['new'])
    expect(r.kind).toBe('usage')
  })

  it('put --base-version', () => {
    const r = parseArgs(['put', 'd1', 'a.md', '--base-version', '3'])
    expect(r).toEqual({
      kind: 'run',
      command: {
        name: 'put',
        global: { server: null, json: false },
        id: 'd1',
        source: 'a.md',
        title: null,
        baseVersion: 3,
        force: false,
      },
    })
  })

  it('put --force', () => {
    const r = parseArgs(['put', 'd1', 'a.md', '--force'])
    expect(r.kind).toBe('run')
    if (r.kind === 'run' && r.command.name === 'put') {
      expect(r.command.force).toBe(true)
      expect(r.command.baseVersion).toBeNull()
    }
  })

  it('put --base-version·--force 둘 다 없으면 usage', () => {
    const r = parseArgs(['put', 'd1', 'a.md'])
    expect(r.kind).toBe('usage')
  })

  it('put --base-version·--force 둘 다 있으면 usage', () => {
    const r = parseArgs(['put', 'd1', 'a.md', '--base-version', '1', '--force'])
    expect(r.kind).toBe('usage')
  })

  it('put --base-version abc 는 usage', () => {
    const r = parseArgs(['put', 'd1', 'a.md', '--base-version', 'abc'])
    expect(r.kind).toBe('usage')
  })

  it('put 원문도 --title 도 없으면 usage', () => {
    const r = parseArgs(['put', 'd1', '--force'])
    expect(r.kind).toBe('usage')
  })

  it('put --title 만이면 통과', () => {
    const r = parseArgs(['put', 'd1', '--title', '새 제목', '--force'])
    expect(r.kind).toBe('run')
  })

  it('mkdir <이름> --parent', () => {
    const r = parseArgs(['mkdir', '새 폴더', '--parent', 'p1'])
    expect(r).toEqual({
      kind: 'run',
      command: { name: 'mkdir', global: { server: null, json: false }, folderName: '새 폴더', parent: 'p1' },
    })
  })

  it('upload <파일>', () => {
    const r = parseArgs(['upload', 'a.png'])
    expect(r).toEqual({ kind: 'run', command: { name: 'upload', global: { server: null, json: false }, file: 'a.png' } })
  })

  it('link <id>', () => {
    const r = parseArgs(['link', 'd1'])
    expect(r).toEqual({ kind: 'run', command: { name: 'link', global: { server: null, json: false }, id: 'd1' } })
  })
})

describe('F-2021 U1 args.ts — 오류', () => {
  it('모르는 명령', () => {
    expect(parseArgs(['frobnicate']).kind).toBe('usage')
  })

  it('모르는 옵션', () => {
    expect(parseArgs(['ls', '--nope']).kind).toBe('usage')
  })

  it('어떤 옵션도 토큰 값을 받지 않는다 — --token 은 모르는 옵션', () => {
    expect(parseArgs(['login', '--token', 'rd_x']).kind).toBe('usage')
    expect(parseArgs(['whoami', '--token', 'rd_x']).kind).toBe('usage')
  })

  it('인자 개수 오류 — mkdir 인자 2개', () => {
    expect(parseArgs(['mkdir', 'a', 'b']).kind).toBe('usage')
  })

  it('명령 없음 → no-command', () => {
    expect(parseArgs([])).toEqual({ kind: 'no-command' })
  })

  it('--help / -h → help', () => {
    expect(parseArgs(['--help'])).toEqual({ kind: 'help', command: null })
    expect(parseArgs(['ls', '-h'])).toEqual({ kind: 'help', command: 'ls' })
  })

  it('--version / -v → version', () => {
    expect(parseArgs(['--version']).kind).toBe('version')
    expect(parseArgs(['-v']).kind).toBe('version')
  })
})

// F-2021 U1 (specs/features/F-2021.md 13.1, 4.2)
import { describe, expect, it } from 'vitest'
import { parseArgs } from '../../../cli/src/args'

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
    expect(r).toEqual({
      kind: 'run',
      command: { name: 'ls', global: { server: null, json: false }, folder: 'f1', shared: false, root: false, path: false },
    })
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
      command: { name: 'new', global: { server: null, json: false }, source: 'a.md', title: '제목', folder: 'f1', url: false },
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
        dryRun: false,
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

describe('F-2050 5.1 args.ts — rm·mv·rmdir·ls --shared', () => {
  it('rm <id> --yes', () => {
    const r = parseArgs(['rm', 'd1', '--yes'])
    expect(r).toEqual({ kind: 'run', command: { name: 'rm', global: { server: null, json: false }, id: 'd1' } })
  })

  it('mv <id> --folder <폴더id>', () => {
    const r = parseArgs(['mv', 'd1', '--folder', 'f1'])
    expect(r).toEqual({
      kind: 'run',
      command: { name: 'mv', global: { server: null, json: false }, id: 'd1', folderId: 'f1' },
    })
  })

  it('mv <id> --root', () => {
    const r = parseArgs(['mv', 'd1', '--root'])
    expect(r).toEqual({
      kind: 'run',
      command: { name: 'mv', global: { server: null, json: false }, id: 'd1', folderId: null },
    })
  })

  it('rmdir <id> --yes', () => {
    const r = parseArgs(['rmdir', 'f1', '--yes'])
    expect(r).toEqual({
      kind: 'run',
      command: { name: 'rmdir', global: { server: null, json: false }, id: 'f1', all: false },
    })
  })

  it('rmdir <id> --yes --all', () => {
    const r = parseArgs(['rmdir', 'f1', '--yes', '--all'])
    expect(r).toEqual({
      kind: 'run',
      command: { name: 'rmdir', global: { server: null, json: false }, id: 'f1', all: true },
    })
  })

  it('ls --shared', () => {
    const r = parseArgs(['ls', '--shared'])
    expect(r).toEqual({
      kind: 'run',
      command: { name: 'ls', global: { server: null, json: false }, folder: null, shared: true, root: false, path: false },
    })
  })

  it('사용법 오류 여덟 줄', () => {
    const cases: [string[], string][] = [
      [['rm'], '문서 id 가 필요합니다.'],
      [['rm', 'd1', 'd2'], '문서 id 가 필요합니다.'],
      [['rm', 'd1'], '문서를 영구 삭제하려면 --yes 를 붙이세요. 되돌릴 수 없습니다.'],
      [['mv'], '문서 id 가 필요합니다.'],
      [['mv', 'd1'], '--folder <폴더id> 또는 --root 중 하나가 필요합니다.'],
      [['mv', 'd1', '--folder', 'f1', '--root'], '--folder <폴더id> 또는 --root 중 하나가 필요합니다.'],
      [['rmdir'], '폴더 id 가 필요합니다.'],
      [['rmdir', 'f1'], '폴더를 지우려면 --yes 를 붙이세요. 안의 문서와 폴더는 위 폴더로 옮겨집니다.'],
      [['rmdir', 'f1', '--all'], '폴더와 안의 문서·폴더를 모두 영구 삭제하려면 --yes 를 붙이세요. 되돌릴 수 없습니다.'],
      [['ls', '--shared', '--folder', 'f1'], '--shared 와 --folder 는 함께 쓸 수 없습니다.'],
    ]
    for (const [argv, message] of cases) {
      const r = parseArgs(argv)
      expect(r.kind, argv.join(' ')).toBe('usage')
      if (r.kind === 'usage') expect(r.message, argv.join(' ')).toBe(message)
    }
  })

  it('rm d1 -y 는 usage(모르는 옵션)', () => {
    expect(parseArgs(['rm', 'd1', '-y']).kind).toBe('usage')
  })

  it('ls·ls --folder 는 지금과 같다(shared: false 가 더해지는 것 외)', () => {
    expect(parseArgs(['ls'])).toEqual({
      kind: 'run',
      command: { name: 'ls', global: { server: null, json: false }, folder: null, shared: false, root: false, path: false },
    })
    expect(parseArgs(['ls', '--folder', 'f1'])).toEqual({
      kind: 'run',
      command: { name: 'ls', global: { server: null, json: false }, folder: 'f1', shared: false, root: false, path: false },
    })
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

describe('F-2118 A7 args.ts — syntax', () => {
  it('옵션 없이 run, 위치 인자·모르는 옵션은 usage', () => {
    expect(parseArgs(['syntax', '--json'])).toEqual({
      kind: 'run',
      command: { name: 'syntax', global: { server: null, json: true } },
    })
    expect(parseArgs(['syntax', 'foo']).kind).toBe('usage')
    expect(parseArgs(['syntax', '--x']).kind).toBe('usage')
  })
})

describe('F-2119 A1 ls --root·--path, find, info', () => {
  const g = { server: null, json: false }

  it('해석', () => {
    expect(parseArgs(['ls', '--root', '--path'])).toEqual({
      kind: 'run',
      command: { name: 'ls', global: g, folder: null, shared: false, root: true, path: true },
    })
    expect(parseArgs(['find', '회의록', '--folder', 'f1'])).toEqual({
      kind: 'run',
      command: { name: 'find', global: g, query: '회의록', folder: 'f1', root: false, path: false },
    })
    expect(parseArgs(['find', '  회의 ', '--root', '--path', '--json'])).toEqual({
      kind: 'run',
      command: { name: 'find', global: { server: null, json: true }, query: '회의', folder: null, root: true, path: true },
    })
    expect(parseArgs(['info', 'd1'])).toEqual({ kind: 'run', command: { name: 'info', global: g, id: 'd1' } })
  })

  it('사용법 오류 문구', () => {
    const cases: Array<[string[], string, string]> = [
      [['ls', '--shared', '--root'], '--shared 와 --root 는 함께 쓸 수 없습니다.', 'ls'],
      [['ls', '--shared', '--path'], '--shared 와 --path 는 함께 쓸 수 없습니다.', 'ls'],
      [['ls', '--root', '--folder', 'f1'], '--root 와 --folder 는 함께 쓸 수 없습니다.', 'ls'],
      [['find', '--root', '--folder', 'f1', 'x'], '--root 와 --folder 는 함께 쓸 수 없습니다.', 'find'],
      [['find'], '찾을 제목이 필요합니다.', 'find'],
      [['find', '   '], '찾을 제목이 필요합니다.', 'find'],
      [['find', 'a', 'b'], '제목은 하나만 줄 수 있습니다. 띄어쓰기가 든 제목은 따옴표로 감싸세요.', 'find'],
      [['info'], '문서 id 가 필요합니다.', 'info'],
      [['info', 'a', 'b'], '문서 id 가 필요합니다.', 'info'],
    ]
    for (const [argv, message, command] of cases) {
      const r = parseArgs(argv)
      expect(r.kind, argv.join(' ')).toBe('usage')
      if (r.kind === 'usage') {
        expect(r.message, argv.join(' ')).toBe(message)
        expect(r.command).toBe(command)
      }
    }
  })
})

describe('F-2132 A1 help 별칭·put --dry-run', () => {
  it('help·help put·help nope·help put ls', () => {
    expect(parseArgs(['help'])).toEqual({ kind: 'help', command: null })
    expect(parseArgs(['help', 'put'])).toEqual({ kind: 'help', command: 'put' })
    expect(parseArgs(['help', 'nope'])).toEqual({ kind: 'usage', message: '알 수 없는 명령입니다: nope', command: null })
    expect(parseArgs(['help', 'put', 'ls'])).toEqual({
      kind: 'usage',
      message: 'help 뒤에는 명령 이름 하나만 줍니다.',
      command: null,
    })
  })

  it('put --dry-run 은 판 번호·--force 없이도 run', () => {
    const r = parseArgs(['put', 'd1', 'a.md', '--dry-run'])
    expect(r).toMatchObject({ kind: 'run', command: { name: 'put', dryRun: true, baseVersion: null, force: false } })
  })

  it('put --dry-run --base-version 3 은 run, --base-version 과 --force 둘 다면 usage', () => {
    expect(parseArgs(['put', 'd1', 'a.md', '--dry-run', '--base-version', '3'])).toMatchObject({
      kind: 'run',
      command: { dryRun: true, baseVersion: 3 },
    })
    expect(parseArgs(['put', 'd1', 'a.md', '--dry-run', '--base-version', '1', '--force']).kind).toBe('usage')
  })

  it('--dry-run 이 없으면 판 번호 규칙은 그대로', () => {
    expect(parseArgs(['put', 'd1', 'a.md']).kind).toBe('usage')
  })
})

describe('search 해석', () => {
  const g = { server: null, json: false }

  it('검색어·--folder·--json', () => {
    expect(parseArgs(['search', 'needle'])).toEqual({ kind: 'run', command: { name: 'search', global: g, query: 'needle', folder: null } })
    expect(parseArgs(['search', ' 회의 메모 ', '--folder', '수업/1주차', '--json'])).toEqual({
      kind: 'run',
      command: { name: 'search', global: { server: null, json: true }, query: '회의 메모', folder: '수업/1주차' },
    })
    expect(parseArgs(['search', 'a'.repeat(200)]).kind).toBe('run')
  })

  it('사용법 오류', () => {
    const cases: [string[], string][] = [
      [['search'], '찾을 글자가 필요합니다.'],
      [['search', '  '], '찾을 글자가 필요합니다.'],
      [['search', 'a', 'b'], '검색어는 하나만 줄 수 있습니다. 띄어쓰기가 든 검색어는 따옴표로 감싸세요.'],
      [['search', 'a'.repeat(201)], '검색어는 200자까지입니다.'],
      [['search', 'a', '--root'], '알 수 없는 옵션입니다.'],
    ]
    for (const [argv, message] of cases) {
      expect(parseArgs(argv), argv.join(' ')).toEqual({ kind: 'usage', message, command: 'search' })
    }
  })
})

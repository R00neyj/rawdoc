// F-2132 A9 (help.ts)
import { describe, expect, it } from 'vitest'
import { commandHelpText, helpText } from '../../../cli/src/help'

const USAGE: Record<string, string> = {
  login: '사용: rawdoc login [--force] [--with-token] [--no-browser]',
  ls: '사용: rawdoc ls [--folder <폴더id|경로> | --root | --shared] [--path]',
  find: '사용: rawdoc find <제목> [--folder <폴더id|경로> | --root] [--path]',
  search: '사용: rawdoc search <검색어> [--folder <폴더id|경로>]',
  get: '사용: rawdoc get <id> [-o <파일>]',
  new: '사용: rawdoc new [<파일>|-] [--title <제목>] [--folder <폴더id|경로>]',
  put: '사용: rawdoc put <id> [<파일>|-] [--title <제목>] (--base-version <n> | --force) [--dry-run]',
  mv: '사용: rawdoc mv <id> (--folder <폴더id|경로> | --root)',
  rm: '사용: rawdoc rm <id> --yes',
  mkdir: '사용: rawdoc mkdir <이름> [--parent <폴더id|경로>]',
  rmdir: '사용: rawdoc rmdir <폴더id> --yes [--all]',
}

describe('F-2132 A9 help.ts', () => {
  it('옵션이 있는 명령마다 사용 줄이 있다', () => {
    for (const [name, usage] of Object.entries(USAGE)) {
      expect(commandHelpText(name as 'ls'), name).toContain(usage)
    }
  })

  it('옵션 없는 명령은 한 줄 설명만', () => {
    for (const name of ['logout', 'whoami', 'info', 'folders', 'upload', 'link', 'syntax'] as const) {
      expect(commandHelpText(name).trimEnd().split('\n'), name).toHaveLength(1)
    }
  })

  it('전체 도움말 꼬리: help 안내가 PowerShell 줄 위, syntax 안내가 마지막', () => {
    const lines = helpText('0.3.3').trimEnd().split('\n')
    const help = lines.indexOf('명령별 옵션은 rawdoc help <명령> 또는 rawdoc <명령> --help 로 봅니다.')
    expect(help).toBeGreaterThan(0)
    expect(lines[help + 1]).toContain('Windows PowerShell')
    expect(lines[lines.length - 1]).toContain('rawdoc syntax')
  })

  it('put·mv 도움말에 위키링크 문장과 줄바꿈 안내', () => {
    expect(commandHelpText('put')).toContain('제목을 바꾸면 옛 제목으로 건 [[위키링크]] 는 자동으로 고쳐지지 않아 끊깁니다.')
    expect(commandHelpText('put')).toContain('서버 문서 방식으로 맞춰 저장됩니다.')
    expect(commandHelpText('mv')).toContain('[[폴더/문서 제목]] 처럼 폴더를 붙여 건 위키링크는 옮기면 끊길 수 있습니다.')
  })

  it('put 한 줄 설명에 --dry-run', () => {
    expect(helpText('0.3.3')).toContain('--dry-run 은 미리 보기. 자세히: put --help')
  })
})

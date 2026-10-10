// F-2021 U5·U6 (specs/features/F-2021.md 13.1, 4.5, 4.2)
import { describe, expect, it } from 'vitest'
import {
  CliError,
  errorMessage,
  errorToJson,
  exitCodeFor,
  humanAccountLine,
  humanDocInfo,
  humanDocList,
  humanFolderList,
  humanIdLine,
  humanIdVersionLine,
  humanRemoveDocLine,
  humanRemoveFolderNotice,
  humanReplaceList,
  humanReplaceSummary,
  humanReplaceWait,
  humanSearchList,
  humanSearchSummary,
  humanSharedList,
  humanUploadLine,
  humanUrlLine,
  isoUtcSeconds,
  remainingTimeText,
  replaceExitCode,
  replaceJson,
  stripControlChars,
  type CliErrorCode,
} from '../../../cli/src/output'

const CLI = 'rawdoc'
const CLI_ENV = 'RAWDOC'

describe('F-2021 U5 종료 코드', () => {
  const table: [CliErrorCode, number][] = [
    ['network', 1],
    ['timeout', 1],
    ['server_error', 1],
    ['bad_response', 1],
    ['file_read', 1],
    ['file_write', 1],
    ['not_utf8', 1],
    ['login_timeout', 1],
    ['login_denied', 1],
    ['login_port', 1],
    ['usage', 2],
    ['invalid', 2],
    ['not_logged_in', 3],
    ['unauthenticated', 3],
    ['forbidden', 4],
    ['not_found', 4],
    ['conflict', 5],
    ['locked', 6],
    ['too_large', 7],
    ['quota_exceeded', 7],
    ['rate_limited', 8],
    ['doc_quota_exceeded', 7],
    ['account_blocked', 4],
    ['e2ee_doc', 4],
    ['e2ee_folder', 4],
  ]
  it.each(table)('%s → %i', (code, expected) => {
    expect(exitCodeFor(code)).toBe(expected)
  })
})

describe('F-2021 U5 오류 문구', () => {
  it('not_logged_in 문구에 cli·CLI_TOKEN 이 들어간다', () => {
    const msg = errorMessage(new CliError('not_logged_in'), CLI, CLI_ENV)
    expect(msg).toContain('rawdoc login')
    expect(msg).toContain('RAWDOC_TOKEN')
  })

  it('conflict 문구에 currentVersion 이 두 번 들어간다', () => {
    const msg = errorMessage(new CliError('conflict', { currentVersion: 7 }), CLI, CLI_ENV)
    expect(msg).toBe('서버의 문서가 바뀌었습니다 (지금 버전 7). 다시 받아 고친 뒤 --base-version 7 으로 올리세요.')
  })

  it('locked 는 email 이 있으면 괄호에 넣고 없으면 뺀다', () => {
    const withEmail = errorMessage(new CliError('locked', { email: 'a@b.com' }), CLI, CLI_ENV)
    expect(withEmail).toContain('(a@b.com)')
    const without = errorMessage(new CliError('locked', {}), CLI, CLI_ENV)
    expect(without).not.toContain('(')
  })

  it('invalid 는 field 가 있으면 문구에 넣는다', () => {
    expect(errorMessage(new CliError('invalid', { field: 'title' }), CLI, CLI_ENV)).toContain('title')
    expect(errorMessage(new CliError('invalid', {}), CLI, CLI_ENV)).toBe('서버가 요청을 거절했습니다.')
  })
})

describe('F-2021 U5 --json 오류 모양', () => {
  it('409 는 currentVersion 만 담고 doc 은 없다', () => {
    const json = errorToJson(new CliError('conflict', { status: 409, currentVersion: 3 }), CLI, CLI_ENV)
    expect(json).toEqual({
      error: 'conflict',
      status: 409,
      message: expect.stringContaining('3'),
      currentVersion: 3,
    })
    expect('doc' in json).toBe(false)
  })

  it('요청 전 오류는 status 가 null', () => {
    const json = errorToJson(new CliError('network', { origin: 'https://rawdoc.app' }), CLI, CLI_ENV)
    expect(json.status).toBeNull()
  })

  it('423 은 email 없으면 그 필드를 담지 않는다', () => {
    const json = errorToJson(new CliError('locked', { status: 423 }), CLI, CLI_ENV)
    expect('email' in json).toBe(false)
    expect(json.message).not.toContain('(')
  })
})

describe('F-2021 U6 output.ts', () => {
  it('stripControlChars 는 제어 문자를 공백으로 바꾼다', () => {
    expect(stripControlChars('a\u0000b\u007Fc')).toBe('a b c')
  })

  it('isoUtcSeconds 는 초 단위 UTC', () => {
    expect(isoUtcSeconds(0)).toBe('1970-01-01T00:00:00Z')
  })

  it('humanDocList 는 탭 구분·제어 문자 제거, 빈 목록이면 빈 문자열', () => {
    expect(humanDocList([])).toBe('')
    const text = humanDocList([{ id: 'd1', updatedAt: 0, title: '제\u0000목' }])
    expect(text).toBe('d1\t1970-01-01T00:00:00Z\t제 목\n')
  })

  it('humanDocList 는 금고 문서의 빈 제목 자리에 (금고 문서) 를 찍는다', () => {
    expect(humanDocList([{ id: 'v1', updatedAt: 0, title: '', e2ee: true }])).toBe('v1\t1970-01-01T00:00:00Z\t(금고 문서)\n')
  })

  it('humanFolderList 는 경로 오름차순, 탭으로 id·경로를 잇는다', () => {
    const folders = [
      { id: 'top', name: '나', parentId: null },
      { id: 'sub', name: '가', parentId: 'top' },
      { id: 'other', name: '다', parentId: null },
    ]
    const text = humanFolderList(folders)
    const lines = text.trim().split('\n')
    expect(lines).toEqual(['top\t나', 'sub\t나/가', 'other\t다'])
  })

  it('나머지 줄 형식', () => {
    expect(humanAccountLine('a@b.com', 'https://rawdoc.app')).toBe('a@b.com\thttps://rawdoc.app\n')
    expect(humanIdLine('doc-1')).toBe('doc-1\n')
    expect(humanIdVersionLine('doc-1', 3)).toBe('doc-1\tversion 3\n')
    expect(humanUploadLine('![이미지](x)')).toBe('![이미지](x)\n')
    expect(humanUrlLine('https://rawdoc.app/#/p/x')).toBe('https://rawdoc.app/#/p/x\n')
  })
})

describe('F-2031 A2 rate_limited 문구 — 분당', () => {
  it('분당 문구는 retryAfter 초를 그대로 넣는다', () => {
    const msg = errorMessage(new CliError('rate_limited', { scope: 'minute', retryAfter: 60 }), CLI, CLI_ENV)
    expect(msg).toBe('요청이 너무 많습니다. 60초 뒤 다시 시도하세요.')
  })
})

describe('F-2031 A3 rate_limited 문구 — 하루', () => {
  it('limit 있음', () => {
    const msg = errorMessage(new CliError('rate_limited', { scope: 'day', limit: 5000, retryAfter: 32400 }), CLI, CLI_ENV)
    expect(msg).toBe('오늘 쓰기 한도(5000번)를 다 썼습니다. 약 9시간 뒤 풀립니다.')
  })

  it('limit 없음', () => {
    const msg = errorMessage(new CliError('rate_limited', { scope: 'day', retryAfter: 32400 }), CLI, CLI_ENV)
    expect(msg).toBe('오늘 쓰기 한도를 다 썼습니다. 약 9시간 뒤 풀립니다.')
  })
})

describe('F-2031 A4 남은 시간 문구', () => {
  const table: [number, string][] = [
    [1, '1분'],
    [30, '1분'],
    [60, '1분'],
    [61, '2분'],
    [3600, '1시간'],
    [3601, '1시간 1분'],
    [5000, '1시간 24분'],
    [32400, '9시간'],
    [86400, '24시간'],
  ]
  it.each(table)('retryAfter=%i → %s', (retryAfter, expected) => {
    expect(remainingTimeText(retryAfter)).toBe(expected)
  })
})

describe('F-2031 A5 doc_quota_exceeded·account_blocked 문구', () => {
  it('resource bytes', () => {
    const msg = errorMessage(new CliError('doc_quota_exceeded', { resource: 'bytes', used: 1, limit: 104857600 }), CLI, CLI_ENV)
    expect(msg).toBe('계정의 문서 저장 공간이 부족합니다 (1 / 104857600 바이트).')
  })

  it('resource docs', () => {
    const msg = errorMessage(new CliError('doc_quota_exceeded', { resource: 'docs', used: 10000, limit: 10000 }), CLI, CLI_ENV)
    expect(msg).toBe('문서 수가 한도에 이르렀습니다 (10000 / 10000개).')
  })

  it('account_blocked', () => {
    const msg = errorMessage(new CliError('account_blocked', {}), CLI, CLI_ENV)
    expect(msg).toBe('이 계정은 운영자가 쓰기를 막았습니다. 읽기만 할 수 있습니다.')
  })

  it('used 없는 bytes → 괄호째 뺀다', () => {
    const msg = errorMessage(new CliError('doc_quota_exceeded', { resource: 'bytes' }), CLI, CLI_ENV)
    expect(msg).toBe('계정의 문서 저장 공간이 부족합니다.')
  })

  it('limit 없는 docs → 괄호째 뺀다', () => {
    const msg = errorMessage(new CliError('doc_quota_exceeded', { resource: 'docs', used: 10000 }), CLI, CLI_ENV)
    expect(msg).toBe('문서 수가 한도에 이르렀습니다.')
  })
})

describe('F-2050 6.1 e2ee_doc·e2ee_folder 문구', () => {
  it('종료 코드 4 문구 둘', () => {
    expect(errorMessage(new CliError('e2ee_doc'), CLI, CLI_ENV)).toBe(
      '금고 문서는 명령줄 도구로 다룰 수 없습니다. 웹에서 하세요.',
    )
    expect(errorMessage(new CliError('e2ee_folder'), CLI, CLI_ENV)).toBe(
      '금고 폴더나 금고 문서가 걸려 있어 명령줄 도구로는 할 수 없습니다. 웹에서 하세요.',
    )
  })

  it('errorToJson 은 { error, status, message } 만', () => {
    const json = errorToJson(new CliError('e2ee_doc', { status: 403 }), CLI, CLI_ENV)
    expect(json).toEqual({ error: 'e2ee_doc', status: 403, message: expect.any(String) })
  })
})

describe('F-2050 5.2 humanSharedList — ls --shared 사람용', () => {
  it('두 원소(edit·view), 이메일에 탭 포함', () => {
    const docs = [
      { id: 'd1', updatedAt: 0, role: 'edit' as const, ownerEmail: 'a\tb@example.com', title: '제목1' },
      { id: 'd2', updatedAt: 60_000, role: 'view' as const, ownerEmail: 'c@example.com', title: '제목2' },
    ]
    const text = humanSharedList(docs)
    expect(text).toBe(
      'd1\t1970-01-01T00:00:00Z\t편집\ta b@example.com\t제목1\n' + 'd2\t1970-01-01T00:01:00Z\t보기\tc@example.com\t제목2\n',
    )
  })

  it('빈 목록이면 빈 문자열', () => {
    expect(humanSharedList([])).toBe('')
  })
})

describe('F-2050 5.2 humanRemoveDocLine', () => {
  it('문서를 지웠습니다: {title}', () => {
    expect(humanRemoveDocLine('내 문서')).toBe('문서를 지웠습니다: 내 문서\n')
  })
})

describe('F-2050 5.2 humanRemoveFolderNotice — rmdir 안내', () => {
  it('모든 조합', () => {
    expect(humanRemoveFolderNotice({ contents: 'move-up', docs: 3, folders: 0, parentId: 'p1' })).toBe(
      '폴더를 지웠습니다. 문서 3개는 위 폴더로 옮겼습니다.\n',
    )
    expect(humanRemoveFolderNotice({ contents: 'move-up', docs: 0, folders: 2, parentId: null })).toBe(
      '폴더를 지웠습니다. 폴더 2개는 맨 위로 옮겼습니다.\n',
    )
    expect(humanRemoveFolderNotice({ contents: 'move-up', docs: 2, folders: 1, parentId: 'p1' })).toBe(
      '폴더를 지웠습니다. 문서 2개와 폴더 1개는 위 폴더로 옮겼습니다.\n',
    )
    expect(humanRemoveFolderNotice({ contents: 'move-up', docs: 0, folders: 0, parentId: 'p1' })).toBe('폴더를 지웠습니다.\n')
    expect(humanRemoveFolderNotice({ contents: 'delete-all', docs: 4, folders: 3, parentId: null })).toBe(
      '폴더 3개와 문서 4개를 영구 삭제했습니다.\n',
    )
  })
})

describe('F-2031 A6 errorToJson — 새 코드', () => {
  it('rate_limited 분당, limit 있음', () => {
    const json = errorToJson(new CliError('rate_limited', { status: 429, scope: 'minute', limit: 120, retryAfter: 60 }), CLI, CLI_ENV)
    expect(json).toEqual({
      error: 'rate_limited',
      status: 429,
      message: '요청이 너무 많습니다. 60초 뒤 다시 시도하세요.',
      limit: 120,
      scope: 'minute',
      retryAfter: 60,
    })
  })

  it('rate_limited 분당, limit 없음(몸통 없음)', () => {
    const json = errorToJson(new CliError('rate_limited', { status: 429, scope: 'minute', retryAfter: 60 }), CLI, CLI_ENV)
    expect(json).toEqual({
      error: 'rate_limited',
      status: 429,
      message: '요청이 너무 많습니다. 60초 뒤 다시 시도하세요.',
      scope: 'minute',
      retryAfter: 60,
    })
  })

  it('rate_limited 하루', () => {
    const json = errorToJson(new CliError('rate_limited', { status: 429, scope: 'day', limit: 5000, retryAfter: 32400 }), CLI, CLI_ENV)
    expect(json).toEqual({
      error: 'rate_limited',
      status: 429,
      message: '오늘 쓰기 한도(5000번)를 다 썼습니다. 약 9시간 뒤 풀립니다.',
      limit: 5000,
      scope: 'day',
      retryAfter: 32400,
    })
  })

  it('doc_quota_exceeded', () => {
    const json = errorToJson(
      new CliError('doc_quota_exceeded', { status: 413, resource: 'docs', used: 10000, limit: 10000 }),
      CLI,
      CLI_ENV,
    )
    expect(json).toEqual({
      error: 'doc_quota_exceeded',
      status: 413,
      message: '문서 수가 한도에 이르렀습니다 (10000 / 10000개).',
      limit: 10000,
      used: 10000,
      resource: 'docs',
    })
  })

  it('account_blocked — scope·retryAfter·resource 키가 없다', () => {
    const json = errorToJson(new CliError('account_blocked', { status: 403 }), CLI, CLI_ENV)
    expect(json).toEqual({
      error: 'account_blocked',
      status: 403,
      message: '이 계정은 운영자가 쓰기를 막았습니다. 읽기만 할 수 있습니다.',
    })
    expect('scope' in json).toBe(false)
    expect('retryAfter' in json).toBe(false)
    expect('resource' in json).toBe(false)
  })
})

describe('F-2119 A4 경로 열·humanDocInfo', () => {
  const base = { lineEnding: 'lf' as const, pinnedAt: null, version: 3, createdAt: 0, updatedAt: 86400000 }

  it('path 가 없으면 기존 출력, 있으면 셋째 열 경로·넷째 열 제목', () => {
    const docs = [
      { id: 'a', title: '맨위', folderPath: [] as string[] | null, ...base },
      { id: 'b', title: '안', folderPath: ['가', '나\n다'], ...base },
      { id: 'c', title: '없음', folderPath: null, ...base },
      { id: 'd', title: '', e2ee: true as const, folderPath: [], ...base },
    ]
    expect(humanDocList(docs)).toBe(
      'a\t1970-01-02T00:00:00Z\t맨위\nb\t1970-01-02T00:00:00Z\t안\nc\t1970-01-02T00:00:00Z\t없음\nd\t1970-01-02T00:00:00Z\t(금고 문서)\n',
    )
    expect(humanDocList(docs, { path: true })).toBe(
      'a\t1970-01-02T00:00:00Z\t/\t맨위\nb\t1970-01-02T00:00:00Z\t가/나 다\t안\nc\t1970-01-02T00:00:00Z\t?\t없음\nd\t1970-01-02T00:00:00Z\t/\t(금고 문서)\n',
    )
  })

  it('humanDocInfo 키 순서', () => {
    const mine = humanDocInfo({ id: 'a', title: '제목', folderPath: ['가'], ...base, pinnedAt: 0 })
    expect(mine.split('\n').map((l) => l.split('\t')[0])).toEqual([
      'id', 'title', 'folder', 'version', 'updatedAt', 'createdAt', 'lineEnding', 'pinnedAt', 'e2ee', '',
    ])
    expect(mine).toContain('folder\t가\n')
    expect(mine).toContain('e2ee\tfalse\n')
    expect(mine).toContain('pinnedAt\t1970-01-01T00:00:00Z\n')
    const unpinned = humanDocInfo({ id: 'a', title: 't', folderPath: [], ...base, e2ee: true })
    expect(unpinned).toContain('folder\t/\n')
    expect(unpinned).toContain('pinnedAt\t-\n')
    expect(unpinned).toContain('e2ee\ttrue\n')
  })

  it('공유받은 문서는 folder - 와 role·ownerEmail', () => {
    const text = humanDocInfo({ id: 's', title: 't', folderPath: null, role: 'edit', ownerEmail: 'o@x.com', ...base })
    expect(text).toContain('folder\t-\n')
    expect(text.endsWith('role\t편집\nownerEmail\to@x.com\n')).toBe(true)
  })
})

describe('F-2132 A5 폴더 오류 문구', () => {
  const HINT = 'rawdoc folders 로 폴더 id 와 경로를 확인하세요.'
  it('invalid 의 field 가 folderId·parentId 면 안내가 붙고 다른 field 는 그대로', () => {
    for (const field of ['folderId', 'parentId']) {
      const err = new CliError('invalid', { field })
      expect(errorMessage(err, CLI, CLI_ENV)).toBe(`서버가 요청을 거절했습니다: ${field} 값이 올바르지 않습니다. ${HINT}`)
      expect(errorToJson(err, CLI, CLI_ENV).message).toContain(HINT)
    }
    expect(errorMessage(new CliError('invalid', { field: 'title' }), CLI, CLI_ENV)).toBe(
      '서버가 요청을 거절했습니다: title 값이 올바르지 않습니다.',
    )
  })

  it('folder_not_found: 문구·종료 2·Git Bash 문장·json folder', () => {
    const err = new CliError('folder_not_found', { folder: '수업/x\n' })
    expect(errorMessage(err, CLI, CLI_ENV)).toBe(`폴더를 찾을 수 없습니다: 수업/x . ${HINT}`)
    expect(exitCodeFor('folder_not_found')).toBe(2)
    const bash = new CliError('folder_not_found', { folder: 'C:/Program Files/Git/x' })
    expect(errorMessage(bash, CLI, CLI_ENV)).toContain('Git Bash 가 Windows 경로로 바꿉니다')
    expect(errorToJson(bash, CLI, CLI_ENV)).toMatchObject({ error: 'folder_not_found', status: null, folder: 'C:/Program Files/Git/x' })
  })

  it('folder_ambiguous: 문구·종료 2·json folderIds', () => {
    const err = new CliError('folder_ambiguous', { folder: 'a', folderIds: ['i1', 'i2'] })
    expect(errorMessage(err, CLI, CLI_ENV)).toBe('경로가 같은 폴더가 2개입니다: a (i1, i2). 폴더 id 로 지정하세요.')
    expect(exitCodeFor('folder_ambiguous')).toBe(2)
    expect(errorToJson(err, CLI, CLI_ENV)).toMatchObject({ folder: 'a', folderIds: ['i1', 'i2'] })
  })
})

describe('search 사람용 출력', () => {
  const hit = (id: string, folderPath: string[] | null, title: string, lines: { line: number; text: string }[], matchedLines: number) => ({
    id, title, folderId: null, version: 1, updatedAt: 0, folderPath, lines, matchedLines,
  })

  it('문서마다 id·경로/제목 한 줄, 그 아래 들여 쓴 매칭 줄, 더 있으면 외 N줄', () => {
    const docs = [
      hit('d1', [], '맨 위', [{ line: 12, text: 'the needle' }], 1),
      hit('d2', ['수업', '1주차'], '메모\t정리', [1, 2, 3, 4, 5].map((n) => ({ line: n, text: `n${n}\tx` })), 8),
      hit('d3', null, '제목만', [], 0),
    ]
    expect(humanSearchList(docs)).toBe(
      [
        'd1\t/맨 위',
        '  12: the needle',
        'd2\t수업/1주차/메모 정리',
        '  1: n1 x',
        '  2: n2 x',
        '  3: n3 x',
        '  4: n4 x',
        '  5: n5 x',
        '  … 외 3줄',
        'd3\t?/제목만',
        '',
      ].join('\n'),
    )
    expect(humanSearchList([])).toBe('')
  })

  it('합계 줄: 금고 문서는 M>0 일 때만, 넘치면 200개까지 안내, 0건은 find 와 같은 꼴', () => {
    const one = [hit('d1', [], 't', [], 0)]
    expect(humanSearchSummary({ docs: one, truncated: false, e2eeSkipped: 0 }, 'q')).toBe('문서 1개\n')
    expect(humanSearchSummary({ docs: one, truncated: false, e2eeSkipped: 2 }, 'q')).toBe('문서 1개, 금고 문서 2개는 찾지 못함\n')
    const many = Array.from({ length: 200 }, (_, i) => hit(`d${i}`, [], 't', [], 0))
    expect(humanSearchSummary({ docs: many, truncated: true, e2eeSkipped: 1 }, 'q')).toBe(
      '문서 200개 이상 (처음 200개만 보여 줍니다), 금고 문서 1개는 찾지 못함\n',
    )
    expect(humanSearchSummary({ docs: [], truncated: false, e2eeSkipped: 0 }, 'a\tb')).toBe('제목·본문에서 찾은 문서가 없습니다: a b\n')
    expect(humanSearchSummary({ docs: [], truncated: false, e2eeSkipped: 3 }, 'x')).toBe(
      '제목·본문에서 찾은 문서가 없습니다: x (금고 문서 3개는 찾지 못함)\n',
    )
  })
})

describe('replace 출력', () => {
  type Status = 'preview' | 'updated' | 'conflict' | 'too_large' | 'skipped' | 'error'
  const item = (id: string, folderPath: string[] | null, status: Status, extra: Record<string, unknown> = {}) => ({
    id, title: `t-${id}`, folderPath, count: 2 as number | null, status, lines: [], changedLines: 0, ...extra,
  })

  it('too_many_docs: 종료 2, 문구에 한도와 --folder', () => {
    expect(exitCodeFor('too_many_docs')).toBe(2)
    expect(errorMessage(new CliError('too_many_docs', { limit: 200 }), CLI, CLI_ENV)).toBe('대상 문서가 200개를 넘습니다. --folder 로 좁혀 주세요.')
  })

  it('미리 보기: 문서 머리에 곳 수, 바뀜 줄은 - 전 / + 후, 더 있으면 외 N줄', () => {
    const docs = [
      item('d1', ['수업'], 'preview', {
        count: 3,
        lines: [
          { line: 2, before: 'a foo', after: 'a bar' },
          { line: 5, before: 'foo\tx', after: 'bar\tx' },
        ],
        changedLines: 4,
      }),
      item('d2', [], 'preview', { count: 1, lines: [{ line: 1, before: 'foo', after: '' }], changedLines: 1 }),
    ]
    expect(humanReplaceList(docs, CLI, CLI_ENV)).toBe(
      [
        'd1\t수업/t-d1  (3곳)',
        '  - 2: a foo',
        '  + 2: a bar',
        '  - 5: foo x',
        '  + 5: bar x',
        '  … 외 2줄',
        'd2\t/t-d2  (1곳)',
        '  - 1: foo',
        '  + 1: ',
        '',
      ].join('\n'),
    )
  })

  it('적용 결과: 문서마다 한 줄', () => {
    const docs = [
      item('d1', [], 'updated', { version: 4 }),
      item('d2', [], 'conflict'),
      item('d3', null, 'too_large'),
      item('d4', [], 'skipped', { count: null }),
      item('d5', [], 'error', { failure: new CliError('not_found', { id: 'd5' }) }),
    ]
    expect(humanReplaceList(docs, CLI, CLI_ENV)).toBe(
      [
        'd1\t/t-d1  바꿈 2곳 → 판 4',
        'd2\t/t-d2  충돌 (그 사이 바뀌어 덮어쓰지 않음)',
        'd3\t?/t-d3  너무 큼 (바꾼 본문이 한도를 넘음)',
        'd4\t/t-d4  미처리',
        'd5\t/t-d5  오류: 찾을 수 없습니다. id 를 확인하세요: d5',
        '',
      ].join('\n'),
    )
  })

  it('합계 줄: 미리 보기는 --yes 안내, 적용은 결과별 수, 0건은 search 와 같은 꼴', () => {
    const preview = [item('d1', [], 'preview', { count: 3 }), item('d2', [], 'preview', { count: 1 })]
    expect(humanReplaceSummary({ applied: false, docs: preview, e2eeSkipped: 0 }, 'foo')).toBe('바꿀 곳: 문서 2개 4곳\n적용하려면 --yes 를 붙이세요.\n')
    expect(humanReplaceSummary({ applied: false, docs: preview, e2eeSkipped: 1 }, 'foo')).toBe(
      '바꿀 곳: 문서 2개 4곳, 금고 문서 1개는 바꾸지 못함\n적용하려면 --yes 를 붙이세요.\n',
    )
    const applied = [
      item('d1', [], 'updated', { version: 4 }),
      item('d2', [], 'updated', { version: 2, count: 5 }),
      item('d3', [], 'conflict'),
      item('d4', [], 'too_large'),
      item('d5', [], 'error'),
      item('d6', [], 'skipped', { count: null }),
    ]
    expect(humanReplaceSummary({ applied: true, docs: applied, e2eeSkipped: 2 }, 'foo')).toBe(
      '바꿈: 문서 2개 7곳, 충돌 1개, 너무 큼 1개, 오류 1개, 미처리 1개, 금고 문서 2개는 바꾸지 못함\n',
    )
    expect(humanReplaceSummary({ applied: true, docs: [item('d1', [], 'updated', { version: 4 })], e2eeSkipped: 0 }, 'foo')).toBe('바꿈: 문서 1개 2곳\n')
    expect(humanReplaceSummary({ applied: false, docs: [], e2eeSkipped: 0 }, 'a\tb')).toBe('바꿀 곳이 있는 문서가 없습니다: a b\n')
    expect(humanReplaceSummary({ applied: true, docs: [], e2eeSkipped: 3 }, 'x')).toBe('바꿀 곳이 있는 문서가 없습니다: x (금고 문서 3개는 바꾸지 못함)\n')
  })

  it('--json 모양: lines 는 빼고 version·error 는 있을 때만', () => {
    const docs = [
      item('d1', ['a'], 'updated', { version: 4, lines: [{ line: 1, before: 'x', after: 'y' }], changedLines: 1 }),
      item('d2', [], 'error', { failure: new CliError('not_found', { id: 'd2' }) }),
      item('d3', [], 'skipped', { count: null }),
    ]
    expect(replaceJson({ applied: true, docs, e2eeSkipped: 1 })).toEqual({
      applied: true,
      docs: [
        { id: 'd1', title: 't-d1', folderPath: ['a'], count: 2, status: 'updated', version: 4 },
        { id: 'd2', title: 't-d2', folderPath: [], count: 2, status: 'error', error: 'not_found' },
        { id: 'd3', title: 't-d3', folderPath: [], count: null, status: 'skipped' },
      ],
      e2eeSkipped: 1,
    })
  })

  it('종료 코드: 미리 보기·바꿈만이면 0, 하나라도 다르면 1', () => {
    expect(replaceExitCode([])).toBe(0)
    expect(replaceExitCode([item('d1', [], 'preview')])).toBe(0)
    expect(replaceExitCode([item('d1', [], 'updated')])).toBe(0)
    for (const s of ['conflict', 'too_large', 'skipped', 'error'] as const) {
      expect(replaceExitCode([item('d1', [], 'updated'), item('d2', [], s)]), s).toBe(1)
    }
  })

  it('기다림 안내 한 줄', () => {
    expect(humanReplaceWait(30)).toBe('쓰기 한도에 걸려 30초 기다렸다가 다시 씁니다.\n')
  })
})

// F-2021 U5·U6 (specs/features/F-2021.md 13.1, 4.5, 4.2)
import { describe, expect, it } from 'vitest'
import {
  CliError,
  errorMessage,
  errorToJson,
  exitCodeFor,
  humanAccountLine,
  humanDocList,
  humanFolderList,
  humanIdLine,
  humanIdVersionLine,
  humanUploadLine,
  humanUrlLine,
  isoUtcSeconds,
  stripControlChars,
  type CliErrorCode,
} from './output'

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
    expect(humanIdVersionLine('doc-1', 3)).toBe('doc-1\t3\n')
    expect(humanUploadLine('![이미지](x)')).toBe('![이미지](x)\n')
    expect(humanUrlLine('https://rawdoc.app/#/p/x')).toBe('https://rawdoc.app/#/p/x\n')
  })
})

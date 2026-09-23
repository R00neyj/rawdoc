// 사람용·--json 렌더링, 오류 → 종료 코드 (specs/features/F-2021.md 4.3~4.5)
import { folderAncestors, type FolderLike } from '../../src/lib/folderTree'

export type CliErrorCode =
  | 'network'
  | 'timeout'
  | 'server_error'
  | 'bad_response'
  | 'file_read'
  | 'file_write'
  | 'not_utf8'
  | 'login_timeout'
  | 'login_denied'
  | 'login_port'
  | 'usage'
  | 'invalid'
  | 'not_logged_in'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'locked'
  | 'too_large'
  | 'quota_exceeded'

export type CliErrorDetails = {
  status?: number | null
  origin?: string
  path?: string
  field?: string
  limit?: number
  used?: number
  email?: string
  expiresAt?: number
  currentVersion?: number
  id?: string
  usageMessage?: string
}

const EXIT_CODES: Record<CliErrorCode, number> = {
  network: 1,
  timeout: 1,
  server_error: 1,
  bad_response: 1,
  file_read: 1,
  file_write: 1,
  not_utf8: 1,
  login_timeout: 1,
  login_denied: 1,
  login_port: 1,
  usage: 2,
  invalid: 2,
  not_logged_in: 3,
  unauthenticated: 3,
  forbidden: 4,
  not_found: 4,
  conflict: 5,
  locked: 6,
  too_large: 7,
  quota_exceeded: 7,
}

export class CliError extends Error {
  code: CliErrorCode
  details: CliErrorDetails
  constructor(code: CliErrorCode, details: CliErrorDetails = {}) {
    super(code)
    this.code = code
    this.details = details
  }
}

export function exitCodeFor(code: CliErrorCode): number {
  return EXIT_CODES[code]
}

// 4.5 표의 한국어 문구
export function errorMessage(err: CliError, cli: string, cliEnvPrefix: string): string {
  const d = err.details
  switch (err.code) {
    case 'network':
      return `서버에 연결할 수 없습니다: ${d.origin ?? ''}`
    case 'timeout':
      return '서버가 60초 안에 응답하지 않았습니다.'
    case 'server_error':
      return `서버 오류가 났습니다 (${d.status}). 잠시 뒤 다시 시도하세요.`
    case 'bad_response':
      return `서버 응답을 해석하지 못했습니다 (${d.status}).`
    case 'file_read':
      return `파일을 읽을 수 없습니다: ${d.path}`
    case 'file_write':
      return `파일을 쓸 수 없습니다: ${d.path}`
    case 'not_utf8':
      return `UTF-8 텍스트 파일이 아닙니다: ${d.path}`
    case 'login_timeout':
      return '5분 안에 승인하지 않아 로그인을 멈췄습니다. 다시 실행하세요.'
    case 'login_denied':
      return '브라우저에서 로그인을 취소했습니다.'
    case 'login_port':
      return '로그인용 임시 포트를 열 수 없습니다.'
    case 'usage':
      return d.usageMessage ?? '사용법이 올바르지 않습니다.'
    case 'invalid':
      return d.field
        ? `서버가 요청을 거절했습니다: ${d.field} 값이 올바르지 않습니다.`
        : '서버가 요청을 거절했습니다.'
    case 'not_logged_in':
      return `로그인이 필요합니다. ${cli} login 을 실행하거나 ${cliEnvPrefix}_TOKEN 환경 변수를 설정하세요.`
    case 'unauthenticated':
      return `토큰이 올바르지 않거나 폐기됐습니다. ${cli} login --force 로 다시 로그인하세요.`
    case 'forbidden':
      return '이 문서를 고칠 권한이 없습니다.'
    case 'not_found':
      return `찾을 수 없습니다. id 를 확인하세요: ${d.id ?? ''}`
    case 'conflict':
      return `서버의 문서가 바뀌었습니다 (지금 버전 ${d.currentVersion}). 다시 받아 고친 뒤 --base-version ${d.currentVersion} 으로 올리세요.`
    case 'locked':
      return d.email
        ? `브라우저에서 편집 중인 문서라 고칠 수 없습니다 (${d.email}). 편집을 마친 뒤 다시 시도하세요.`
        : '브라우저에서 편집 중인 문서라 고칠 수 없습니다. 편집을 마친 뒤 다시 시도하세요.'
    case 'too_large':
      return `너무 큽니다 (한도 ${d.limit} 바이트).`
    case 'quota_exceeded':
      return `이미지 저장 공간이 부족합니다 (${d.used} / ${d.limit} 바이트).`
    default:
      return err.message
  }
}

export type CliErrorJson = {
  error: string
  status: number | null
  message: string
  field?: string
  limit?: number
  used?: number
  email?: string
  expiresAt?: number
  currentVersion?: number
}

export function errorToJson(err: CliError, cli: string, cliEnvPrefix: string): CliErrorJson {
  const d = err.details
  const json: CliErrorJson = {
    error: err.code,
    status: d.status ?? null,
    message: errorMessage(err, cli, cliEnvPrefix),
  }
  if (d.field !== undefined) json.field = d.field
  if (d.limit !== undefined) json.limit = d.limit
  if (d.used !== undefined) json.used = d.used
  if (d.email !== undefined) json.email = d.email
  if (d.expiresAt !== undefined) json.expiresAt = d.expiresAt
  if (d.currentVersion !== undefined) json.currentVersion = d.currentVersion
  return json
}

// {title}·{경로} 안의 제어 문자를 공백 하나로 바꾼다. --json 은 바꾸지 않는다 (4.2)
export function stripControlChars(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001F\u007F]/g, ' ')
}

// ISO 8601 UTC 초 단위 — 시간대에 따라 출력이 달라지지 않는다 (4.2)
export function isoUtcSeconds(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

type DocListItem = { id: string; updatedAt: number; title: string }

export function humanDocList(docs: DocListItem[]): string {
  return docs.map((d) => `${d.id}\t${isoUtcSeconds(d.updatedAt)}\t${stripControlChars(d.title)}\n`).join('')
}

type FolderListItem = FolderLike & { id: string }

export function humanFolderList(folders: FolderListItem[]): string {
  const byId = new Map(folders.map((f) => [f.id, f]))
  const rows = folders.map((f) => {
    const ids = folderAncestors(folders, f.id)
    const path = [...ids]
      .reverse()
      .map((id) => stripControlChars(byId.get(id)?.name ?? ''))
      .join('/')
    return { id: f.id, path }
  })
  rows.sort((a, b) => a.path.localeCompare(b.path, 'ko'))
  return rows.map((r) => `${r.id}\t${r.path}\n`).join('')
}

export function humanAccountLine(email: string, origin: string): string {
  return `${email}\t${origin}\n`
}

export function humanIdLine(id: string): string {
  return `${id}\n`
}

export function humanIdVersionLine(id: string, version: number): string {
  return `${id}\t${version}\n`
}

export function humanUploadLine(markdown: string): string {
  return `${markdown}\n`
}

export function humanUrlLine(url: string): string {
  return `${url}\n`
}

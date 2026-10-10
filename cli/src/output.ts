// 사람용·--json 렌더링, 오류 → 종료 코드 (specs/features/F-2021.md 4.3~4.5)
import type { FolderLike } from '../../src/lib/folderTree'
import { folderPathOf } from './docMeta'
import type { PutPreview } from './putPreview'

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
  | 'folder_not_found'
  | 'folder_ambiguous'
  | 'not_logged_in'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'locked'
  | 'too_large'
  | 'quota_exceeded'
  | 'rate_limited'
  | 'doc_quota_exceeded'
  | 'account_blocked'
  | 'e2ee_doc'
  | 'e2ee_folder'
  | 'too_many_docs'

export type CliErrorDetails = {
  status?: number | null
  origin?: string
  path?: string
  reason?: string
  field?: string
  folder?: string
  folderIds?: string[]
  limit?: number
  used?: number
  email?: string
  expiresAt?: number
  currentVersion?: number
  id?: string
  usageMessage?: string
  scope?: 'minute' | 'day'
  retryAfter?: number
  resource?: 'bytes' | 'docs'
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
  folder_not_found: 2,
  folder_ambiguous: 2,
  not_logged_in: 3,
  unauthenticated: 3,
  forbidden: 4,
  not_found: 4,
  conflict: 5,
  locked: 6,
  too_large: 7,
  quota_exceeded: 7,
  rate_limited: 8,
  doc_quota_exceeded: 7,
  account_blocked: 4,
  e2ee_doc: 4,
  e2ee_folder: 4,
  too_many_docs: 2,
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

// 3.3 — retryAfter(초) → "{h}시간 {m}분" 모양. 0 인 자리는 뺀다
export function remainingTimeText(retryAfterSeconds: number): string {
  const totalMinutes = Math.max(1, Math.ceil(retryAfterSeconds / 60))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours > 0 && minutes > 0) return `${hours}시간 ${minutes}분`
  if (hours > 0) return `${hours}시간`
  return `${minutes}분`
}

const folderHint = (cli: string) => `${cli} folders 로 폴더 id 와 경로를 확인하세요.`

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
    case 'file_read': {
      // local:// 같은 다른 도구 전용 주소는 파일 경로가 아니다 — 표준 입력으로 넘기면 된다
      const hint = /^[a-z][a-z0-9+.-]*:\/\//i.test(d.path ?? '') ? ' 파일 경로가 아니라면 내용을 - (표준 입력)으로 넘기세요.' : ''
      if (d.reason === 'ENOENT') return `파일이 없습니다: ${d.path}.${hint}`
      if (d.reason === 'EACCES' || d.reason === 'EPERM') return `파일을 읽을 권한이 없습니다: ${d.path}`
      if (d.reason === 'EISDIR') return `파일이 아니라 폴더입니다: ${d.path}`
      return `파일을 읽을 수 없습니다: ${d.path}${d.reason ? ` (${d.reason})` : ''}`
    }
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
    case 'invalid': {
      if (!d.field) return '서버가 요청을 거절했습니다.'
      const base = `서버가 요청을 거절했습니다: ${d.field} 값이 올바르지 않습니다.`
      return d.field === 'folderId' || d.field === 'parentId' ? `${base} ${folderHint(cli)}` : base
    }
    case 'folder_not_found': {
      const raw = d.folder ?? ''
      const bash = /^[A-Za-z]:\//.test(raw) ? ' / 로 시작하는 값은 Git Bash 가 Windows 경로로 바꿉니다. 앞의 / 를 빼고 다시 실행하세요.' : ''
      return `폴더를 찾을 수 없습니다: ${stripControlChars(raw)}. ${folderHint(cli)}${bash}`
    }
    case 'folder_ambiguous': {
      const ids = d.folderIds ?? []
      return `경로가 같은 폴더가 ${ids.length}개입니다: ${stripControlChars(d.folder ?? '')} (${ids.join(', ')}). 폴더 id 로 지정하세요.`
    }
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
    case 'rate_limited': {
      const retryAfter = d.retryAfter ?? 60
      if (d.scope === 'day') {
        const remaining = remainingTimeText(retryAfter)
        return d.limit !== undefined
          ? `오늘 쓰기 한도(${d.limit}번)를 다 썼습니다. 약 ${remaining} 뒤 풀립니다.`
          : `오늘 쓰기 한도를 다 썼습니다. 약 ${remaining} 뒤 풀립니다.`
      }
      return `요청이 너무 많습니다. ${retryAfter}초 뒤 다시 시도하세요.`
    }
    case 'doc_quota_exceeded': {
      const hasCounts = typeof d.used === 'number' && typeof d.limit === 'number'
      if (d.resource === 'docs') {
        return hasCounts ? `문서 수가 한도에 이르렀습니다 (${d.used} / ${d.limit}개).` : '문서 수가 한도에 이르렀습니다.'
      }
      return hasCounts
        ? `계정의 문서 저장 공간이 부족합니다 (${d.used} / ${d.limit} 바이트).`
        : '계정의 문서 저장 공간이 부족합니다.'
    }
    case 'account_blocked':
      return '이 계정은 운영자가 쓰기를 막았습니다. 읽기만 할 수 있습니다.'
    case 'e2ee_doc':
      return '금고 문서는 명령줄 도구로 다룰 수 없습니다. 웹에서 하세요.'
    case 'e2ee_folder':
      return '금고 폴더나 금고 문서가 걸려 있어 명령줄 도구로는 할 수 없습니다. 웹에서 하세요.'
    case 'too_many_docs':
      return `대상 문서가 ${d.limit}개를 넘습니다. --folder 로 좁혀 주세요.`
    default:
      return err.message
  }
}

export type CliErrorJson = {
  error: string
  status: number | null
  message: string
  field?: string
  folder?: string
  folderIds?: string[]
  limit?: number
  used?: number
  email?: string
  expiresAt?: number
  currentVersion?: number
  scope?: 'minute' | 'day'
  retryAfter?: number
  resource?: 'bytes' | 'docs'
}

export function errorToJson(err: CliError, cli: string, cliEnvPrefix: string): CliErrorJson {
  const d = err.details
  const json: CliErrorJson = {
    error: err.code,
    status: d.status ?? null,
    message: errorMessage(err, cli, cliEnvPrefix),
  }
  if (d.field !== undefined) json.field = d.field
  if (d.folder !== undefined) json.folder = d.folder
  if (d.folderIds !== undefined) json.folderIds = d.folderIds
  if (d.limit !== undefined) json.limit = d.limit
  if (d.used !== undefined) json.used = d.used
  if (d.email !== undefined) json.email = d.email
  if (d.expiresAt !== undefined) json.expiresAt = d.expiresAt
  if (d.currentVersion !== undefined) json.currentVersion = d.currentVersion
  if (d.scope !== undefined) json.scope = d.scope
  if (d.retryAfter !== undefined) json.retryAfter = d.retryAfter
  if (d.resource !== undefined) json.resource = d.resource
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

type DocListItem = { id: string; updatedAt: number; title: string; e2ee?: true; folderPath?: string[] | null }

// 금고 문서는 서버가 제목을 빈 문자열로 준다 — 빈칸 대신 표시를 찍는다
const E2EE_TITLE = '(금고 문서)'

// 맨 위 문서는 /, 목록에 없는 폴더는 ? (F-2119 5.1)
function folderPathText(path: string[] | null | undefined): string {
  if (path === null || path === undefined) return '?'
  return path.length === 0 ? '/' : path.map(stripControlChars).join('/')
}

export function humanDocList(docs: DocListItem[], opts: { path?: boolean } = {}): string {
  return docs
    .map((d) => {
      const title = d.e2ee ? E2EE_TITLE : stripControlChars(d.title)
      const pathCell = opts.path ? `${folderPathText(d.folderPath)}\t` : ''
      return `${d.id}\t${isoUtcSeconds(d.updatedAt)}\t${pathCell}${title}\n`
    })
    .join('')
}

type SearchListItem = { id: string; title: string; folderPath: string[] | null; lines: { line: number; text: string }[]; matchedLines: number }

// 머리 줄 — 맨 위 문서는 /제목, 목록에 없는 폴더는 ?/제목
function docHeadText(d: { id: string; title: string; folderPath: string[] | null }): string {
  const path = folderPathText(d.folderPath)
  return `${d.id}\t${path === '/' ? '' : path}/${stripControlChars(d.title)}`
}

export function humanSearchList(docs: SearchListItem[]): string {
  return docs
    .map((d) => {
      const rows = d.lines.map((l) => `  ${l.line}: ${stripControlChars(l.text)}\n`).join('')
      const more = d.matchedLines > d.lines.length ? `  … 외 ${d.matchedLines - d.lines.length}줄\n` : ''
      return `${docHeadText(d)}\n${rows}${more}`
    })
    .join('')
}

// 표준 오류로 가는 끝 줄 — 0건 문구는 find 와 같은 꼴
export function humanSearchSummary(result: { docs: unknown[]; truncated: boolean; e2eeSkipped: number }, query: string): string {
  const n = result.docs.length
  const vault = result.e2eeSkipped > 0 ? `금고 문서 ${result.e2eeSkipped}개는 찾지 못함` : ''
  if (n === 0) return `제목·본문에서 찾은 문서가 없습니다: ${stripControlChars(query)}${vault ? ` (${vault})` : ''}\n`
  const count = result.truncated ? `문서 ${n}개 이상 (처음 ${n}개만 보여 줍니다)` : `문서 ${n}개`
  return `${count}${vault ? `, ${vault}` : ''}\n`
}

export type ReplaceStatus = 'preview' | 'updated' | 'conflict' | 'too_large' | 'skipped' | 'error'

// count 는 본문을 읽지 못한 미처리 문서만 null. failure 는 status 가 error 일 때
export type ReplaceListItem = {
  id: string
  title: string
  folderPath: string[] | null
  count: number | null
  status: ReplaceStatus
  version?: number
  failure?: CliError
  lines: { line: number; before: string; after: string }[]
  changedLines: number
}

type ReplaceResultLike = { applied: boolean; docs: ReplaceListItem[]; e2eeSkipped: number }

function replaceStatusText(d: ReplaceListItem, cli: string, cliEnvPrefix: string): string {
  switch (d.status) {
    case 'updated':
      return `바꿈 ${d.count}곳 → 판 ${d.version}`
    case 'conflict':
      return '충돌 (그 사이 바뀌어 덮어쓰지 않음)'
    case 'too_large':
      return '너무 큼 (바꾼 본문이 한도를 넘음)'
    case 'skipped':
      return '미처리'
    default:
      return `오류: ${d.failure ? errorMessage(d.failure, cli, cliEnvPrefix) : ''}`
  }
}

export function humanReplaceList(docs: ReplaceListItem[], cli: string, cliEnvPrefix: string): string {
  return docs
    .map((d) => {
      if (d.status !== 'preview') return `${docHeadText(d)}  ${replaceStatusText(d, cli, cliEnvPrefix)}\n`
      const rows = d.lines
        .map((l) => `  - ${l.line}: ${stripControlChars(l.before)}\n  + ${l.line}: ${stripControlChars(l.after)}\n`)
        .join('')
      const more = d.changedLines > d.lines.length ? `  … 외 ${d.changedLines - d.lines.length}줄\n` : ''
      return `${docHeadText(d)}  (${d.count}곳)\n${rows}${more}`
    })
    .join('')
}

const REPLACE_TALLY: Array<[ReplaceStatus, string]> = [
  ['conflict', '충돌'],
  ['too_large', '너무 큼'],
  ['error', '오류'],
  ['skipped', '미처리'],
]

// 표준 오류로 가는 합계 — 0건 문구는 search 와 같은 꼴
export function humanReplaceSummary(result: ReplaceResultLike, find: string): string {
  const vault = result.e2eeSkipped > 0 ? `금고 문서 ${result.e2eeSkipped}개는 바꾸지 못함` : ''
  if (result.docs.length === 0) return `바꿀 곳이 있는 문서가 없습니다: ${stripControlChars(find)}${vault ? ` (${vault})` : ''}\n`
  const done = result.docs.filter((d) => d.status === (result.applied ? 'updated' : 'preview'))
  const places = done.reduce((n, d) => n + (d.count ?? 0), 0)
  const parts = [`${result.applied ? '바꿈' : '바꿀 곳'}: 문서 ${done.length}개 ${places}곳`]
  for (const [status, label] of REPLACE_TALLY) {
    const n = result.docs.filter((d) => d.status === status).length
    if (n > 0) parts.push(`${label} ${n}개`)
  }
  if (vault) parts.push(vault)
  return `${parts.join(', ')}\n${result.applied ? '' : '적용하려면 --yes 를 붙이세요.\n'}`
}

export function replaceJson(result: ReplaceResultLike) {
  return {
    applied: result.applied,
    docs: result.docs.map((d) => ({
      id: d.id,
      title: d.title,
      folderPath: d.folderPath,
      count: d.count,
      status: d.status,
      ...(d.version !== undefined ? { version: d.version } : {}),
      ...(d.failure ? { error: d.failure.code } : {}),
    })),
    e2eeSkipped: result.e2eeSkipped,
  }
}

export function replaceExitCode(docs: ReplaceListItem[]): number {
  return docs.every((d) => d.status === 'preview' || d.status === 'updated') ? 0 : 1
}

export function humanReplaceWait(seconds: number): string {
  return `쓰기 한도에 걸려 ${seconds}초 기다렸다가 다시 씁니다.\n`
}

type FolderListItem = FolderLike & { id: string }

export function humanFolderList(folders: FolderListItem[]): string {
  const rows = folders.map((f) => ({ id: f.id, path: (folderPathOf(folders, f.id) ?? []).map(stripControlChars).join('/') }))
  rows.sort((a, b) => a.path.localeCompare(b.path, 'ko'))
  return rows.map((r) => `${r.id}\t${r.path}\n`).join('')
}

type DocInfoItem = {
  id: string
  title: string
  version: number
  updatedAt: number
  createdAt: number
  lineEnding: 'crlf' | 'lf'
  pinnedAt: number | null
  e2ee?: true
  folderPath: string[] | null
  role?: 'edit' | 'view'
  ownerEmail?: string
}

// 키는 --json 필드 이름과 같다 (F-2119 5.3)
export function humanDocInfo(d: DocInfoItem): string {
  const shared = d.role !== undefined
  const rows: Array<[string, string]> = [
    ['id', d.id],
    ['title', d.e2ee ? E2EE_TITLE : stripControlChars(d.title)],
    ['folder', shared ? '-' : folderPathText(d.folderPath)],
    ['version', String(d.version)],
    ['updatedAt', isoUtcSeconds(d.updatedAt)],
    ['createdAt', isoUtcSeconds(d.createdAt)],
    ['lineEnding', d.lineEnding],
    ['pinnedAt', d.pinnedAt === null ? '-' : isoUtcSeconds(d.pinnedAt)],
    ['e2ee', d.e2ee ? 'true' : 'false'],
  ]
  if (d.role !== undefined) rows.push(['role', ROLE_LABEL[d.role]])
  if (d.ownerEmail !== undefined) rows.push(['ownerEmail', stripControlChars(d.ownerEmail)])
  return rows.map(([k, v]) => `${k}\t${v}\n`).join('')
}

export function humanAccountLine(email: string, origin: string): string {
  return `${email}\t${origin}\n`
}

export function humanIdLine(id: string): string {
  return `${id}\n`
}

export function docAppUrl(origin: string, id: string): string {
  return `${origin}/#/d/${encodeURIComponent(id)}`
}

export function humanIdVersionLine(id: string, version: number): string {
  return `${id}\tversion ${version}\n`
}

export function humanUploadLine(markdown: string): string {
  return `${markdown}\n`
}

export function humanUrlLine(url: string): string {
  return `${url}\n`
}

const ROLE_LABEL: Record<'edit' | 'view', string> = { edit: '편집', view: '보기' } // 웹과 같은 낱말 (F-2050 5.2)

type SharedDocListItem = { id: string; updatedAt: number; role: 'edit' | 'view'; ownerEmail: string; title: string }

export function humanSharedList(docs: SharedDocListItem[]): string {
  return docs
    .map(
      (d) =>
        `${d.id}\t${isoUtcSeconds(d.updatedAt)}\t${ROLE_LABEL[d.role]}\t${stripControlChars(d.ownerEmail)}\t${stripControlChars(d.title)}\n`,
    )
    .join('')
}

export function humanRemoveDocLine(title: string): string {
  return `문서를 지웠습니다: ${stripControlChars(title)}\n`
}

function removedItemsPhrase(docs: number, folders: number): string {
  if (docs > 0 && folders > 0) return `문서 ${docs}개와 폴더 ${folders}개`
  if (docs > 0) return `문서 ${docs}개`
  return `폴더 ${folders}개`
}

type RemoveFolderResult = { contents: 'move-up' | 'delete-all'; docs: number; folders: number; parentId: string | null }

export function humanRemoveFolderNotice(result: RemoveFolderResult): string {
  if (result.contents === 'delete-all') {
    return `폴더 ${result.folders}개와 문서 ${result.docs}개를 영구 삭제했습니다.\n`
  }
  if (result.docs === 0 && result.folders === 0) return '폴더를 지웠습니다.\n'
  const where = result.parentId === null ? '맨 위' : '위 폴더'
  return `폴더를 지웠습니다. ${removedItemsPhrase(result.docs, result.folders)}는 ${where}로 옮겼습니다.\n`
}

// 키는 --json 필드 이름과 같고 dryRun 은 뺀다 (F-2132 4.3)
export function humanPutPreview(p: PutPreview): string {
  const rows: Array<[string, string | number | boolean | null]> = [
    ['id', p.id],
    ['version', p.version],
    ['lineEnding', p.lineEnding],
    ['fileLineEnding', p.fileLineEnding],
    ['titleChanged', p.titleChanged],
    ['contentChanged', p.contentChanged],
    ['linesAdded', p.linesAdded],
    ['linesRemoved', p.linesRemoved],
    ['firstChangedLine', p.firstChangedLine],
  ]
  return rows.map(([k, v]) => `${k}\t${v === null ? '-' : String(v)}\n`).join('')
}

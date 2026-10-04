// GitHub 파일 → 연결된 새 문서. 의존을 받아 DOM 없이 돈다 (specs/features/F-2128.md 4.4)
import { decodeMarkdown } from '../lib/decodeMarkdown'
import type { GithubFile, GithubLink, GithubLinkPut } from '../lib/githubContract'
import type { Doc, LineEnding } from '../types'
import type { GithubResult } from './githubApi'
import { decodeGithubContent, githubDocTitle, githubErrorMessage, GITHUB_TOO_LARGE_MESSAGE } from './githubUi'
import { MAX_CONTENT_BYTES } from './importWorkspace'

type Notice = { type: 'info' | 'error'; message: string }
export type GithubImportDeps = {
  postFile: (p: { repo: string; branch: string; path: string }) => Promise<GithubResult<GithubFile>>
  create: (input: { title: string; content: string; lineEnding: LineEnding; folderId: null }) => Promise<Doc>
  flushOutbox: () => Promise<void>
  hasPendingChanges: (id: string) => Promise<boolean>
  putLink: (id: string, put: GithubLinkPut) => Promise<GithubResult<GithubLink>>
  remove: (id: string) => Promise<void>
  open: (docId: string, created: Doc | null) => void
  notify: (n: Notice) => void
}
export type GithubImportResult = 'opened-existing' | 'imported' | 'failed'

const ERROR_PREFIX = '가져오지 못했습니다.'
const UNAVAILABLE = { status: 0, error: null, body: null }

export async function runGithubImport(file: { repo: string; branch: string; path: string; size: number }, deps: GithubImportDeps): Promise<GithubImportResult> {
  const fail = (message: string): GithubImportResult => {
    deps.notify({ type: 'error', message })
    return 'failed'
  }
  const name = file.path.split('/').pop() ?? file.path
  if (file.size > MAX_CONTENT_BYTES + 3) return fail(GITHUB_TOO_LARGE_MESSAGE)
  const got = await deps.postFile({ repo: file.repo, branch: file.branch, path: file.path })
  if (!got.ok) return fail(githubErrorMessage(got))
  if (got.value.linkedDocId) {
    deps.open(got.value.linkedDocId, null)
    deps.notify({ type: 'info', message: '이미 이 GitHub 파일에 연결된 문서를 열었습니다' })
    return 'opened-existing'
  }

  let decoded
  try {
    decoded = decodeMarkdown(decodeGithubContent(got.value.content))
  } catch (err) {
    if (err instanceof Error && err.message === 'not-utf8') return fail(`"${name}" 을(를) 가져오지 못했습니다. UTF-8 텍스트 파일이 아닙니다.`)
    return fail(githubErrorMessage(UNAVAILABLE))
  }
  if (new TextEncoder().encode(decoded.text).length > MAX_CONTENT_BYTES) return fail(GITHUB_TOO_LARGE_MESSAGE)

  let doc: Doc
  try {
    doc = await deps.create({ title: githubDocTitle(file.path), content: decoded.text, lineEnding: decoded.lineEnding, folderId: null })
  } catch {
    return fail(`${ERROR_PREFIX} 잠시 뒤에 다시 해 주세요`)
  }

  let reason: string | null = null
  try {
    await deps.flushOutbox()
    if (await deps.hasPendingChanges(doc.id)) reason = '잠시 뒤에 다시 해 주세요'
  } catch {
    reason = '잠시 뒤에 다시 해 주세요'
  }
  if (reason === null) {
    const put = await deps.putLink(doc.id, { repo: file.repo, branch: file.branch, path: file.path, sha: got.value.sha, bom: decoded.hadBom })
    if (put.ok) {
      deps.open(doc.id, doc)
      let message = `"${name}" 을(를) GitHub에서 가져왔습니다.`
      if (decoded.mixed) message += ' 줄바꿈 형식이 섞여 있어 CRLF 로 통일했습니다.'
      deps.notify({ type: 'info', message })
      return 'imported'
    }
    reason = githubErrorMessage(put)
  }
  await deps.remove(doc.id).catch(() => undefined)
  return fail(`${ERROR_PREFIX} ${reason}`)
}

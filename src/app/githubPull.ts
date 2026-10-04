// 당기기 원격 해독·안내 문구·크기 판정 — 본 번들 쪽, @codemirror/merge 를 쓰지 않는다 (specs/features/F-2129.md 3.2)
import { decodeMarkdown } from '../lib/decodeMarkdown'
import { fromEditorText, toEditorText, type LineEnding } from '../lib/lineEnding'
import { decodeGithubContent, githubErrorMessage, type GithubFailure } from './githubUi'
import { MAX_CONTENT_BYTES } from './importWorkspace'

export type PulledText = { text: string; hadBom: boolean; lineEnding: LineEnding; mixed: boolean; hasBreak: boolean }

export const PULL_OFFLINE_MESSAGE = '온라인일 때 당길 수 있습니다'

export function readPulled(content: string): PulledText | { error: 'not-utf8' | 'unreadable' } {
  let bytes: Uint8Array
  try {
    bytes = decodeGithubContent(content)
  } catch {
    return { error: 'unreadable' }
  }
  try {
    const d = decodeMarkdown(bytes)
    return { text: toEditorText(d.text), hadBom: d.hadBom, lineEnding: d.lineEnding, mixed: d.mixed, hasBreak: /[\r\n]/.test(d.text) }
  } catch (err) {
    return { error: err instanceof Error && err.message === 'not-utf8' ? 'not-utf8' : 'unreadable' }
  }
}

const endingName = (e: LineEnding) => (e === 'lf' ? 'LF' : 'CRLF')

function lineEndingDiff(remote: PulledText, doc: LineEnding): string | null {
  if (!remote.hasBreak) return null
  if (!remote.mixed && remote.lineEnding === doc) return null
  return `(GitHub ${remote.mixed ? '섞임' : endingName(remote.lineEnding)}, 이 문서 ${endingName(doc)}). 푸시하면 이 문서 형식으로 올라갑니다`
}

export function lineEndingNote(remote: PulledText, doc: LineEnding): string | null {
  const tail = lineEndingDiff(remote, doc)
  return tail === null ? null : `줄바꿈이 다릅니다 ${tail}`
}

const NOTE_PREFIX = '줄바꿈이 다릅니다 '

export function sameNotice(note: string | null): string {
  if (note === null) return 'GitHub 파일과 같습니다'
  return `GitHub 파일과 같습니다. 줄바꿈만 다릅니다 ${note.startsWith(NOTE_PREFIX) ? note.slice(NOTE_PREFIX.length) : note}`
}

export function pullFailureMessage(r: GithubFailure, link: { remoteSha: string | null }): string {
  if (r.status === 404 && r.error === 'github_not_found' && link.remoteSha === null) return 'GitHub에 아직 파일이 없습니다. 첫 푸시가 만듭니다'
  return githubErrorMessage(r)
}

export function mergedTooLarge(result: string, doc: LineEnding): boolean {
  return new TextEncoder().encode(fromEditorText(result, doc)).length > MAX_CONTENT_BYTES
}

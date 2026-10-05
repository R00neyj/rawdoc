// put 미리 보기·줄바꿈 안내 순수 함수 (specs/features/F-2132.md 3·4장)
import { fromEditorText, toEditorText, type LineEnding } from '../../src/lib/lineEnding'

export type PutPreview = {
  dryRun: true
  id: string
  version: number
  lineEnding: LineEnding
  fileLineEnding: LineEnding | null
  titleChanged: boolean
  contentChanged: boolean
  linesAdded: number
  linesRemoved: number
  firstChangedLine: number | null
}

export type PreviewServerDoc = { id: string; title: string; content: string; version: number; lineEnding: LineEnding }
export type PreviewFile = { text: string; lineEnding: LineEnding }

const HAS_NEWLINE = /[\r\n]/

export function fileLineEndingOf(file: PreviewFile | null): LineEnding | null {
  return file !== null && HAS_NEWLINE.test(file.text) ? file.lineEnding : null
}

function lineSummary(oldText: string, newText: string): { added: number; removed: number; first: number | null } {
  const oldLines = toEditorText(oldText).split('\n')
  const newLines = toEditorText(newText).split('\n')
  const counts = new Map<string, number>()
  for (const l of oldLines) counts.set(l, (counts.get(l) ?? 0) + 1)
  let added = 0
  for (const l of newLines) {
    const n = counts.get(l) ?? 0
    if (n > 0) counts.set(l, n - 1)
    else added++
  }
  let removed = 0
  for (const n of counts.values()) removed += n
  let first: number | null = null
  const min = Math.min(oldLines.length, newLines.length)
  for (let i = 0; i < min && first === null; i++) if (oldLines[i] !== newLines[i]) first = i + 1
  if (first === null && oldLines.length !== newLines.length) first = min + 1
  return { added, removed, first }
}

export function buildPutPreview(input: { server: PreviewServerDoc; file: PreviewFile | null; title: string | undefined }): PutPreview {
  const { server, file, title } = input
  const stored = file === null ? server.content : fromEditorText(toEditorText(file.text), server.lineEnding)
  const contentChanged = stored !== server.content
  const lines = contentChanged ? lineSummary(server.content, stored) : { added: 0, removed: 0, first: null }
  return {
    dryRun: true,
    id: server.id,
    version: server.version,
    lineEnding: server.lineEnding,
    fileLineEnding: fileLineEndingOf(file),
    titleChanged: title !== undefined && title !== server.title,
    contentChanged,
    linesAdded: lines.added,
    linesRemoved: lines.removed,
    firstChangedLine: lines.first,
  }
}

// 서버 409 와 같은 조건 — 판이 달라도 바뀌는 것이 없으면 충돌이 아니다
export function wouldConflict(baseVersion: number | null, preview: PutPreview): boolean {
  return baseVersion !== null && baseVersion !== preview.version && (preview.titleChanged || preview.contentChanged)
}

const LABEL: Record<LineEnding, string> = { lf: 'LF', crlf: 'CRLF' }

export function lineEndingNotice(label: string, fileEnding: LineEnding | null, serverEnding: LineEnding, dryRun: boolean): string | null {
  if (fileEnding === null || fileEnding === serverEnding) return null
  const head = `"${label}" 줄바꿈(${LABEL[fileEnding]})이 서버 문서(${LABEL[serverEnding]})와 달라 서버 문서에 맞춰 `
  return `${head}${dryRun ? '저장됩니다.' : '저장했습니다.'}\n`
}

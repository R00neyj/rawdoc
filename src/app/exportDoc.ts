// .md·.txt 내보내기 (specs/features/F-112.md 2.2, F-158.md 2.3, F-278.md 4·5장, specs/ia.md 3.8)
import { zipSync } from 'fflate'

import { toFileName } from '../lib/filename'
import { extractAttachmentRefs } from '../lib/imageBlock'
import { toPlainText } from '../viewer/toPlainText'
import type { LineEnding } from '../types'
import type { Notice } from './notice'

type AttachmentRecord = { id: string; ext: string; blob: { arrayBuffer(): Promise<ArrayBuffer> } }
type ExportStore = { getAttachment?(id: string): Promise<AttachmentRecord | null> }
type EditorHandle = { getText(lineEnding: LineEnding): string }
type ExportDocInfo = { title: string }
type Saver = { flush?(): void }

// F-281 이 이 함수를 그대로 가져다 쓴다 — 사본을 새로 두지 않는다 (F-278.md 2장)
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

// 다운로드 바이트만 계산하는 순수 부분 — DOM 없이 단위 테스트할 수 있게 뗐다 (F-158.md 6장 A1)
export async function buildExportPayload({
  text,
  title,
  store,
}: {
  text: string
  title: string
  store: ExportStore | null | undefined
}): Promise<{ kind: 'md' | 'zip'; filename: string; bytes: Uint8Array<ArrayBuffer>; missingCount: number }> {
  const mdName = toFileName(title)
  const ids = [...extractAttachmentRefs(text)]

  if (ids.length === 0 || !store?.getAttachment) {
    return { kind: 'md', filename: mdName, bytes: new TextEncoder().encode(text), missingCount: 0 }
  }

  const records = await Promise.all(ids.map((id) => store.getAttachment!(id)))
  const found = records.filter((r): r is AttachmentRecord => Boolean(r))
  const missingCount = records.length - found.length

  if (found.length === 0) {
    return { kind: 'md', filename: mdName, bytes: new TextEncoder().encode(text), missingCount }
  }

  const zipData: Record<string, Uint8Array> = { [mdName]: new TextEncoder().encode(text) }
  for (const record of found) {
    const bytes = new Uint8Array(await record.blob.arrayBuffer())
    zipData[`attachments/${record.id}.${record.ext}`] = bytes
  }
  const zipped = zipSync(zipData, { level: 0 }) // 압축 수준 0 — 이미지는 이미 압축돼 있다 (F-158.md 2.3)

  return { kind: 'zip', filename: mdName.replace(/\.md$/, '.zip'), bytes: zipped, missingCount }
}

// handle.getText 로 에디터 현재 원문을 얻어 내려받는다. store 는 첨부가 있을 때만 읽는다 (F-158.md 2.3)
export async function exportDoc({
  handle,
  doc,
  lineEnding,
  saver,
  store,
  onNotice,
}: {
  handle: EditorHandle | null | undefined
  doc: ExportDocInfo | null | undefined
  lineEnding: LineEnding
  saver?: Saver
  store: ExportStore | null | undefined
  onNotice?: (notice: Notice) => void
}): Promise<void> {
  if (!handle || !doc) return

  // 다운로드는 flush 를 기다리지 않는다 (F-112.md 2.2)
  saver?.flush?.()

  const text = handle.getText(lineEnding)
  const payload = await buildExportPayload({ text, title: doc.title, store })
  const mime = payload.kind === 'zip' ? 'application/zip' : 'text/markdown;charset=utf-8'
  downloadBlob(new Blob([payload.bytes], { type: mime }), payload.filename)

  if (payload.missingCount > 0) {
    onNotice?.({ type: 'warn', message: `이미지 ${payload.missingCount}개를 찾을 수 없어 빼고 내보냈습니다.` })
  }
}

// .txt 평문 바이트만 계산하는 순수 부분 — DOM 없이 단위 테스트할 수 있게 뗐다 (F-278.md 5.1, F-158.md 6장 A1 과 같은 이유)
export function buildPlainPayload({
  text,
  title,
  lineEnding,
}: {
  text: string
  title: string
  lineEnding: LineEnding
}): { filename: string; bytes: Uint8Array<ArrayBuffer> } {
  const filename = toFileName(title).replace(/\.md$/, '.txt')
  const bytes = new TextEncoder().encode(toPlainText(text, lineEnding))
  return { filename, bytes }
}

// .txt 평문 내보내기 — 첨부가 있어도 zip 을 만들지 않는다. 성공 알림·이미지 누락 경고 없음 (F-278.md 5.1)
export async function exportDocAsText({
  handle,
  doc,
  lineEnding,
  saver,
}: {
  handle: EditorHandle | null | undefined
  doc: ExportDocInfo | null | undefined
  lineEnding: LineEnding
  saver?: Saver
  onNotice?: (notice: Notice) => void
}): Promise<void> {
  if (!handle || !doc) return

  // 다운로드는 flush 를 기다리지 않는다 (F-112.md 2.2)
  saver?.flush?.()

  const text = handle.getText(lineEnding)
  const payload = buildPlainPayload({ text, title: doc.title, lineEnding })
  downloadBlob(new Blob([payload.bytes], { type: 'text/plain;charset=utf-8' }), payload.filename)
}

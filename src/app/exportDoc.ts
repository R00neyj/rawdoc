// .md·.txt·.html 내보내기, 서식 있는 복사 (specs/features/F-112.md 2.2, F-158.md 2.3, F-278.md 4·5장, F-280.md 4·5장, specs/ia.md 3.8)
import { zipSync } from 'fflate'

import { toFileName } from '../lib/filename'
import { extractAttachmentRefs } from '../lib/imageBlock'
import { toPlainText } from '../viewer/toPlainText'
import { renderMermaid } from '../lib/mermaidRender'
import {
  collectMermaidSources,
  buildExportBody,
  buildHtmlDocument,
  toInlineStyledHtml,
  readPalette,
  type ExportPalette,
  type ExportResources,
} from '../viewer/toHtmlDoc'
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

// 첨부 ext → data: URI MIME. blob.type 은 서버에서 받은 blob 에서 비어 있을 수 있어 쓰지 않는다 (F-280.md 4.2)
const IMAGE_MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
}

// 인수 개수 한도를 피하려고 8KB 단위로 끊어 이은 뒤 한 번에 base64 로 바꾼다 (F-280.md 4.2)
function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 8192
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

async function attachmentToDataUri(record: AttachmentRecord): Promise<string> {
  const bytes = new Uint8Array(await record.blob.arrayBuffer())
  const mime = IMAGE_MIME_BY_EXT[record.ext] ?? 'application/octet-stream'
  return `data:${mime};base64,${bytesToBase64(bytes)}`
}

async function collectImageDataUris(text: string, store: ExportStore | null | undefined): Promise<Record<string, string>> {
  const images: Record<string, string> = {}
  if (!store?.getAttachment) return images
  const ids = [...extractAttachmentRefs(text)]
  await Promise.all(
    ids.map(async (id) => {
      const record = await store.getAttachment!(id)
      if (record) images[id] = await attachmentToDataUri(record)
    }),
  )
  return images
}

// 4.1 입력 처리 순서 — 첨부 data: URI 화와 Mermaid 렌더는 DOM/저장소를 다루므로 여기서 하고, 순수 조립은 toHtmlDoc.ts 에 넘긴다
async function buildExportResources(text: string, store: ExportStore | null | undefined): Promise<ExportResources> {
  const [images, mermaid] = await Promise.all([
    collectImageDataUris(text, store),
    Promise.all(collectMermaidSources(text).map((source) => renderMermaid(source))),
  ])
  return { images, mermaid }
}

// .html 파일 바이트만 계산하는 순수 부분 — DOM 없이 단위 테스트할 수 있게 뗐다 (F-280.md 6.1)
export function buildHtmlPayload({
  title,
  body,
  css,
}: {
  title: string
  body: string
  css: string
}): { filename: string; bytes: Uint8Array<ArrayBuffer> } {
  const html = buildHtmlDocument({ title, body, css })
  const filename = toFileName(title).replace(/\.md$/, '.html')
  const bytes = new TextEncoder().encode(html)
  return { filename, bytes }
}

// 서식 있는 복사 payload — 순수 부분 (F-280.md 6.1)
export function buildRichCopyPayload({
  text,
  body,
  palette,
}: {
  text: string
  body: string
  palette: ExportPalette
}): { html: string; plain: string } {
  const styled = toInlineStyledHtml(body, palette)
  return { html: `<meta charset="utf-8"><div>${styled}</div>`, plain: toPlainText(text, 'lf') }
}

// HTML 파일 내보내기 (F-280.md 4장) — 인코딩 UTF-8·BOM 없음, 줄바꿈은 항상 \n(html 은 원문 보존 대상이 아니다)
export async function exportDocAsHtml({
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
  const resources = await buildExportResources(text, store)
  const { html: body, missingImages } = buildExportBody(text, resources)

  // CSS 원문 ~60KB 를 첫 화면 번들에서 뗀다 (F-280.md 6.1)
  const { EXPORT_CSS } = await import('../viewer/exportHtmlCss')
  const payload = buildHtmlPayload({ title: doc.title, body, css: EXPORT_CSS })
  downloadBlob(new Blob([payload.bytes], { type: 'text/html;charset=utf-8' }), payload.filename)

  const sizeMB = payload.bytes.length / (1024 * 1024)
  if (sizeMB > 20) {
    onNotice?.({ type: 'warn', message: `HTML 파일이 약 ${Math.round(sizeMB)}MB 입니다. 메일 첨부가 어려울 수 있습니다.` })
  }
  if (missingImages > 0) {
    onNotice?.({ type: 'warn', message: `이미지 ${missingImages}개를 찾을 수 없어 자리 표시로 넣었습니다.` })
  }
}

// 서식 있는 복사 (F-280.md 5장) — 순서는 write(Promise) → write(Blob) → writeText(평문) → 실패 알림. navigator.clipboard 가 없으면 동기적으로 던지므로 전체를 try 로 감싼다
export async function copyDocAsRichText({
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

  saver?.flush?.()
  const text = handle.getText(lineEnding)

  let payloadPromise: Promise<{ html: string; plain: string }> | null = null
  function getPayload(): Promise<{ html: string; plain: string }> {
    if (!payloadPromise) {
      payloadPromise = (async () => {
        const resources = await buildExportResources(text, store)
        const { html: body } = buildExportBody(text, resources)
        // 서식 있는 복사는 toInlineStyledHtml 만 쓰므로 팔레트만 동적으로 가져온다 (F-280.md 6.1)
        const { TOKENS_CSS_RAW } = await import('../viewer/exportHtmlCss')
        const palette = readPalette(TOKENS_CSS_RAW)
        return buildRichCopyPayload({ text, body, palette })
      })()
    }
    return payloadPromise
  }

  const hasClipboardItem = typeof ClipboardItem !== 'undefined'

  if (hasClipboardItem) {
    // 1) await 를 한 번도 하기 전에 write 를 불러 사용자 제스처 안에 들어가게 한다
    try {
      const item = new ClipboardItem({
        'text/html': getPayload().then((p) => new Blob([p.html], { type: 'text/html' })),
        'text/plain': getPayload().then((p) => new Blob([p.plain], { type: 'text/plain' })),
      })
      await navigator.clipboard.write([item])
      onNotice?.({ type: 'info', message: '서식을 포함해 복사했습니다.' })
      return
    } catch {
      // 2 로 이어간다
    }

    // 2) 진짜 Blob 으로 다시 시도한다(Promise 값을 안 받는 브라우저 대비)
    try {
      const payload = await getPayload()
      const item = new ClipboardItem({
        'text/html': new Blob([payload.html], { type: 'text/html' }),
        'text/plain': new Blob([payload.plain], { type: 'text/plain' }),
      })
      await navigator.clipboard.write([item])
      onNotice?.({ type: 'info', message: '서식을 포함해 복사했습니다.' })
      return
    } catch {
      // 3 으로 이어간다
    }
  }

  // 3) 서식 없이 평문만
  try {
    const payload = await getPayload()
    await navigator.clipboard.writeText(payload.plain)
    onNotice?.({ type: 'warn', message: '서식 없이 글만 복사했습니다.' })
    return
  } catch {
    // 4 로 이어간다
  }

  // 4) 완전 실패
  onNotice?.({ type: 'error', message: '복사하지 못했습니다. 브라우저 권한을 확인하세요.' })
}

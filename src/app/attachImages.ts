// 이미지 파일 검사 → 축소 → 저장 → 알림 (specs/features/F-156.md 2.2, F-220.md 2.2). F-114 importFiles.js 와 같은 자리
import { inspectImageBytes } from '../lib/imageFile'
import { shrinkImage } from '../lib/shrinkImage'
import type { ImageExt } from '../lib/imageBlock'
import type { Notice } from './notice'

const MAX_INPUT_BYTES = 20 * 1024 * 1024
const MAX_RESULT_BYTES = 5 * 1024 * 1024
const MAX_DIM = 10000
const MAX_AREA = 40_000_000

const MESSAGES = {
  size: '이미지는 한 장에 20MB 까지 넣을 수 있습니다.',
  format: 'PNG·JPEG·GIF·WebP 이미지만 넣을 수 있습니다.',
  dims: '이미지가 너무 큽니다. 가로·세로 10000px 이하만 넣을 수 있습니다.',
  resultTooLargeGif: 'GIF 는 한 장에 5MB 까지 넣을 수 있습니다.',
  resultTooLarge: '이미지는 줄인 뒤에도 5MB 를 넘어 넣지 못했습니다.',
  save: '저장 공간이 부족해 이미지를 넣지 못했습니다.',
  quota: '이미지 저장 공간(300MB)이 가득 찼습니다. 문서에서 지운 이미지는 하루 뒤 정리됩니다.',
}

export type AttachImagesSource = 'paste' | 'drop'
export type AttachImagesStore = {
  putAttachment(input: {
    blob: Blob
    mime: string
    ext: ImageExt
    width: number
    height: number
  }): Promise<{ id: string; ext: ImageExt }>
}
type InsertedImage = { id: string; ext: ImageExt; width: number; height: number; alt: string; file: File }
type Failure = { message: string; isError: boolean }

// 끌어놓은 파일은 파일명(확장자 제외), 붙여넣기는 '이미지' (F-156.md 2.1)
function altFromFile(file: File, source: AttachImagesSource): string {
  if (source !== 'drop') return '이미지'
  const name = String(file.name ?? '')
  const stripped = name.replace(/\.[^./\\]+$/, '')
  return stripped === '' ? name : stripped
}

// files 를 검사·저장한다(deps.store.putAttachment) → {inserted, notice}
export async function attachImages(
  files: FileList | File[] | null | undefined,
  { store, source = 'paste' }: { store: AttachImagesStore; source?: AttachImagesSource },
): Promise<{ inserted: InsertedImage[]; notice: Notice | null }> {
  const fileArray = Array.from(files ?? [])
  const inserted: InsertedImage[] = []
  const failures: Failure[] = []

  for (const file of fileArray) {
    if (file.size > MAX_INPUT_BYTES) {
      failures.push({ message: MESSAGES.size, isError: false })
      continue
    }

    let bytes: Uint8Array<ArrayBuffer>
    try {
      bytes = new Uint8Array(await file.arrayBuffer())
    } catch {
      failures.push({ message: MESSAGES.format, isError: false })
      continue
    }

    const info = inspectImageBytes(bytes)
    if (!info) {
      failures.push({ message: MESSAGES.format, isError: false })
      continue
    }

    if (info.width > MAX_DIM || info.height > MAX_DIM || info.width * info.height > MAX_AREA) {
      failures.push({ message: MESSAGES.dims, isError: false })
      continue
    }

    const shrunk = await shrinkImage(new Blob([bytes], { type: info.mime }), info)
    if (shrunk.blob.size > MAX_RESULT_BYTES) {
      failures.push({ message: shrunk.ext === 'gif' ? MESSAGES.resultTooLargeGif : MESSAGES.resultTooLarge, isError: false })
      continue
    }

    try {
      const { id, ext } = await store.putAttachment({
        blob: shrunk.blob,
        mime: shrunk.mime,
        ext: shrunk.ext,
        width: shrunk.width,
        height: shrunk.height,
      })
      inserted.push({ id, ext, width: shrunk.width, height: shrunk.height, alt: altFromFile(file, source), file })
    } catch (err) {
      // 계정당 300MB 한도 초과는 다른 문구 (F-221.md 2.3)
      const isQuota = err instanceof Error && err.name === 'quota_exceeded'
      failures.push({ message: isQuota ? MESSAGES.quota : MESSAGES.save, isError: true })
    }
  }

  let notice: Notice | null = null
  if (failures.length > 0) {
    const first = failures[0]
    const type = first.isError ? 'error' : 'warn'
    notice =
      failures.length === 1 && fileArray.length === 1
        ? { type, message: first.message }
        : { type, message: `이미지 ${failures.length}장을 넣지 못했습니다. ${first.message}` }
  }

  return { inserted, notice }
}

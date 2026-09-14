// 이미지 파일 검사 → 저장 → 알림 (specs/features/F-156.md 2.2). F-114 importFiles.js 와 같은 자리
import { inspectImageBytes } from '../lib/imageFile.js'

const MAX_BYTES = 5 * 1024 * 1024
const MAX_DIM = 10000
const MAX_AREA = 40_000_000

const MESSAGES = {
  size: '이미지는 한 장에 5MB 까지 넣을 수 있습니다.',
  format: 'PNG·JPEG·GIF·WebP 이미지만 넣을 수 있습니다.',
  dims: '이미지가 너무 큽니다. 가로·세로 10000px 이하만 넣을 수 있습니다.',
  save: '저장 공간이 부족해 이미지를 넣지 못했습니다.',
}

// 끌어놓은 파일은 파일명(확장자 제외), 붙여넣기는 '이미지' (F-156.md 2.1)
function altFromFile(file, source) {
  if (source !== 'drop') return '이미지'
  const name = String(file.name ?? '')
  const stripped = name.replace(/\.[^./\\]+$/, '')
  return stripped === '' ? name : stripped
}

// files(FileList|File[]) 를 검사·저장한다(deps.store.putAttachment) → {inserted:[{id,ext,width,height,alt,file}], notice:{type,message}|null}
export async function attachImages(files, { store, source = 'paste' }) {
  const fileArray = Array.from(files ?? [])
  const inserted = []
  const failures = []

  for (const file of fileArray) {
    if (file.size > MAX_BYTES) {
      failures.push({ message: MESSAGES.size, isError: false })
      continue
    }

    let bytes
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

    try {
      const blob = new Blob([bytes], { type: info.mime })
      const { id, ext } = await store.putAttachment({
        blob,
        mime: info.mime,
        ext: info.ext,
        width: info.width,
        height: info.height,
      })
      inserted.push({ id, ext, width: info.width, height: info.height, alt: altFromFile(file, source), file })
    } catch {
      failures.push({ message: MESSAGES.save, isError: true })
    }
  }

  let notice = null
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

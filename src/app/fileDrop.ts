// 창 전체 끌어놓기 판정 (specs/features/F-145.md 2.1·2.2). 순수 함수 — dataTransfer·FileList 만 받는다

// 사이드바 문서·폴더 끌기(F-126)는 'text/plain' 만 쓰므로 외부 파일(Files)과 구분된다
export function isExternalFileDrag(dataTransfer: DataTransfer | null | undefined): boolean {
  const types = dataTransfer?.types
  if (!types) return false
  return Array.from(types).includes('Files')
}

const MD_EXT_RE = /\.md$/i
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp)$/i

// allNonMd: 파일이 1개 이상이고 전부 .md 가 아님
export function pickMarkdownFiles(fileList: FileList | File[] | null | undefined): {
  mdFiles: File[]
  allNonMd: boolean
} {
  const files = Array.from(fileList ?? [])
  const mdFiles = files.filter((f) => MD_EXT_RE.test(f.name ?? ''))
  return {
    mdFiles,
    allNonMd: files.length > 0 && mdFiles.length === 0,
  }
}

// 확장자로 고른다(바이트 판정은 attachImages.js 가 시그니처로 한다, F-156.md 2.2) — 여기는 창 전체 드롭의 라우팅만 판단
export function pickImageFiles(fileList: FileList | File[] | null | undefined): { imageFiles: File[] } {
  const files = Array.from(fileList ?? [])
  return { imageFiles: files.filter((f) => IMAGE_EXT_RE.test(f.name ?? '')) }
}

// dragenter·dragover 시점(File 접근 불가) 끌기 항목이 전부 이미지 MIME 인가 — 맞으면 F-145 덮개를 띄우지 않는다 (F-156.md 2.5)
export function isImageOnlyDrag(dataTransfer: DataTransfer | null | undefined): boolean {
  const items = dataTransfer?.items
  if (!items || items.length === 0) return false
  return Array.from(items).every((item) => item.kind === 'file' && (item.type ?? '').startsWith('image/'))
}

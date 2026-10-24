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

// ---------- F-2019.md 4.3 — 폴더 끌어놓기 판정·읽기 ----------
export type DropClass = { kind: 'none' } | { kind: 'folder'; entry: FileSystemDirectoryEntry } | { kind: 'too-many' }

// drop 이벤트 안에서 동기로 items 마다 webkitGetAsEntry() 를 부른 결과를 받는다. null 은 파일로 센다(합성 드롭은 전부 null)
export function classifyDroppedEntries(entries: ReadonlyArray<FileSystemEntry | null>): DropClass {
  const dirs = entries.filter((e): e is FileSystemDirectoryEntry => e !== null && e.isDirectory)
  const files = entries.filter((e) => e === null || e.isFile)

  if (dirs.length === 0) return { kind: 'none' }
  if (dirs.length === 1 && files.length === 0) return { kind: 'folder', entry: dirs[0] }
  return { kind: 'too-many' }
}

function isNoiseDirName(name: string): boolean {
  return name.startsWith('.') || name === '__MACOSX'
}

function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const all: FileSystemEntry[] = []
    function readBatch() {
      reader.readEntries((batch) => {
        if (batch.length === 0) {
          resolve(all)
          return
        }
        all.push(...batch)
        readBatch()
      }, reject)
    }
    readBatch()
  })
}

function readEntryFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject))
}

// 루트 디렉터리 항목을 재귀로 읽는다. 이름이 '.' 으로 시작하거나 '__MACOSX' 인 디렉터리는 들어가지 않는다 (4.3)
export async function readDroppedDirectory(root: FileSystemDirectoryEntry): Promise<Array<{ path: string; file: File }>> {
  const result: Array<{ path: string; file: File }> = []

  async function walk(dir: FileSystemDirectoryEntry) {
    const entries = await readAllEntries(dir.createReader())
    for (const entry of entries) {
      if (entry.isDirectory) {
        if (isNoiseDirName(entry.name)) continue
        await walk(entry as FileSystemDirectoryEntry)
        continue
      }
      const file = await readEntryFile(entry as FileSystemFileEntry)
      const path = entry.fullPath.replace(/^\/+/, '')
      result.push({ path, file })
    }
  }

  await walk(root)
  return result
}

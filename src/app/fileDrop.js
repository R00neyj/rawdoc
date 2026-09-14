// 창 전체 끌어놓기 판정 (specs/features/F-145.md 2.1·2.2). 순수 함수 — dataTransfer·FileList 만 받는다

// 사이드바 문서·폴더 끌기(F-126)는 'text/plain' 만 쓰므로 외부 파일(Files)과 구분된다
export function isExternalFileDrag(dataTransfer) {
  const types = dataTransfer?.types
  if (!types) return false
  return Array.from(types).includes('Files')
}

const MD_EXT_RE = /\.md$/i

// @returns {{mdFiles: File[], allNonMd: boolean}} allNonMd: 파일이 1개 이상이고 전부 .md 가 아님
export function pickMarkdownFiles(fileList) {
  const files = Array.from(fileList ?? [])
  const mdFiles = files.filter((f) => MD_EXT_RE.test(f.name ?? ''))
  return {
    mdFiles,
    allNonMd: files.length > 0 && mdFiles.length === 0,
  }
}

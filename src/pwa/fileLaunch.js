// OS 에서 .md 파일로 열기 연동 (specs/features/F-119.md, specs/ia.md 3.14)
// 실험적 기능: Chrome·Edge 데스크톱에서만 launchQueue 가 있을 수 있다 (MDN "Limited
// availability"). 없으면 아무것도 하지 않는다
/**
 * @param {object} deps
 * @param {(files: File[]) => void} deps.onFiles 열린 파일들을 F-114 importFiles 에 넘긴다
 */
export function setupFileLaunch({ onFiles }) {
  if (!('launchQueue' in window)) return

  window.launchQueue.setConsumer(async (params) => {
    if (!params.files || params.files.length === 0) return
    // 원본 파일에 다시 쓰지 않는다 — File 만 읽고 쓰기 권한은 요청하지 않는다 (F-119.md 2장)
    const files = await Promise.all(params.files.map((handle) => handle.getFile()))
    onFiles(files)
  })
}

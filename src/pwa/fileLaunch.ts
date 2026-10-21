// OS 에서 .md 파일로 열기 연동 (specs/features/F-119.md, F-2156.md, specs/ia.md 3.14)
// 실험적 기능: Chrome·Edge 데스크톱에서만 launchQueue 가 있을 수 있다(MDN "Limited availability") — 없으면 아무것도 하지 않는다
type LaunchParams = { files: FileSystemFileHandle[] }
type LaunchQueue = { setConsumer(consumer: (params: LaunchParams) => Promise<void>): void }

declare global {
  interface Window {
    launchQueue?: LaunchQueue
  }
}

// onFiles: 열린 파일마다 File 과 원본 handle 을 함께 넘긴다 — 재중복 판정에 쓴다 (F-231.md 3.2)
export function setupFileLaunch({
  onFiles,
}: {
  onFiles: (items: { file: File; handle: FileSystemFileHandle }[]) => void
}): void {
  if (!('launchQueue' in window) || !window.launchQueue) return

  window.launchQueue.setConsumer(async (params) => {
    if (!params.files || params.files.length === 0) return
    // 가져오기용 File, `edit` 쓰기는 handle 로 F-2156
    const items = await Promise.all(
      params.files.map(async (handle) => ({ file: await handle.getFile(), handle })),
    )
    onFiles(items)
  })
}

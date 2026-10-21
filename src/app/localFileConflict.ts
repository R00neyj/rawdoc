// 로컬 파일 외부 변경 판정 — 순수 함수와 문구 (specs/features/F-2157.md 2·3장)
export type ExternalChange = 'none' | 'reload' | 'conflict' | 'missing'

export const LOCAL_CONFLICT_TEXT = {
  conflict: '다른 프로그램이 이 파일을 바꿨습니다.',
  missing: '파일을 찾을 수 없습니다. 옮겨졌거나 지워졌습니다.',
  stopped: '저장 멈춤',
  reloaded: '다른 프로그램에서 바뀐 내용을 불러왔습니다.',
  reloadedMixed: '다른 프로그램에서 바뀐 내용을 불러왔습니다. 줄바꿈 형식이 섞여 있어 저장하면 CRLF 로 통일됩니다.',
} as const

// current 가 null 이면 파일이 없다 — 내 변경 여부와 무관
export function decideExternalChange(i: { known: number; current: number | null; dirty: boolean }): ExternalChange {
  if (i.current === null) return 'missing'
  if (i.current === i.known) return 'none'
  return i.dirty ? 'conflict' : 'reload'
}

export async function readDiskStamp(handle: FileSystemFileHandle): Promise<number | null | 'unknown'> {
  try {
    return (await handle.getFile()).lastModified
  } catch (error) {
    return error instanceof DOMException && error.name === 'NotFoundError' ? null : 'unknown'
  }
}

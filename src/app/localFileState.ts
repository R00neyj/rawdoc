// 로컬 파일 저장 상태 전이·문구 — 순수 함수, DOM·React 없음 (specs/features/F-2155.md 3장)
export const LOCAL_SAVE_DEBOUNCE_MS = 1000

export type LocalSaveStatus = 'saved' | 'dirty' | 'error' | 'permission'

// dirty = 아직 쓰지 않은 입력이 있다, writing = 쓰기 하나가 진행 중이다
export type LocalSaveState = { status: LocalSaveStatus; dirty: boolean; writing: boolean; canWrite: boolean }

export type LocalSaveEvent =
  | { type: 'input' }
  | { type: 'write-start' }
  | { type: 'write-ok' }
  | { type: 'write-skip' }
  | { type: 'write-fail'; error: unknown }
  | { type: 'permission'; granted: boolean }
  | { type: 'reset'; canWrite: boolean }

export const LOCAL_SAVE_TEXT: Record<LocalSaveStatus, string> = {
  saved: '파일에 저장됨',
  dirty: '입력 중…',
  error: '저장 실패',
  permission: '저장 권한 필요',
}

export const LOCAL_WRITE_FAILED_MESSAGE = '파일에 저장하지 못했습니다.'
export const LOCAL_MIXED_EOL_MESSAGE = '줄바꿈 형식이 섞여 있어 저장하면 CRLF 로 통일됩니다.'
export const LOCAL_NO_IMAGES_MESSAGE = '컴퓨터 파일에는 이미지를 넣을 수 없습니다.'
export const localOpenFailedMessage = (name: string) => `"${name}" 을(를) 열지 못했습니다.`
export const localNotUtf8Message = (name: string) => `"${name}" 은(는) UTF-8 텍스트 파일이 아니라 열 수 없습니다.`
export const localUnwrittenMessage = (name: string) => `"${name}" 의 바뀐 내용을 파일에 쓰지 못했습니다.`

export function initialLocalSave(canWrite: boolean): LocalSaveState {
  return { status: canWrite ? 'saved' : 'permission', dirty: false, writing: false, canWrite }
}

// 쓰기 권한을 잃은 실패 — 다시 시도하지 않고 `저장 허용` 을 기다린다
export function isWritePermissionError(error: unknown): boolean {
  return error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')
}

// notifyError — `파일에 저장하지 못했습니다.` 를 띄울 때. error 로 들어갈 때 한 번만
export function nextLocalSave(state: LocalSaveState, event: LocalSaveEvent): { state: LocalSaveState; notifyError: boolean } {
  switch (event.type) {
    case 'input': {
      const status = !state.canWrite ? 'permission' : state.status === 'error' ? 'error' : 'dirty'
      return { state: { ...state, status, dirty: true }, notifyError: false }
    }
    case 'write-start':
      return { state: { ...state, dirty: false, writing: true }, notifyError: false }
    case 'write-ok':
      return { state: { ...state, writing: false, status: state.dirty ? 'dirty' : 'saved' }, notifyError: false }
    case 'write-skip':
      return { state: { ...state, writing: false, dirty: true }, notifyError: false }
    case 'write-fail': {
      const failed = { ...state, writing: false, dirty: true }
      if (isWritePermissionError(event.error)) return { state: { ...failed, canWrite: false, status: 'permission' }, notifyError: false }
      return { state: { ...failed, status: 'error' }, notifyError: state.status !== 'error' }
    }
    case 'permission':
      if (!event.granted) return { state: { ...state, canWrite: false, status: 'permission' }, notifyError: false }
      return { state: { ...state, canWrite: true, status: state.dirty ? 'dirty' : 'saved' }, notifyError: false }
    case 'reset':
      return { state: initialLocalSave(event.canWrite), notifyError: false }
  }
}

export function hasUnwritten(state: LocalSaveState): boolean {
  return state.dirty || state.writing
}

// 상태바 점 — 권한 없음도 아직 안전하게 저장되지 않았으니 실패 점
export function localSaveDot(status: LocalSaveStatus): 'saved' | 'dirty' | 'error' {
  return status === 'permission' ? 'error' : status
}

// 편집기 맨 위 제목 — 끝 `.md` 만 뗀다
export function localFileTitle(name: string): string {
  const stripped = name.replace(/\.md$/i, '')
  return stripped === '' ? name : stripped
}

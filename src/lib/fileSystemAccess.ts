// File System Access API 의 TS 6 lib.dom 에 없는 부분과 권한 확인 (specs/features/F-2155.md 1장, F-2154 근거·5장)
type PermissionMode = { mode: 'read' | 'readwrite' }

export type OpenFilePickerOptions = {
  types?: { description?: string; accept: Record<string, string[]> }[]
  excludeAcceptAllOption?: boolean
  id?: string
  multiple?: boolean
}

declare global {
  interface Window {
    showOpenFilePicker?: (options?: OpenFilePickerOptions) => Promise<FileSystemFileHandle[]>
  }
  interface FileSystemHandle {
    queryPermission(descriptor?: PermissionMode): Promise<PermissionState>
    requestPermission(descriptor?: PermissionMode): Promise<PermissionState>
  }
}

export const MD_PICKER_OPTIONS: OpenFilePickerOptions = {
  types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md'] } }],
  excludeAcceptAllOption: true,
  id: 'md-file',
}

// Chrome·Edge 데스크톱만 — 없는 브라우저는 `컴퓨터 파일 바로 고치기…` 세 자리를 모두 숨긴다
export function localFileSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function'
}

// 권한 요청은 사용자 동작 안에서만 된다 — 동작 밖이면 묻지 않고 거짓
export async function ensureWritePermission(handle: FileSystemFileHandle, { gesture }: { gesture: boolean }): Promise<boolean> {
  try {
    if ((await handle.queryPermission({ mode: 'readwrite' })) === 'granted') return true
    if (!gesture) return false
    return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted'
  } catch {
    return false
  }
}

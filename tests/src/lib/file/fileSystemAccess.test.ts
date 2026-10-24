// F-2155 A3 — ensureWritePermission 네 갈래와 localFileSupported (가짜 handle)
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ensureWritePermission, localFileSupported, MD_PICKER_OPTIONS } from '../../../../src/lib/file/fileSystemAccess'

function fakeHandle(query: () => Promise<PermissionState>, request: () => Promise<PermissionState> = async () => 'denied') {
  const queryPermission = vi.fn(query)
  const requestPermission = vi.fn(request)
  return { handle: { queryPermission, requestPermission } as unknown as FileSystemFileHandle, queryPermission, requestPermission }
}

describe('F-2155 U3 ensureWritePermission', () => {
  it('granted 면 요청 없이 참', async () => {
    const f = fakeHandle(async () => 'granted')
    expect(await ensureWritePermission(f.handle, { gesture: false })).toBe(true)
    expect(f.queryPermission).toHaveBeenCalledWith({ mode: 'readwrite' })
    expect(f.requestPermission).not.toHaveBeenCalled()
  })

  it('사용자 동작 밖이면 묻지 않고 거짓', async () => {
    const f = fakeHandle(async () => 'prompt', async () => 'granted')
    expect(await ensureWritePermission(f.handle, { gesture: false })).toBe(false)
    expect(f.requestPermission).not.toHaveBeenCalled()
  })

  it('동작 안이면 requestPermission 결과를 따른다 — 허용', async () => {
    const f = fakeHandle(async () => 'prompt', async () => 'granted')
    expect(await ensureWritePermission(f.handle, { gesture: true })).toBe(true)
    expect(f.requestPermission).toHaveBeenCalledWith({ mode: 'readwrite' })
  })

  it('동작 안이면 requestPermission 결과를 따른다 — 거절', async () => {
    const f = fakeHandle(async () => 'prompt', async () => 'denied')
    expect(await ensureWritePermission(f.handle, { gesture: true })).toBe(false)
  })

  it('던지면 거짓', async () => {
    const throwsQuery = fakeHandle(async () => { throw new Error('x') })
    expect(await ensureWritePermission(throwsQuery.handle, { gesture: true })).toBe(false)
    const throwsRequest = fakeHandle(async () => 'prompt', async () => { throw new DOMException('no', 'SecurityError') })
    expect(await ensureWritePermission(throwsRequest.handle, { gesture: true })).toBe(false)
    expect(await ensureWritePermission({} as FileSystemFileHandle, { gesture: true })).toBe(false)
  })
})

describe('F-2155 U3 localFileSupported·MD_PICKER_OPTIONS', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('window.showOpenFilePicker 가 함수일 때만 참', () => {
    expect(localFileSupported()).toBe(false)
    vi.stubGlobal('window', {})
    expect(localFileSupported()).toBe(false)
    vi.stubGlobal('window', { showOpenFilePicker: async () => [] })
    expect(localFileSupported()).toBe(true)
    vi.stubGlobal('window', { showOpenFilePicker: 'nope' })
    expect(localFileSupported()).toBe(false)
  })

  it('선택 창 값은 F-2154 5장 그대로', () => {
    expect(MD_PICKER_OPTIONS).toEqual({
      types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md'] } }],
      excludeAcceptAllOption: true,
      id: 'md-file',
    })
  })
})

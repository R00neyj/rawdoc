import { describe, expect, it } from 'vitest'
import { decideExternalChange, readDiskStamp } from '../../../src/app/localFileConflict'

const fakeHandle = (getFile: () => Promise<{ lastModified: number }>) => ({ getFile }) as unknown as FileSystemFileHandle

describe('decideExternalChange (F-2157 U1)', () => {
  it('같으면 none, 다르면 dirty 에 따라 conflict·reload, 작아져도 다름', () => {
    expect(decideExternalChange({ known: 10, current: 10, dirty: true })).toBe('none')
    expect(decideExternalChange({ known: 10, current: 10, dirty: false })).toBe('none')
    expect(decideExternalChange({ known: 10, current: 20, dirty: true })).toBe('conflict')
    expect(decideExternalChange({ known: 10, current: 20, dirty: false })).toBe('reload')
    expect(decideExternalChange({ known: 10, current: 5, dirty: true })).toBe('conflict')
    expect(decideExternalChange({ known: 10, current: 5, dirty: false })).toBe('reload')
  })

  it('current 가 null 이면 dirty 와 무관하게 missing', () => {
    expect(decideExternalChange({ known: 10, current: null, dirty: true })).toBe('missing')
    expect(decideExternalChange({ known: 10, current: null, dirty: false })).toBe('missing')
  })
})

describe('readDiskStamp (F-2157 U2)', () => {
  it('정상이면 lastModified, NotFoundError 면 null, 그 밖 실패는 unknown', async () => {
    expect(await readDiskStamp(fakeHandle(async () => ({ lastModified: 42 })))).toBe(42)
    const notFound = fakeHandle(async () => {
      throw new DOMException('gone', 'NotFoundError')
    })
    expect(await readDiskStamp(notFound)).toBeNull()
    const other = fakeHandle(async () => {
      throw new DOMException('no', 'NotAllowedError')
    })
    expect(await readDiskStamp(other)).toBe('unknown')
    const plain = fakeHandle(async () => {
      throw new Error('x')
    })
    expect(await readDiskStamp(plain)).toBe('unknown')
  })
})

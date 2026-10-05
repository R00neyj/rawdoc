// F-2132 A2
import { describe, expect, it } from 'vitest'
import { isFolderId, resolveFolderPath } from '../../../cli/src/folderRef'

const f = (id: string, name: string, parentId: string | null = null) => ({ id, name, parentId })

describe('F-2132 A2 resolveFolderPath', () => {
  const folders = [f('a', '수업자료'), f('b', '1주차', 'a')]
  it('앞뒤 / 와 NFD 입력도 같은 폴더', () => {
    for (const v of ['수업자료/1주차', '/수업자료/1주차/', '수업자료/1주차'.normalize('NFD')]) {
      expect(resolveFolderPath(v, folders)).toEqual({ kind: 'found', id: 'b' })
    }
  })
  it('이름에 / 가 든 폴더를 그 표기로 찾는다', () => {
    expect(resolveFolderPath('a/b', [f('x', 'a/b')])).toEqual({ kind: 'found', id: 'x' })
  })
  it('같은 부모 같은 이름 둘 → ambiguous', () => {
    expect(resolveFolderPath('x', [f('1', 'x'), f('2', 'x')])).toEqual({ kind: 'ambiguous', ids: ['1', '2'] })
  })
  it('이름 a/b 와 a 안의 b → ambiguous', () => {
    expect(resolveFolderPath('a/b', [f('1', 'a/b'), f('2', 'a'), f('3', 'b', '2')])).toEqual({ kind: 'ambiguous', ids: ['1', '3'] })
  })
  it('끝 이름만·/·빈 값·대소문자 다름 → not_found', () => {
    expect(resolveFolderPath('1주차', folders)).toEqual({ kind: 'not_found' })
    expect(resolveFolderPath('/', folders)).toEqual({ kind: 'not_found' })
    expect(resolveFolderPath('', folders)).toEqual({ kind: 'not_found' })
    expect(resolveFolderPath('A', [f('1', 'a')])).toEqual({ kind: 'not_found' })
  })
  it('isFolderId 는 UUID 만 참', () => {
    expect(isFolderId('3f2b8c1e-0a4d-4e6f-9b1a-2c3d4e5f6a7b')).toBe(true)
    expect(isFolderId('수업자료/1주차')).toBe(false)
    expect(isFolderId('f1')).toBe(false)
  })
})

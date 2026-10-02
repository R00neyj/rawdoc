// F-2119 A2·A3 (specs/features/F-2119.md 3장)
import { describe, expect, it } from 'vitest'
import { folderPathOf, titleMatches, withFolderPath } from '../../../cli/src/docMeta'
import { humanFolderList } from '../../../cli/src/output'

const folders = [
  { id: 'a', name: '수업자료', parentId: null },
  { id: 'b', name: '바이브', parentId: 'a' },
  { id: 'c', name: '1주차', parentId: 'b' },
  { id: 'x', name: '순환1', parentId: 'y' },
  { id: 'y', name: '순환2', parentId: 'x' },
]

describe('F-2119 A2 folderPathOf', () => {
  it('null → [], 없는 id → null, 3단 중첩 → 맨 위부터 이름', () => {
    expect(folderPathOf(folders, null)).toEqual([])
    expect(folderPathOf(folders, 'nope')).toBeNull()
    expect(folderPathOf(folders, 'c')).toEqual(['수업자료', '바이브', '1주차'])
  })

  it('순환에서 끝난다', () => {
    expect(folderPathOf(folders, 'x')?.length).toBe(2)
  })

  it('humanFolderList 각 행의 경로와 같다', () => {
    for (const line of humanFolderList(folders).trim().split('\n')) {
      const [id, path] = line.split('\t')
      expect(path).toBe(folderPathOf(folders, id)!.join('/'))
    }
  })

  it('withFolderPath 는 새 객체에 folderPath 만 더한다', () => {
    const doc = { id: 'd', title: 't', lineEnding: 'lf' as const, folderId: 'a', pinnedAt: null, version: 1, createdAt: 0, updatedAt: 0 }
    const [out] = withFolderPath([doc], folders)
    expect(out).toEqual({ ...doc, folderPath: ['수업자료'] })
    expect(out).not.toBe(doc)
    expect('folderPath' in doc).toBe(false)
  })
})

describe('F-2119 A3 titleMatches', () => {
  it('부분 문자열, NFD 질의, 대소문자 무시', () => {
    expect(titleMatches('바이브코딩 회의록', '회의록')).toBe(true)
    expect(titleMatches('바이브코딩 회의록', '회의록'.normalize('NFD'))).toBe(true)
    expect(titleMatches('README', 'read')).toBe(true)
    expect(titleMatches('README', 'xyz')).toBe(false)
  })

  it('빈 제목은 어떤 질의에도 거짓', () => {
    expect(titleMatches('', '회의')).toBe(false)
    expect(titleMatches('', '(금고 문서)')).toBe(false)
  })
})

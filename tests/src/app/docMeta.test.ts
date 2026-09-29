import { describe, it, expect } from 'vitest'
import { stripContent, isSharedDoc, sortByUpdatedAtDesc } from '../../../src/app/docMeta'
import type { Doc } from '../../../src/types'

const full: Doc = {
  id: 'd1',
  title: '제목',
  content: '본문',
  lineEnding: 'lf',
  createdAt: 1,
  updatedAt: 2,
  folderId: 'f1',
  pinnedAt: 3,
  role: 'edit',
  ownerEmail: 'a@example.com',
  viaFolder: { id: 'f9', name: '공유' },
}

describe('stripContent', () => {
  it('U21 본문·생성 시각을 빼고 키 순서를 지킨다', () => {
    const r = stripContent(full)
    expect('content' in r).toBe(false)
    expect('createdAt' in r).toBe(false)
    expect(Object.keys(r)).toEqual(['id', 'title', 'updatedAt', 'folderId', 'pinnedAt', 'role', 'ownerEmail', 'viaFolder', 'lineEnding'])
  })
  it('U22 undefined 는 null 로', () => {
    const r = stripContent({ ...full, folderId: undefined, pinnedAt: undefined, viaFolder: undefined } as unknown as Doc)
    expect(r.folderId).toBeNull()
    expect(r.pinnedAt).toBeNull()
    expect(r.viaFolder).toBeNull()
  })
  it('U23 role·ownerEmail 이 없어도 키는 있다', () => {
    const { role: _role, ownerEmail: _owner, ...rest } = full
    const r = stripContent(rest as Doc)
    expect('role' in r).toBe(true)
    expect('ownerEmail' in r).toBe(true)
    expect(r.role).toBeUndefined()
    expect(r.ownerEmail).toBeUndefined()
  })
  it('U24 e2ee 는 끝에 붙는다', () => {
    for (const e2ee of ['locked', 'open'] as const) {
      const r = stripContent({ ...full, e2ee })
      expect(r.e2ee).toBe(e2ee)
      expect(Object.keys(r).at(-1)).toBe('e2ee')
    }
  })
  it('U25 e2ee 없으면 키도 없다', () => {
    expect('e2ee' in stripContent(full)).toBe(false)
  })
})

describe('isSharedDoc', () => {
  it('U26 edit·view 는 공유받은 문서', () => {
    expect(isSharedDoc({ role: 'edit' })).toBe(true)
    expect(isSharedDoc({ role: 'view' })).toBe(true)
  })
  it('U27 그 밖은 아니다', () => {
    expect(isSharedDoc({ role: 'owner' })).toBe(false)
    expect(isSharedDoc({})).toBe(false)
    expect(isSharedDoc(null)).toBe(false)
    expect(isSharedDoc(undefined)).toBe(false)
  })
})

describe('sortByUpdatedAtDesc', () => {
  it('U28 최근 것부터', () => {
    expect(sortByUpdatedAtDesc([{ updatedAt: 1 }, { updatedAt: 3 }, { updatedAt: 2 }]).map((d) => d.updatedAt)).toEqual([3, 2, 1])
  })
  it('U29 같은 시각은 입력 순서 유지', () => {
    const list = [{ id: 'a', updatedAt: 5 }, { id: 'b', updatedAt: 5 }, { id: 'c', updatedAt: 9 }]
    expect(sortByUpdatedAtDesc(list).map((d) => d.id)).toEqual(['c', 'a', 'b'])
  })
  it('U30 원본은 그대로, 새 배열을 준다', () => {
    const list = [{ updatedAt: 1 }, { updatedAt: 2 }]
    const r = sortByUpdatedAtDesc(list)
    expect(r).not.toBe(list)
    expect(list.map((d) => d.updatedAt)).toEqual([1, 2])
  })
})

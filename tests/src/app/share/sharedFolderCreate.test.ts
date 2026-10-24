import { describe, it, expect } from 'vitest'
import { wikiCreatePlan, sharedNewDocAllowed, sharedFolderGroups, sharedCreateErrorMessage } from '../../../../src/app/share/sharedFolderCreate'
import { ApiError, type SharedFolderItem } from '../../../../src/storage/docsApi'

const F = (id: string, name: string, role: 'edit' | 'view'): SharedFolderItem => ({ id, name, role, ownerEmail: 'a@x.com' })

describe('F-2166 U1 wikiCreatePlan', () => {
  const via = { id: 'F', name: '수업' }
  it('내 문서·origin 없음은 own', () => {
    expect(wikiCreatePlan({ role: 'owner', folderId: null }, [])).toEqual({ kind: 'own' })
    expect(wikiCreatePlan(null, [])).toEqual({ kind: 'own' })
  })
  it('edit 사슬은 shared, 폴더는 origin folderId 그대로(하위 폴더)', () => {
    expect(wikiCreatePlan({ role: 'edit', folderId: 'G', viaFolder: via }, [F('F', '수업', 'edit')])).toEqual({ kind: 'shared', folderId: 'G' })
  })
  it('view 사슬은 fallback', () => {
    expect(wikiCreatePlan({ role: 'view', folderId: 'G', viaFolder: via }, [F('F', '수업', 'view')])).toEqual({ kind: 'fallback' })
  })
  it('문서 초대 edit + 폴더 view 는 fallback', () => {
    expect(wikiCreatePlan({ role: 'edit', folderId: 'G', viaFolder: via }, [F('F', '수업', 'view')])).toEqual({ kind: 'fallback' })
  })
  it('문서 하나만 받은 문서는 fallback', () => {
    expect(wikiCreatePlan({ role: 'edit', folderId: null, viaFolder: null }, [F('F', '수업', 'edit')])).toEqual({ kind: 'fallback' })
  })
  it('folders 가 null 이거나 항목이 없으면 origin role', () => {
    expect(wikiCreatePlan({ role: 'edit', folderId: 'G', viaFolder: via }, null)).toEqual({ kind: 'shared', folderId: 'G' })
    expect(wikiCreatePlan({ role: 'view', folderId: 'G', viaFolder: via }, [])).toEqual({ kind: 'fallback' })
  })
})

describe('F-2166 U2 sharedNewDocAllowed', () => {
  it('edit 만 참', () => {
    const folders = [F('a', 'A', 'edit'), F('b', 'B', 'view')]
    expect(sharedNewDocAllowed('a', folders)).toBe(true)
    expect(sharedNewDocAllowed('b', folders)).toBe(false)
    expect(sharedNewDocAllowed('c', folders)).toBe(false)
    expect(sharedNewDocAllowed('a', null)).toBe(false)
  })
})

describe('F-2166 U3 sharedFolderGroups', () => {
  it('문서 있는 묶음 순서 유지, 빈 폴더는 이름순으로 뒤, 이름은 folders 값', () => {
    const docs = [
      { id: '1', viaFolder: { id: 'z', name: '옛이름' } },
      { id: '2', viaFolder: { id: 'y', name: 'Y' } },
      { id: '3', viaFolder: null },
    ]
    const folders = [F('e2', '나', 'edit'), F('z', '새이름', 'edit'), F('e1', '가', 'view')]
    expect(sharedFolderGroups(docs, folders).map((g) => [g.id, g.name])).toEqual([['z', '새이름'], ['y', 'Y'], ['e1', '가'], ['e2', '나']])
  })
  it('둘 다 비면 빈 배열', () => {
    expect(sharedFolderGroups([], [])).toEqual([])
    expect(sharedFolderGroups([], null)).toEqual([])
  })
})

describe('F-2166 U4 sharedCreateErrorMessage', () => {
  it('종류별 문구', () => {
    expect(sharedCreateErrorMessage(new ApiError('owner_quota_exceeded'))).toBe('공유 폴더 주인의 저장 공간이 가득 찼습니다.')
    expect(sharedCreateErrorMessage(new ApiError('forbidden'))).toBe('이 공유 폴더에 새 문서를 만들 권한이 없습니다.')
    expect(sharedCreateErrorMessage(new ApiError('not_found'))).toBe('이 공유 폴더에 새 문서를 만들 권한이 없습니다.')
    expect(sharedCreateErrorMessage(new ApiError('account_blocked'))).toBe('공유 폴더 주인의 계정이 쓰기가 막혀 새 문서를 만들지 못했습니다.')
    expect(sharedCreateErrorMessage(new ApiError('network'))).toBe('공유 폴더에 새 문서를 만들지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.')
    for (const kind of ['invalid', 'id_taken', 'rate_limited', 'unauthorized', 'server_error', 'too_large'] as const) {
      expect(sharedCreateErrorMessage(new ApiError(kind))).toBe('새 문서를 만들지 못했습니다. 다시 시도하세요.')
    }
    expect(sharedCreateErrorMessage(new Error('x'))).toBe('새 문서를 만들지 못했습니다. 다시 시도하세요.')
  })
})

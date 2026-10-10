// 금고 폴더 드롭 — 평문 문서는 금고 문서로 바꾼 뒤 옮긴다 (small change, F-407 경로 재사용)
import { describe, it, expect } from 'vitest'
import { convertedDocIds, planVaultDropConvert, splitVaultFolderDrop, vaultDropMoveItems } from '../../../src/app/vaultFolderDrop'
import type { Doc, Folder } from '../../../src/types'

const FOLDERS = [
  { id: 'vault', e2ee: true },
  { id: 'plain', e2ee: undefined },
  { id: 'vaultSub', e2ee: true },
] as Array<Pick<Folder, 'id' | 'e2ee'>>

const DOCS = [
  { id: 'p1', e2ee: undefined, role: undefined },
  { id: 'p2', e2ee: undefined, role: undefined },
  { id: 'v1', e2ee: 'open' },
  { id: 'l1', e2ee: 'locked' },
  { id: 's1', e2ee: undefined, role: 'edit' },
] as Array<Pick<Doc, 'id' | 'e2ee' | 'role'>>

describe('splitVaultFolderDrop', () => {
  it('대상이 금고 폴더가 아니면 null — 그냥 옮긴다', () => {
    const items = [{ kind: 'doc' as const, id: 'p1' }]
    expect(splitVaultFolderDrop({ items, targetFolderId: 'plain', docs: DOCS, folders: FOLDERS })).toBeNull()
    expect(splitVaultFolderDrop({ items, targetFolderId: null, docs: DOCS, folders: FOLDERS })).toBeNull()
  })

  it('금고 폴더라도 평문 문서가 없으면 null — 금고 문서·평문 폴더는 기존처럼', () => {
    const items = [
      { kind: 'doc' as const, id: 'v1' },
      { kind: 'folder' as const, id: 'plain' },
    ]
    expect(splitVaultFolderDrop({ items, targetFolderId: 'vault', docs: DOCS, folders: FOLDERS })).toBeNull()
  })

  it('평문 문서는 convert, 금고 문서·금고 폴더·모르는 문서·공유받은 문서는 move, 평문 폴더는 reject', () => {
    const items = [
      { kind: 'doc' as const, id: 'p1' },
      { kind: 'doc' as const, id: 'v1' },
      { kind: 'doc' as const, id: 'l1' },
      { kind: 'folder' as const, id: 'vaultSub' },
      { kind: 'folder' as const, id: 'plain' },
      { kind: 'doc' as const, id: 'p2' },
      { kind: 'doc' as const, id: 'gone' },
      { kind: 'doc' as const, id: 's1' },
    ]
    expect(splitVaultFolderDrop({ items, targetFolderId: 'vault', docs: DOCS, folders: FOLDERS })).toEqual({
      convert: ['p1', 'p2'],
      move: [
        { kind: 'doc', id: 'v1' },
        { kind: 'doc', id: 'l1' },
        { kind: 'folder', id: 'vaultSub' },
        { kind: 'doc', id: 'gone' },
        { kind: 'doc', id: 's1' },
      ],
      reject: [{ kind: 'folder', id: 'plain' }],
    })
  })
})

describe('planVaultDropConvert', () => {
  const pdoc = (id: string, extra: Partial<Doc> = {}) => ({ id, folderId: null, updatedAt: 1, content: '', ...extra })

  it('끈 순서대로 평문 문서 단계만, 폴더 단계 없음', () => {
    const docs = [pdoc('a'), pdoc('b', { e2ee: 'open' }), pdoc('c')]
    const plan = planVaultDropConvert({ docIds: ['c', 'b', 'a', 'gone'], docs, folders: [] })
    expect(plan.direction).toBe('to-e2ee')
    expect(plan.steps).toEqual([
      { kind: 'doc', id: 'c' },
      { kind: 'doc', id: 'a' },
    ])
    expect(plan.docCount).toBe(2)
    expect(plan.folderCount).toBe(0)
  })

  it('너무 큰 문서·이미지가 많은 문서를 모은다', () => {
    const many = Array.from({ length: 1001 }, (_, i) => `![](attachments/${i.toString(16).padStart(16, '0')}.png)`).join('\n')
    const docs = [pdoc('big', { content: 'a'.repeat(749_972) }), pdoc('refs', { content: many }), pdoc('ok')]
    const plan = planVaultDropConvert({ docIds: ['big', 'refs', 'ok'], docs, folders: [] })
    expect(plan.blocked).toEqual({ tooLarge: ['big'], tooManyRefs: ['refs'] })
  })
})

describe('바뀐 문서만 옮긴다', () => {
  it('convertedDocIds — 실행 뒤 금고 문서가 된 것만, 끈 순서대로', () => {
    const after = [
      { id: 'p1', e2ee: 'open' },
      { id: 'p2', e2ee: undefined },
      { id: 'p3', e2ee: 'locked' },
    ] as Array<Pick<Doc, 'id' | 'e2ee'>>
    expect(convertedDocIds(['p3', 'p2', 'p1', 'gone'], after)).toEqual(['p3', 'p1'])
  })

  it('vaultDropMoveItems — 바뀐 문서 + 그냥 옮길 것 + 거절할 평문 폴더(저장소가 E19 로 막는다)', () => {
    const split = {
      convert: ['p1', 'p2'],
      move: [{ kind: 'doc' as const, id: 'v1' }],
      reject: [{ kind: 'folder' as const, id: 'plain' }],
    }
    expect(vaultDropMoveItems(split, ['p2'])).toEqual([
      { kind: 'doc', id: 'p2' },
      { kind: 'doc', id: 'v1' },
      { kind: 'folder', id: 'plain' },
    ])
  })
})

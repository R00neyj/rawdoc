import { describe, expect, it } from 'vitest'
import {
  leaveShareMessage,
  leaveTargetOfDoc,
  leaveTargetOfFolder,
  removeSharedIds,
  runLeaveShare,
  sharedIdsLeftBy,
  type LeaveShareDeps,
  type LeaveShareTarget,
} from '../../../src/app/leaveShare'

const F = { id: 'F', name: '폴더F' }
const B = { id: 'B', name: '하위B' }

const docs = [
  { id: 'D', title: '직접', role: 'view' as const, viaFolder: null },
  { id: 'F1', title: '일', role: 'view' as const, viaFolder: F },
  { id: 'F2', title: '이', role: 'edit' as const, viaFolder: F },
  { id: 'B1', title: '비', role: 'view' as const, viaFolder: B },
  { id: 'M', title: '내', role: 'owner' as const, viaFolder: null },
]

describe('F-2115 leaveShare', () => {
  it('U1 leaveTargetOfDoc', () => {
    expect(leaveTargetOfDoc({ id: 'D', title: '직접', role: 'view', ownerEmail: 'a@b.c' })).toEqual({ type: 'doc', id: 'D', name: '직접', docCount: 1 })
    expect(leaveTargetOfDoc({ id: 'F1', title: '일', role: 'view', ownerEmail: 'a@b.c', viaFolder: F })).toBeNull()
  })

  it('U2 leaveTargetOfFolder docCount', () => {
    const shared = [
      { id: 'D', title: '직접', role: 'view' as const, ownerEmail: '' },
      { id: 'F1', title: '일', role: 'view' as const, ownerEmail: '', viaFolder: F },
      { id: 'F2', title: '이', role: 'edit' as const, ownerEmail: '', viaFolder: F },
      { id: 'B1', title: '비', role: 'view' as const, ownerEmail: '', viaFolder: B },
    ]
    expect(leaveTargetOfFolder(F, shared)).toEqual({ type: 'folder', id: 'F', name: '폴더F', docCount: 2 })
  })

  it('U3 sharedIdsLeftBy', () => {
    const doc: LeaveShareTarget = { type: 'doc', id: 'D', name: '', docCount: 1 }
    const folder: LeaveShareTarget = { type: 'folder', id: 'F', name: '', docCount: 2 }
    expect(sharedIdsLeftBy(docs, doc)).toEqual(['D'])
    expect(sharedIdsLeftBy(docs, folder)).toEqual(['F1', 'F2'])
    expect(sharedIdsLeftBy(docs, { ...doc, id: 'M' })).toEqual([])
  })

  it('U4 removeSharedIds', () => {
    const list = [{ id: 'a', role: 'view' as const }, { id: 'b', role: 'owner' as const }, { id: 'c', role: 'edit' as const }]
    expect(removeSharedIds(list, ['a', 'b'])).toEqual([{ id: 'b', role: 'owner' }, { id: 'c', role: 'edit' }])
  })

  it('U5 leaveShareMessage', () => {
    expect(leaveShareMessage({ type: 'doc', id: 'D', name: '메모', docCount: 1 })).toBe('"메모" 공유에서 나갈까요? 소유자가 다시 초대하기 전에는 볼 수 없습니다.')
    expect(leaveShareMessage({ type: 'doc', id: 'D', name: '  ', docCount: 1 })).toContain('"제목 없는 문서"')
    expect(leaveShareMessage({ type: 'folder', id: 'F', name: '폴더F', docCount: 3 })).toBe(
      '"폴더F" 폴더 공유에서 나갈까요? 폴더 안 문서 3개를 소유자가 다시 초대하기 전에는 볼 수 없습니다.',
    )
  })

  describe('U6 runLeaveShare 순서', () => {
    function makeDeps(openDocId: string | null, fail = false) {
      const calls: string[] = []
      const deps: LeaveShareDeps = {
        docs,
        openDocId,
        beforeLeaveDoc: async () => { calls.push('flush') },
        flushOutbox: async () => { calls.push('flushOutbox') },
        leaveShare: async () => { calls.push('api'); if (fail) throw new Error('x') },
        goHome: async () => { calls.push('goHome') },
        forgetSharedDocs: () => { calls.push('forget') },
        removeFromList: () => { calls.push('setDocs') },
        queueYjsRemoval: () => { calls.push('queue') },
        post: () => { calls.push('post') },
        notify: (n) => { calls.push(`notice:${n.type}`) },
        resync: () => { calls.push('resync') },
      }
      return { calls, deps }
    }
    const target: LeaveShareTarget = { type: 'folder', id: 'F', name: '폴더F', docCount: 2 }

    it('열린 문서가 대상이면 전체 순서', async () => {
      const { calls, deps } = makeDeps('F1')
      expect(await runLeaveShare(target, deps)).toBe('left')
      expect(calls).toEqual(['flush', 'flushOutbox', 'api', 'goHome', 'forget', 'setDocs', 'queue', 'post', 'notice:info', 'resync'])
    })

    it('열린 문서가 대상이 아니면 flush·goHome 없음', async () => {
      const { calls, deps } = makeDeps('D')
      await runLeaveShare(target, deps)
      expect(calls).toEqual(['flushOutbox', 'api', 'forget', 'setDocs', 'queue', 'post', 'notice:info', 'resync'])
    })

    it('실패하면 오류 알림만', async () => {
      const { calls, deps } = makeDeps('D', true)
      expect(await runLeaveShare(target, deps)).toBe('failed')
      expect(calls).toEqual(['flushOutbox', 'api', 'notice:error'])
    })
  })
})

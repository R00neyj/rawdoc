import { describe, expect, it, vi } from 'vitest'
import {
  firstListedDocId,
  folderLooksEmpty,
  hideLockedVaultDocs,
  unlockVaultFolder,
  vaultFolderGate,
  vaultNoticeOn,
  visibleOpenFolderIds,
} from '../../../src/app/vaultVisibility'
import type { E2eeStatus } from '../../../src/e2ee/keyring'

describe('F-4003 U1 hideLockedVaultDocs', () => {
  it('일반·열림·잠김·공유받음 섞음 → 잠김만 빠지고 순서 그대로', () => {
    const docs = [
      { id: 'plain' },
      { id: 'locked1', e2ee: 'locked' as const },
      { id: 'open', e2ee: 'open' as const },
      { id: 'shared', role: 'view' as const },
      { id: 'locked2', e2ee: 'locked' as const },
    ]
    expect(hideLockedVaultDocs(docs).map((d) => d.id)).toEqual(['plain', 'open', 'shared'])
  })

  it('잠김이 없으면 받은 배열 그대로', () => {
    const docs = [{ id: 'a' }, { id: 'b', e2ee: 'open' as const }]
    expect(hideLockedVaultDocs(docs)).toBe(docs)
  })
})

describe('F-4003 U2 folderLooksEmpty', () => {
  const folders = [
    { id: 'vault', parentId: null, e2ee: true as const },
    { id: 'vaultEmpty', parentId: null, e2ee: true as const },
    { id: 'plain', parentId: null },
    { id: 'plainWithSub', parentId: null },
    { id: 'sub', parentId: 'plainWithSub' },
  ]
  const docs = [
    { folderId: 'vault', e2ee: 'open' as const },
    { folderId: 'plain', e2ee: 'locked' as const },
  ]

  it('문이 locked 인 금고 폴더는 비었든 아니든 false', () => {
    expect(folderLooksEmpty({ folderId: 'vault', docs, folders, gate: 'locked' })).toBe(false)
    expect(folderLooksEmpty({ folderId: 'vaultEmpty', docs, folders, gate: 'locked' })).toBe(false)
  })

  it('같은 금고 폴더를 문 open 에서는 실제 내용대로', () => {
    expect(folderLooksEmpty({ folderId: 'vault', docs, folders, gate: 'open' })).toBe(false)
    expect(folderLooksEmpty({ folderId: 'vaultEmpty', docs, folders, gate: 'open' })).toBe(true)
  })

  it('일반 폴더 안에 잠긴 문서만 → true, 하위 폴더가 있으면 false', () => {
    expect(folderLooksEmpty({ folderId: 'plain', docs, folders, gate: 'locked' })).toBe(true)
    expect(folderLooksEmpty({ folderId: 'plain', docs, folders, gate: 'open' })).toBe(true)
    expect(folderLooksEmpty({ folderId: 'plainWithSub', docs, folders, gate: 'locked' })).toBe(false)
  })
})

describe('F-4003 U3 vaultFolderGate·visibleOpenFolderIds', () => {
  it.each<[E2eeStatus, string]>([
    ['open', 'open'],
    ['none', 'none'],
    ['unknown', 'locked'],
    ['loading', 'locked'],
    ['locked', 'locked'],
    ['unavailable', 'locked'],
  ])('%s → %s', (status, gate) => {
    expect(vaultFolderGate(status)).toBe(gate)
  })

  it('vaultNoticeOn — locked·unavailable 만 true', () => {
    const on = (['unknown', 'loading', 'unavailable', 'none', 'locked', 'open'] as const).filter((s) => vaultNoticeOn(s))
    expect(on).toEqual(['unavailable', 'locked'])
  })

  const vaultIds = new Set(['v1', 'v2'])
  const openIds = ['a', 'v1', 'b', 'v2']

  it('locked 면 금고 폴더 id 만 빠진다', () => {
    expect(visibleOpenFolderIds(openIds, vaultIds, 'locked')).toEqual(['a', 'b'])
  })

  it('open·none 은 받은 배열 그대로', () => {
    expect(visibleOpenFolderIds(openIds, vaultIds, 'open')).toBe(openIds)
    expect(visibleOpenFolderIds(openIds, vaultIds, 'none')).toBe(openIds)
  })
})

describe('F-4003 U4 unlockVaultFolder', () => {
  function makeDeps(start: E2eeStatus, afterLoad: E2eeStatus, openResult = true) {
    let status = start
    const deps = {
      getStatus: () => status,
      load: vi.fn(async () => {
        status = afterLoad
      }),
      requestOpen: vi.fn(async () => openResult),
      expand: vi.fn(),
      notifyUnavailable: vi.fn(),
    }
    return deps
  }

  it('open → expand 만', async () => {
    const deps = makeDeps('open', 'open')
    await unlockVaultFolder('f', deps)
    expect(deps.expand).toHaveBeenCalledWith('f')
    expect(deps.load).not.toHaveBeenCalled()
    expect(deps.requestOpen).not.toHaveBeenCalled()
    expect(deps.notifyUnavailable).not.toHaveBeenCalled()
  })

  it('unknown → load 뒤 none → expand, requestOpen 안 부름', async () => {
    const deps = makeDeps('unknown', 'none')
    await unlockVaultFolder('f', deps)
    expect(deps.load).toHaveBeenCalledTimes(1)
    expect(deps.expand).toHaveBeenCalledWith('f')
    expect(deps.requestOpen).not.toHaveBeenCalled()
  })

  it('unknown → locked, requestOpen true → expand', async () => {
    const deps = makeDeps('unknown', 'locked', true)
    await unlockVaultFolder('f', deps)
    expect(deps.requestOpen).toHaveBeenCalledTimes(1)
    expect(deps.expand).toHaveBeenCalledWith('f')
  })

  it('unknown → locked, requestOpen false → 아무것도', async () => {
    const deps = makeDeps('unknown', 'locked', false)
    await unlockVaultFolder('f', deps)
    expect(deps.requestOpen).toHaveBeenCalledTimes(1)
    expect(deps.expand).not.toHaveBeenCalled()
    expect(deps.notifyUnavailable).not.toHaveBeenCalled()
  })

  it('unavailable → load 뒤 그대로 → notifyUnavailable, requestOpen 안 부름', async () => {
    const deps = makeDeps('unavailable', 'unavailable')
    await unlockVaultFolder('f', deps)
    expect(deps.load).toHaveBeenCalledTimes(1)
    expect(deps.notifyUnavailable).toHaveBeenCalledTimes(1)
    expect(deps.requestOpen).not.toHaveBeenCalled()
    expect(deps.expand).not.toHaveBeenCalled()
  })

  it('unavailable → load 뒤 locked → requestOpen', async () => {
    const deps = makeDeps('unavailable', 'locked', false)
    await unlockVaultFolder('f', deps)
    expect(deps.requestOpen).toHaveBeenCalledTimes(1)
    expect(deps.notifyUnavailable).not.toHaveBeenCalled()
  })
})

describe('F-4003 U5 firstListedDocId', () => {
  it('맨 앞 둘이 잠김 → 셋째 id', () => {
    expect(firstListedDocId([{ id: 'a', e2ee: 'locked' }, { id: 'b', e2ee: 'locked' }, { id: 'c' }])).toBe('c')
  })

  it('잠김뿐 → null', () => {
    expect(firstListedDocId([{ id: 'a', e2ee: 'locked' }])).toBeNull()
    expect(firstListedDocId([])).toBeNull()
  })
})

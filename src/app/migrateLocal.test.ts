import { describe, it, expect, vi } from 'vitest'
import { migrateLocalIfNeeded, type LocalSnapshot } from './migrateLocal'
import type { Doc, Folder } from '../types'
import { GUIDE_DOC_TITLE, GUIDE_DOC_CONTENT_CRLF } from './guideDoc'

function makeFolder(overrides: Partial<Folder> = {}): Folder {
  return { id: 'f1', name: '폴더', parentId: null, createdAt: 1, updatedAt: 1, ...overrides }
}

function makeDoc(overrides: Partial<Doc> = {}): Doc {
  return {
    id: 'd1',
    title: '제목',
    content: '내용',
    lineEnding: 'crlf',
    createdAt: 1,
    updatedAt: 2,
    folderId: null,
    pinnedAt: null,
    ...overrides,
  }
}

function makeDeps(overrides: Partial<Parameters<typeof migrateLocalIfNeeded>[0]> = {}) {
  const prefs = new Map<string, string>()
  const calls: string[] = []
  const notice = vi.fn((n) => calls.push(`notice:${n.type}`))
  const importLocal = vi.fn(async (input: LocalSnapshot) => {
    calls.push('importLocal')
    return { importedCount: input.docs.length }
  })
  const afterImport = vi.fn(async () => {
    calls.push('afterImport')
  })
  return {
    calls,
    prefs,
    notice,
    importLocal,
    afterImport,
    deps: {
      userId: 'u1',
      getPref: (key: string, fallback: string) => prefs.get(key) ?? fallback,
      setPref: (key: string, value: string) => {
        calls.push('setPref')
        prefs.set(key, value)
      },
      readLocal: vi.fn(async (): Promise<LocalSnapshot> => ({ folders: [], docs: [] })),
      importLocal,
      notice,
      afterImport,
      ...overrides,
    },
  }
}

describe('migrateLocalIfNeeded', () => {
  it('빈 로컬이면 옮길 것 없이 기록만 한다', async () => {
    const { deps, prefs, importLocal, notice } = makeDeps({
      readLocal: vi.fn(async () => ({ folders: [], docs: [] })),
    })
    await migrateLocalIfNeeded(deps)
    expect(prefs.get('md.localMigrated')).toBe('u1')
    expect(importLocal).not.toHaveBeenCalled()
    expect(notice).not.toHaveBeenCalled()
  })

  it('이미 옮겼으면(같은 사용자) 아무것도 읽지 않는다', async () => {
    const readLocal = vi.fn(async () => ({ folders: [], docs: [makeDoc()] }))
    const { deps, importLocal } = makeDeps({ readLocal })
    deps.getPref = () => 'u1'
    await migrateLocalIfNeeded(deps)
    expect(readLocal).not.toHaveBeenCalled()
    expect(importLocal).not.toHaveBeenCalled()
  })

  it('다른 계정으로 로그인하면 다시 옮긴다', async () => {
    const { deps, prefs, importLocal } = makeDeps({
      readLocal: vi.fn(async () => ({ folders: [], docs: [makeDoc()] })),
    })
    prefs.set('md.localMigrated', 'other-user')
    await migrateLocalIfNeeded(deps)
    expect(importLocal).toHaveBeenCalledTimes(1)
    expect(prefs.get('md.localMigrated')).toBe('u1')
  })

  it('폴더 2단계·고정 문서를 id 그대로 넘긴다', async () => {
    const parent = makeFolder({ id: 'p', name: '상위', parentId: null })
    const child = makeFolder({ id: 'c', name: '하위', parentId: 'p' })
    const pinnedDoc = makeDoc({ id: 'd-pinned', folderId: 'c', pinnedAt: 999 })
    const { deps, importLocal } = makeDeps({
      readLocal: vi.fn(async () => ({ folders: [child, parent], docs: [pinnedDoc] })),
    })
    await migrateLocalIfNeeded(deps)
    expect(importLocal).toHaveBeenCalledWith({ folders: [child, parent], docs: [pinnedDoc] })
    const [{ folders, docs }] = importLocal.mock.calls[0]
    expect(folders.map((f: Folder) => f.id)).toEqual(['c', 'p']) // 순서는 이 함수가 바꾸지 않는다(부모 먼저 정렬은 serverStore.importLocal 책임)
    expect(docs[0].id).toBe('d-pinned')
    expect(docs[0].pinnedAt).toBe(999)
  })

  it('손대지 않은 사용법 문서는 옮기지 않고, 고친 사용법 문서는 옮긴다', async () => {
    const untouched = makeDoc({ id: 'g1', title: GUIDE_DOC_TITLE, content: GUIDE_DOC_CONTENT_CRLF })
    const edited = makeDoc({ id: 'g2', title: GUIDE_DOC_TITLE, content: `${GUIDE_DOC_CONTENT_CRLF}메모` })
    const { deps, importLocal } = makeDeps({
      readLocal: vi.fn(async () => ({ folders: [], docs: [untouched, edited, makeDoc()] })),
    })
    await migrateLocalIfNeeded(deps)
    expect(importLocal.mock.calls[0][0].docs.map((d: Doc) => d.id)).toEqual(['g2', 'd1'])
  })

  it('손대지 않은 사용법 문서만 있으면 옮길 것 없이 기록만 한다', async () => {
    const { deps, prefs, importLocal, notice } = makeDeps({
      readLocal: vi.fn(async () => ({ folders: [], docs: [makeDoc({ title: GUIDE_DOC_TITLE, content: GUIDE_DOC_CONTENT_CRLF })] })),
    })
    await migrateLocalIfNeeded(deps)
    expect(prefs.get('md.localMigrated')).toBe('u1')
    expect(importLocal).not.toHaveBeenCalled()
    expect(notice).not.toHaveBeenCalled()
  })

  it('캐시 쓰기 실패면 기록하지 않고 오류 알림', async () => {
    const { deps, prefs, notice } = makeDeps({
      readLocal: vi.fn(async () => ({ folders: [], docs: [makeDoc()] })),
      importLocal: vi.fn(async () => {
        throw new Error('idb 실패')
      }),
    })
    await migrateLocalIfNeeded(deps)
    expect(prefs.get('md.localMigrated')).toBeUndefined()
    expect(notice).toHaveBeenCalledWith({ type: 'error', message: '로컬 문서를 옮기지 못했습니다. 다시 시도하려면 새로고침하세요.' })
  })

  it('성공 순서: 진행 알림 → importLocal → 기록 → 새로고침 → 완료 알림', async () => {
    const { deps, calls } = makeDeps({
      readLocal: vi.fn(async () => ({ folders: [], docs: [makeDoc(), makeDoc({ id: 'd2' })] })),
    })
    await migrateLocalIfNeeded(deps)
    expect(calls).toEqual(['notice:info', 'importLocal', 'setPref', 'afterImport', 'notice:info'])
  })
})

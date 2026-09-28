import { describe, expect, it } from 'vitest'
import { toPaletteDocs, prepareDocIndex, filterPaletteDocs, planPaletteCreate, PALETTE_DOC_LIMIT, type PaletteDocSource } from '../../../src/app/paletteDocs'
import { folderPathMap } from '../../../src/app/searchIndex'
import { createWikiResolver } from '../../../src/lib/wikiResolve'
import type { Folder } from '../../../src/types'

// U5 (F-2053.md 11.1)
describe('toPaletteDocs — U5', () => {
  const folders: Folder[] = [{ id: 'f-업무', name: '업무', parentId: null, createdAt: 0, updatedAt: 0 }]
  const folderWithChild: Folder[] = [
    ...folders,
    { id: 'f-회의', name: '회의', parentId: 'f-업무', createdAt: 0, updatedAt: 0 },
  ]

  const docs: PaletteDocSource[] = [
    { id: 'd-가', title: '가', folderId: null, updatedAt: 1 },
    { id: 'd-나', title: '나', folderId: 'f-회의', updatedAt: 2 },
    { id: 'd-blank', title: '  ', folderId: null, updatedAt: 3 },
    { id: 'd-locked', title: '', folderId: null, updatedAt: 4, e2ee: 'locked' },
    { id: 'd-다', title: '다', folderId: null, updatedAt: 5, e2ee: 'open' },
    { id: 'd-라', title: '라', folderId: 'no-such-folder', updatedAt: 6, role: 'view' },
    { id: 'd-e1', title: 'e1', folderId: null, updatedAt: 7 },
    { id: 'd-e2', title: 'e2', folderId: null, updatedAt: 8 },
    { id: 'd-e3', title: 'e3', folderId: null, updatedAt: 9 },
    { id: 'd-e4', title: 'e4', folderId: null, updatedAt: 10 },
    { id: 'd-e5', title: 'e5', folderId: null, updatedAt: 11 },
    { id: 'd-e6', title: 'e6', folderId: null, updatedAt: 12 },
  ]

  const { all, recent } = toPaletteDocs({ docs, folderPaths: folderPathMap(folderWithChild), currentDocId: 'd-가' })

  it('잠긴 문서는 all 에 없다', () => {
    expect(all.some((d) => d.id === 'd-locked')).toBe(false)
  })

  it('빈 제목은 제목 없는 문서', () => {
    expect(all.find((d) => d.id === 'd-blank')!.title).toBe('제목 없는 문서')
  })

  it('폴더 경로 — 나.folderPath === "업무 / 회의"', () => {
    expect(all.find((d) => d.id === 'd-나')!.folderPath).toBe('업무 / 회의')
  })

  it('공유받은 문서 — shared true, folderPath 빈 문자열(내 폴더 목록에 없는 folderId)', () => {
    const 라 = all.find((d) => d.id === 'd-라')!
    expect(라.shared).toBe(true)
    expect(라.folderPath).toBe('')
  })

  it('recent — 가·잠긴 문서·라를 빼고 입력 순서 앞 5개', () => {
    expect(recent.map((d) => d.id)).toEqual(['d-나', 'd-blank', 'd-다', 'd-e1', 'd-e2'])
  })
})

// U6 (F-2053.md 11.1)
describe('filterPaletteDocs — U6', () => {
  function doc(id: string, title: string, folderPath = ''): { id: string; title: string; folderPath: string; shared: boolean } {
    return { id, title, folderPath, shared: false }
  }
  const docs = [
    doc('회의록', '회의록'),
    doc('주간 회의', '주간 회의'),
    doc('기획', '기획', '회의'),
    doc('가계부', '가계부'),
    doc('강아지', '강아지'),
  ]
  const index = prepareDocIndex(docs)

  it("'회의' — ① 회의록 → ② 주간 회의 → ③ 기획(경로)", () => {
    expect(filterPaletteDocs(index, '회의', 6).map((d) => d.id)).toEqual(['회의록', '주간 회의', '기획'])
  })

  it("'ㅎㅇ' 초성 — 같은 순서, 모두 느슨한 비교", () => {
    expect(filterPaletteDocs(index, 'ㅎㅇ', 6).map((d) => d.id)).toEqual(['회의록', '주간 회의', '기획'])
  })

  it("'회의/기획' — 기획 하나(경로+제목 각각)", () => {
    expect(filterPaletteDocs(index, '회의/기획', 6).map((d) => d.id)).toEqual(['기획'])
  })

  it("'가' — 가계부(①·plain) → 강아지(①·loose) → 주간 회의(②·loose, 받침 규칙)", () => {
    expect(filterPaletteDocs(index, '가', 6).map((d) => d.id)).toEqual(['가계부', '강아지', '주간 회의'])
  })

  it('문서 10개 모두 맞는 조각 — limit 6', () => {
    const many = Array.from({ length: 10 }, (_, i) => doc(`문서 ${i + 1}`, `문서 ${i + 1}`))
    const manyIndex = prepareDocIndex(many)
    expect(filterPaletteDocs(manyIndex, '문서', 6)).toHaveLength(PALETTE_DOC_LIMIT)
  })

  it('텍스트가 비면 빈 배열', () => {
    expect(filterPaletteDocs(index, '', 6)).toEqual([])
  })
})

// U7 (F-2053.md 11.1)
describe('planPaletteCreate — U7', () => {
  const folders = [{ id: 'f-업무', name: '업무', parentId: null }]
  const wikiDocs = [
    { id: 'd1', title: '여행 계획', folderId: null },
    { id: 'd2', title: 'Meeting', folderId: null },
  ]
  const resolver = createWikiResolver(wikiDocs, folders)
  const folderPaths = folderPathMap(folders.map((f) => ({ ...f, createdAt: 0, updatedAt: 0 })))
  const folderPathOf = (folderId: string | null) => (folderId ? folderPaths.get(folderId) ?? '' : '')
  const env = { resolver, sourceFolderId: null, fallbackFolderId: null, folderPathOf }

  it.each(['', '  ', 'ㅅㅁㅅ', 'ㅎ ㅎ', '여행 계획', '여행 계획.md', 'meeting'])('%p → null', (text) => {
    expect(planPaletteCreate(text, env)).toBeNull()
  })

  it("'여행' → 최상위 만들기 계획", () => {
    expect(planPaletteCreate('여행', env)).toEqual({ title: '여행', folderId: null, folderPath: '' })
  })

  it("'업무/주간 보고' → 업무 폴더에 주간 보고", () => {
    expect(planPaletteCreate('업무/주간 보고', env)).toEqual({ title: '주간 보고', folderId: 'f-업무', folderPath: '업무' })
  })

  it("'없는/제목' → 폴더 없이 원문 그대로 제목", () => {
    const plan = planPaletteCreate('없는/제목', env)
    expect(plan?.title).toBe('없는/제목')
    expect(plan?.folderId).toBeNull()
  })

  it('500자는 만든다, 501자는 null', () => {
    expect(planPaletteCreate('가'.repeat(500), env)).not.toBeNull()
    expect(planPaletteCreate('가'.repeat(501), env)).toBeNull()
  })
})

// U9 (F-2053.md 11.1)
describe('filterPaletteDocs 성능 — U9', () => {
  it('합성 문서 5,000개 — 준비 100ms 미만, 검색어별 평균 16ms 미만', () => {
    const many: PaletteDocSource[] = Array.from({ length: 5000 }, (_, i) => ({
      id: `id-${i}`,
      title: i % 3 === 0 ? `회의 ${i}` : `Meeting note ${i}`,
      folderId: null,
      updatedAt: i,
    }))
    const folders: Folder[] = []
    const start = performance.now()
    const { all } = toPaletteDocs({ docs: many, folderPaths: folderPathMap(folders), currentDocId: null })
    const index = prepareDocIndex(all)
    const prepMs = performance.now() - start

    expect(prepMs).toBeLessThan(100)

    const queries = ['회의', 'ㅅㅁㅅ', 'ㅎㅇ ㄹ', '템프', 'zzzz', 'a', '업무/기획', 'ㄳ', 'Meeting n', '프로젝트 ㄱ']
    for (const q of queries) {
      const qStart = performance.now()
      for (let i = 0; i < 20; i++) filterPaletteDocs(index, q, PALETTE_DOC_LIMIT)
      const avg = (performance.now() - qStart) / 20
      expect(avg).toBeLessThan(16)
    }
  })
})

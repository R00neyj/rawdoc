// specs/features/F-2007.md 16.1 U1~U11 (F-292 B7)
import { describe, it, expect } from 'vitest'
import { parseSearchQuery } from './docSearch'
import {
  MAP_FILTER_DEFAULT,
  MAP_FILTER_ROOT,
  MAP_HOPS_MAX,
  normalizeMapFilter,
  expandFolders,
  isFilterActive,
  computeVisibleNodes,
  type MapFilterContext,
  type MapFilterDoc,
  type MapFilterFolder,
  type MapFilterNode,
} from './mapFilter'

describe('normalizeMapFilter', () => {
  it('U1 기본값', () => {
    expect(normalizeMapFilter(undefined)).toEqual(MAP_FILTER_DEFAULT)
    expect(normalizeMapFilter({})).toEqual(MAP_FILTER_DEFAULT)
  })

  it('U2 깨진 값 — 전부 기본값으로', () => {
    expect(normalizeMapFilter(null)).toEqual(MAP_FILTER_DEFAULT)
    expect(normalizeMapFilter([1, 2, 3])).toEqual(MAP_FILTER_DEFAULT)
    expect(normalizeMapFilter('x')).toEqual(MAP_FILTER_DEFAULT)
    expect(normalizeMapFilter({ folders: 'x', isolated: 1, hops: '2' })).toEqual(MAP_FILTER_DEFAULT)
  })

  it('U3 hops 자르기', () => {
    expect(normalizeMapFilter({ hops: -1 }).hops).toBe(0)
    expect(normalizeMapFilter({ hops: 9 }).hops).toBe(MAP_HOPS_MAX)
    expect(normalizeMapFilter({ hops: 1.6 }).hops).toBe(2)
    expect(normalizeMapFilter({ hops: NaN }).hops).toBe(0)
  })

  it('U4 folders 정리 — 숫자·객체 항목은 버리고 중복은 하나로', () => {
    const view = normalizeMapFilter({ folders: ['a', 'b', 'a', 1, { x: 1 }, null] })
    expect(view.folders).toEqual(['a', 'b'])
  })
})

describe('expandFolders', () => {
  const folders: MapFilterFolder[] = [
    { id: 'a', parentId: null },
    { id: 'a1', parentId: 'a' },
    { id: 'a1a', parentId: 'a1' },
    { id: 'b', parentId: null },
  ]

  it('U5 부모를 고르면 자손 전부. 고른 것이 없으면 null. 순환 참조여도 안 멈춘다', () => {
    expect(expandFolders([], folders)).toBeNull()
    expect(expandFolders(['a'], folders)).toEqual(new Set(['a', 'a1', 'a1a']))
    expect(expandFolders(['b'], folders)).toEqual(new Set(['b']))

    const cyclic: MapFilterFolder[] = [
      { id: 'x', parentId: 'y' },
      { id: 'y', parentId: 'x' },
    ]
    expect(expandFolders(['x'], cyclic)).toEqual(new Set(['x', 'y']))
  })
})

// A-B-C 사슬 + 고립 D + 끊긴 링크(E, missing) — B 가 E 를 가리킨다
function makeCtx(overrides?: Partial<MapFilterContext>): { ctx: MapFilterContext; docs: MapFilterDoc[] } {
  const nodes: MapFilterNode[] = [
    { id: 'A', missing: false, degree: 1 },
    { id: 'B', missing: false, degree: 2 },
    { id: 'C', missing: false, degree: 1 },
    { id: 'D', missing: false, degree: 0 },
    { id: 'missing:e', missing: true, degree: 1 },
  ]
  const docs: MapFilterDoc[] = [
    { id: 'A', title: '에이', body: '', properties: [{ key: 'tag', value: '일기' }], updatedAt: 0, folderId: 'f1' },
    { id: 'B', title: '비', body: '', properties: null, updatedAt: 0, folderId: 'f2' },
    { id: 'C', title: '씨', body: '', properties: null, updatedAt: 0, folderId: null },
    { id: 'D', title: '디', body: '', properties: null, updatedAt: 0, folderId: null },
  ]
  const docById = new Map(docs.map((d) => [d.id, d]))
  const ctx: MapFilterContext = { nodes, docById, distances: null, ...overrides }
  return { ctx, docs }
}

const EMPTY_QUERY = parseSearchQuery('')

describe('computeVisibleNodes', () => {
  it('U6 고립 문서 — isolated:false 면 degree===0 인 문서 노드만 빠진다. 끊긴 링크는 안 빠진다', () => {
    const { ctx } = makeCtx()
    const out = new Uint8Array(ctx.nodes.length)
    const count = computeVisibleNodes({ ...MAP_FILTER_DEFAULT, isolated: false }, EMPTY_QUERY, null, ctx, out)
    expect(Array.from(out)).toEqual([1, 1, 1, 0, 1])
    expect(count).toBe(4)
  })

  it('U7 끊긴 링크 — broken:false 면 missing 노드가 전부 빠진다. 검색어가 걸리면 broken:true 여도 빠진다', () => {
    const { ctx } = makeCtx()
    const out = new Uint8Array(ctx.nodes.length)
    computeVisibleNodes({ ...MAP_FILTER_DEFAULT, broken: false }, EMPTY_QUERY, null, ctx, out)
    expect(out[4]).toBe(0)

    const out2 = new Uint8Array(ctx.nodes.length)
    computeVisibleNodes(MAP_FILTER_DEFAULT, parseSearchQuery('에이'), null, ctx, out2)
    expect(out2[4]).toBe(0)
  })

  it('U8 폴더 — 고른 폴더 밖 문서가 빠진다. MAP_FILTER_ROOT 를 고르면 folderId===null 인 문서만 남는다', () => {
    const { ctx } = makeCtx()
    const allowed = new Set(['f1'])
    const out = new Uint8Array(ctx.nodes.length)
    computeVisibleNodes(MAP_FILTER_DEFAULT, EMPTY_QUERY, allowed, ctx, out)
    expect(Array.from(out)).toEqual([1, 0, 0, 0, 0])

    const rootOnly = new Set([MAP_FILTER_ROOT])
    const out2 = new Uint8Array(ctx.nodes.length)
    computeVisibleNodes(MAP_FILTER_DEFAULT, EMPTY_QUERY, rootOnly, ctx, out2)
    expect(Array.from(out2)).toEqual([0, 0, 1, 1, 0])
  })

  it('U9 검색어 — tag: 프로퍼티 필터, 본문 낱말, 제목 낱말이 각각 맞는다', () => {
    const { ctx } = makeCtx()
    const out = new Uint8Array(ctx.nodes.length)
    computeVisibleNodes(MAP_FILTER_DEFAULT, parseSearchQuery('tag:일기'), null, ctx, out)
    expect(Array.from(out)).toEqual([1, 0, 0, 0, 0])

    const out2 = new Uint8Array(ctx.nodes.length)
    computeVisibleNodes(MAP_FILTER_DEFAULT, parseSearchQuery('씨'), null, ctx, out2)
    expect(Array.from(out2)).toEqual([0, 0, 1, 0, 0])
  })

  it('U10 몇 다리 — 사슬 A-B-C-D 에서 중심 A', () => {
    const { ctx } = makeCtx({ distances: Int32Array.from([0, 1, 2, -1, 1]) })
    const out1 = new Uint8Array(ctx.nodes.length)
    computeVisibleNodes({ ...MAP_FILTER_DEFAULT, hops: 1 }, EMPTY_QUERY, null, ctx, out1)
    expect(Array.from(out1)).toEqual([1, 1, 0, 0, 1])

    const out2 = new Uint8Array(ctx.nodes.length)
    computeVisibleNodes({ ...MAP_FILTER_DEFAULT, hops: 2 }, EMPTY_QUERY, null, ctx, out2)
    expect(Array.from(out2)).toEqual([1, 1, 1, 0, 1])

    // distances 가 null 이면 hops 가 무시된다
    const { ctx: ctxNoDist } = makeCtx()
    const out3 = new Uint8Array(ctxNoDist.nodes.length)
    const count3 = computeVisibleNodes({ ...MAP_FILTER_DEFAULT, hops: 1 }, EMPTY_QUERY, null, ctxNoDist, out3)
    expect(count3).toBe(5)
  })

  it('U11 겹치기와 반환값 — broken:false + tag:일기 + hops:1 을 동시에 걸면 셋을 다 만족하는 것만 남는다', () => {
    const { ctx } = makeCtx({ distances: Int32Array.from([0, 1, 2, -1, 1]) })
    const filter = { ...MAP_FILTER_DEFAULT, broken: false, hops: 1 }
    const query = parseSearchQuery('tag:일기')
    const out = new Uint8Array(ctx.nodes.length)
    const count = computeVisibleNodes(filter, query, null, ctx, out)
    expect(Array.from(out)).toEqual([1, 0, 0, 0, 0])
    expect(count).toBe(1)
    expect(out.reduce((a, b) => a + b, 0)).toBe(count)

    expect(isFilterActive(MAP_FILTER_DEFAULT, EMPTY_QUERY)).toBe(false)
    expect(isFilterActive({ ...MAP_FILTER_DEFAULT, folders: ['a'] }, EMPTY_QUERY)).toBe(true)
    expect(isFilterActive({ ...MAP_FILTER_DEFAULT, isolated: false }, EMPTY_QUERY)).toBe(true)
    expect(isFilterActive({ ...MAP_FILTER_DEFAULT, broken: false }, EMPTY_QUERY)).toBe(true)
    expect(isFilterActive({ ...MAP_FILTER_DEFAULT, hops: 1 }, EMPTY_QUERY)).toBe(true)
    expect(isFilterActive(MAP_FILTER_DEFAULT, parseSearchQuery('x'))).toBe(true)
  })
})

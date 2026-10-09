import { describe, it, expect } from 'vitest'
import { resolveInitialDoc } from '../../../src/app/resolveInitialDoc'

const docs = [{ id: 'b' }, { id: 'a' }] // updatedAt 내림차순 가정: b, a

describe('resolveInitialDoc', () => {
  it('hashDocId 가 docs 에 있으면 그것을 연다', () => {
    expect(resolveInitialDoc({ hashDocId: 'a', lastDocId: 'b', docs })).toEqual({
      docId: 'a',
      notFound: false,
    })
  })

  it('hashDocId 가 docs 에 없고 lastDocId 가 있으면 lastDocId, notFound true', () => {
    expect(resolveInitialDoc({ hashDocId: '없음', lastDocId: 'a', docs })).toEqual({
      docId: 'a',
      notFound: true,
    })
  })

  it('hashDocId 가 docs 에 없고 lastDocId 도 없으면 docs[0], notFound true', () => {
    expect(resolveInitialDoc({ hashDocId: '없음', lastDocId: null, docs })).toEqual({
      docId: 'b',
      notFound: true,
    })
  })

  it('hashDocId 가 없고 lastDocId 가 있으면 lastDocId', () => {
    expect(resolveInitialDoc({ hashDocId: null, lastDocId: 'a', docs })).toEqual({
      docId: 'a',
      notFound: false,
    })
  })

  it('hashDocId 도 lastDocId 도 없으면 docs[0]', () => {
    expect(resolveInitialDoc({ hashDocId: null, lastDocId: null, docs })).toEqual({
      docId: 'b',
      notFound: false,
    })
  })

  it('lastDocId 가 docs 에 없으면 docs[0] 으로 대체된다', () => {
    expect(resolveInitialDoc({ hashDocId: null, lastDocId: '없음', docs })).toEqual({
      docId: 'b',
      notFound: false,
    })
  })

  it('docs 가 비어 있으면 null, hashDocId 가 있었으면 notFound true', () => {
    expect(resolveInitialDoc({ hashDocId: 'x', lastDocId: null, docs: [] })).toEqual({
      docId: null,
      notFound: true,
    })
  })

  it('docs 가 비어 있고 hashDocId 도 없으면 null, notFound false', () => {
    expect(resolveInitialDoc({ hashDocId: null, lastDocId: null, docs: [] })).toEqual({
      docId: null,
      notFound: false,
    })
  })
})

describe('F-4003 U6 resolveInitialDoc 잠긴 금고 문서', () => {
  const withLocked = [{ id: 'L1', e2ee: 'locked' as const }, { id: 'L2', e2ee: 'locked' as const }, { id: 'o', e2ee: 'open' as const }, { id: 'p' }]

  it('해시가 잠긴 문서면 그 id (P1)', () => {
    expect(resolveInitialDoc({ hashDocId: 'L2', lastDocId: null, docs: withLocked })).toEqual({ docId: 'L2', notFound: false })
  })

  it('해시 없음 + lastDocId 가 잠긴 문서 → 안 잠긴 첫 문서', () => {
    expect(resolveInitialDoc({ hashDocId: null, lastDocId: 'L1', docs: withLocked })).toEqual({ docId: 'o', notFound: false })
  })

  it('해시 못 찾음 → notFound + 안 잠긴 첫 문서', () => {
    expect(resolveInitialDoc({ hashDocId: '없음', lastDocId: null, docs: withLocked })).toEqual({ docId: 'o', notFound: true })
  })

  it('잠긴 문서뿐이면 null (홈)', () => {
    expect(resolveInitialDoc({ hashDocId: null, lastDocId: 'L1', docs: withLocked.slice(0, 2) })).toEqual({ docId: null, notFound: false })
  })
})

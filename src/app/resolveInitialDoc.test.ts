import { describe, it, expect } from 'vitest'
import { resolveInitialDoc } from './resolveInitialDoc'

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

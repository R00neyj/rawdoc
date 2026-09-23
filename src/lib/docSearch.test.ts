// specs/features/F-285.md 10장 A1~A26
import { describe, expect, it } from 'vitest'
import {
  buildSnippet,
  foldCase,
  hasPropertyKey,
  highlightParts,
  matchDoc,
  matchesFilters,
  normalizeForSearch,
  parseSearchQuery,
  searchDocs,
  type ParsedQuery,
  type SearchDocInput,
  type SearchProperty,
} from './docSearch'

function q(raw: string): ParsedQuery {
  return parseSearchQuery(raw)
}

function doc(overrides: Partial<SearchDocInput> = {}): SearchDocInput {
  return {
    id: 'd1',
    title: '',
    body: '',
    properties: [],
    updatedAt: 0,
    ...overrides,
  }
}

const NO_LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/

describe('normalizeForSearch', () => {
  it('NFD 를 NFC 로 정규화한다', () => {
    expect(normalizeForSearch('회고'.normalize('NFD'))).toBe('회고'.normalize('NFC'))
  })
})

describe('parseSearchQuery — 기본·따옴표·빈 쿼리 (A1~A4)', () => {
  it('A1 기본 파싱', () => {
    const result = q('tag:일기 회고')
    expect(result.terms).toEqual(['회고'])
    expect(result.filters).toEqual([{ key: 'tag', value: '일기' }])
    expect(result.isEmpty).toBe(false)
  })

  it('A2 따옴표', () => {
    expect(q('"주간 회고"')).toMatchObject({ terms: ['주간 회고'], filters: [] })
    expect(q('"주간 회고')).toMatchObject({ terms: ['주간 회고'], filters: [] })
    expect(q('""')).toMatchObject({ terms: [], filters: [] })
    expect(q('"" 회고')).toMatchObject({ terms: ['회고'], filters: [] })
  })

  it('A3 빈 쿼리', () => {
    expect(q('')).toMatchObject({ terms: [], filters: [], isEmpty: true })
    expect(q('   ')).toMatchObject({ terms: [], filters: [], isEmpty: true })
  })

  it('A4 값 없는 필터', () => {
    expect(q('tag:').filters).toEqual([{ key: 'tag', value: '' }])
    expect(q('tag:""').filters).toEqual([{ key: 'tag', value: '' }])
    expect(q('tag:  ').filters).toEqual([{ key: 'tag', value: '' }])
    expect(q('tag:').terms).toEqual([])
    expect(q('tag:""').terms).toEqual([])
    expect(q('tag:  ').terms).toEqual([])
  })
})

describe('parseSearchQuery — 경계 사례 (A5~A8)', () => {
  it('A5 본문 검색어로 떨어지는 것', () => {
    expect(q(':foo')).toMatchObject({ terms: [':foo'], filters: [] })
    expect(q('my.key:1')).toMatchObject({ terms: ['my.key:1'], filters: [] })
    expect(q('http://a.com')).toMatchObject({ terms: ['http://a.com'], filters: [] })
    expect(q('https://a.com/b')).toMatchObject({ terms: ['https://a.com/b'], filters: [] })
  })

  it('A6 탈출구', () => {
    expect(q('"tag:일기"')).toMatchObject({ terms: ['tag:일기'], filters: [] })
  })

  it('A7 콜론·대소문자·키 글자', () => {
    expect(q('a:b:c').filters).toEqual([{ key: 'a', value: 'b:c' }])
    expect(q('time:10:30').filters).toEqual([{ key: 'time', value: '10:30' }])
    expect(q('Tag:Diary').filters).toEqual([{ key: 'tag', value: 'diary' }])
    expect(q('x-y_z:1').filters).toEqual([{ key: 'x-y_z', value: '1' }])
    expect(q('tag: 일기')).toMatchObject({ terms: ['일기'], filters: [{ key: 'tag', value: '' }] })
  })

  it('A8 중복 제거', () => {
    expect(q('회고 회고').terms).toEqual(['회고'])
    expect(q('tag:일기 tag:일기').filters).toEqual([{ key: 'tag', value: '일기' }])
    expect(q('tags:a tags:b').filters).toEqual([
      { key: 'tags', value: 'a' },
      { key: 'tags', value: 'b' },
    ])
  })
})

describe('parseSearchQuery — NFC 정규화 (A9)', () => {
  it('검색어를 NFC 로 정규화한다', () => {
    const term = '회고'.normalize('NFD')
    expect([...term].map((c) => c.codePointAt(0))).toEqual([0x1112, 0x116c, 0x1100, 0x1169])
    const result = q(term)
    expect(result.terms[0]).toBe('회고'.normalize('NFC'))
    expect(result.terms[0]).toHaveLength(2)
    expect([...result.terms[0]].map((c) => c.codePointAt(0))).toEqual([0xd68c, 0xace0])
  })
})

describe('foldCase — 길이 보존 (A10)', () => {
  it('길이가 달라지는 글자는 그대로 둔다', () => {
    const i = 'İ' // İ
    expect(foldCase(i)).toBe(i)
    expect(foldCase(i)).toHaveLength(i.length)
  })

  it('보통 대문자는 소문자로 바뀐다', () => {
    expect(foldCase('ABC')).toBe('abc')
  })

  it('그리스어 종성 시그마도 길이가 같아 정상 변환된다', () => {
    expect(foldCase('ΑΣ')).toBe('ας')
    expect(foldCase('ΑΣ')).toHaveLength(2)
  })
})

describe('matchesFilters — 문자열·배열 값 (A11)', () => {
  const props: SearchProperty[] = [
    { key: 'tags', value: ['a', 'b'] },
    { key: 'title', value: '주간 보고' },
  ]

  it('배열 값 원소 매치', () => {
    expect(matchesFilters(props, q('tags:a').filters)).toBe(true)
    expect(matchesFilters(props, q('tags:b').filters)).toBe(true)
    expect(matchesFilters(props, q('tags:a tags:b').filters)).toBe(true)
    expect(matchesFilters(props, q('tags:c').filters)).toBe(false)
  })

  it('문자열 값은 완전일치', () => {
    expect(matchesFilters(props, q('title:"주간 보고"').filters)).toBe(true)
    expect(matchesFilters(props, q('title:주간').filters)).toBe(false)
  })
})

describe('matchesFilters — 인라인 배열 보정 (A12)', () => {
  it('대괄호 문자열에서 원소를 뽑는다', () => {
    const props: SearchProperty[] = [{ key: 'tag', value: '[일기, "회고"]' }]
    expect(matchesFilters(props, q('tag:일기').filters)).toBe(true)
    expect(matchesFilters(props, q('tag:회고').filters)).toBe(true)
    expect(matchesFilters(props, q('tag:메모').filters)).toBe(false)
  })

  it('원본 문자열도 후보로 남긴다', () => {
    const props: SearchProperty[] = [{ key: 'note', value: '[1, 2]' }]
    expect(matchesFilters(props, q('note:1').filters)).toBe(true)
    expect(matchesFilters(props, q('note:"[1, 2]"').filters)).toBe(true)
  })
})

describe('matchesFilters — 존재 검사·대소문자·null (A13)', () => {
  it('빈 값 필터는 존재 검사', () => {
    const props: SearchProperty[] = [{ key: 'empty', value: '' }]
    expect(matchesFilters(props, q('empty:').filters)).toBe(true)
    expect(matchesFilters(props, q('empty:x').filters)).toBe(false)
  })

  it('키·값 모두 대소문자 구분 안 함', () => {
    const props: SearchProperty[] = [{ key: 'Tags', value: 'A' }]
    expect(matchesFilters(props, q('TAGS:A').filters)).toBe(true)
  })

  it('properties 가 null 이면 필터가 있을 때만 틀린다', () => {
    expect(matchesFilters(null, q('empty:').filters)).toBe(false)
    expect(matchesFilters(null, q('').filters)).toBe(true)
  })

  it('hasPropertyKey', () => {
    const props: SearchProperty[] = [{ key: 'tag', value: '일기' }]
    expect(hasPropertyKey(props, 'tag')).toBe(true)
    expect(hasPropertyKey(props, 'tagg')).toBe(false)
    expect(hasPropertyKey(null, 'tag')).toBe(false)
  })
})

describe('matchDoc — 본문 매칭 AND (A14)', () => {
  const d = doc({ title: '주간 정리', body: '회고 이야기', properties: [] })

  it('제목·본문에 갈라져 있어도 AND 로 맞는다', () => {
    expect(matchDoc(d, q('회고 정리'))).not.toBeNull()
  })

  it('어느 쪽에도 없는 검색어가 있으면 틀린다', () => {
    expect(matchDoc(d, q('회고 없음'))).toBeNull()
  })
})

describe('matchDoc — titleMatched·bodyHit (A15)', () => {
  it('검색어가 제목·본문에 갈라지면 titleMatched 는 false', () => {
    const d = doc({ title: '주간 정리', body: '회고 이야기', properties: [] })
    expect(matchDoc(d, q('회고 정리'))).toMatchObject({ titleMatched: false })
  })

  it('검색어 전부가 제목에 있으면 titleMatched 는 true, 본문에 없으면 bodyHit 은 -1', () => {
    const d = doc({ title: '주간 회고', body: '', properties: [] })
    expect(matchDoc(d, q('회고'))).toEqual({ titleMatched: true, bodyHit: -1 })
  })
})

describe('matchDoc — NFD 본문 × NFC 검색어 (A16)', () => {
  it('정규화된 본문에서 찾는다', () => {
    const body = '나의 회고록'.normalize('NFD').normalize('NFC')
    const d = doc({ title: '', body, properties: [] })
    const term = '회고'.normalize('NFC')
    expect(matchDoc(d, q(term))).not.toBeNull()
    // 대조: NFD 상태였다면 애초에 못 찾았을 것 — 정규화가 실제로 일을 했음을 보인다
    expect('나의 회고록'.normalize('NFD').includes(term)).toBe(false)
  })
})

describe('matchDoc — NFC 본문 × NFD 검색어 (A17)', () => {
  it('검색어 쪽이 NFD 여도 찾는다', () => {
    const body = '나의 회고록'.normalize('NFC')
    const d = doc({ title: '', body, properties: [] })
    const term = '회고'.normalize('NFD')
    expect(matchDoc(d, q(term))).not.toBeNull()
  })
})

describe('searchDocs — 빈 쿼리 (A18)', () => {
  it('문서를 훑지 않고 빈 결과를 낸다', () => {
    const docs = [doc({ id: 'd1', title: '회고', properties: [] })]
    const outcome = searchDocs(docs, q(''))
    expect(outcome.hits).toEqual([])
    expect(outcome.total).toBe(0)
  })
})

describe('searchDocs — 정렬 (A19)', () => {
  it('제목 묶음 먼저, 각 묶음 안 updatedAt 내림차순', () => {
    const docs = [
      doc({ id: 'a10', title: '회고 메모', body: '', properties: [], updatedAt: 10 }),
      doc({ id: 'b20', title: '오늘 회고', body: '', properties: [], updatedAt: 20 }),
      doc({ id: 'c30', title: '없음', body: '회고 있음', properties: [], updatedAt: 30 }),
    ]
    const outcome = searchDocs(docs, q('회고'))
    expect(outcome.hits.map((h) => h.id)).toEqual(['b20', 'a10', 'c30'])
  })
})

describe('searchDocs — 상한 (A20)', () => {
  it('기본 상한 200, truncated 표시, limit 옵션', () => {
    const docs = Array.from({ length: 250 }, (_, i) =>
      doc({ id: `d${i}`, title: '회고', body: '', properties: [], updatedAt: i }),
    )
    const outcome = searchDocs(docs, q('회고'))
    expect(outcome.hits).toHaveLength(200)
    expect(outcome.total).toBe(250)
    expect(outcome.truncated).toBe(true)

    const limited = searchDocs(docs, q('회고'), { limit: 5 })
    expect(limited.hits).toHaveLength(5)
  })
})

describe('searchDocs — 안내용 숫자 (A21)', () => {
  it('missingFilterKeys·unreadableProperties', () => {
    const docs = [
      doc({ id: 'd1', title: '', body: '', properties: [{ key: 'tag', value: '일기' }], updatedAt: 1 }),
      doc({ id: 'd2', title: '', body: '', properties: null, updatedAt: 2 }),
      doc({ id: 'd3', title: '', body: '', properties: [{ key: 'other', value: 'x' }], updatedAt: 3 }),
    ]
    const missing = searchDocs(docs, q('tagg:1'))
    expect(missing.missingFilterKeys).toEqual(['tagg'])

    const found = searchDocs(docs, q('tag:일기'))
    expect(found.missingFilterKeys).toEqual([])
    expect(found.unreadableProperties).toBe(1)

    const noFilter = searchDocs(docs, q('아무거나'))
    expect(noFilter.unreadableProperties).toBe(0)
  })
})

describe('searchDocs·buildSnippet — 공유받은 문서 (A22)', () => {
  it('body 가 빈 문서도 제목으로 걸린다', () => {
    const docs = [doc({ id: 'd1', title: '회고 공유', body: '', properties: null, updatedAt: 1 })]
    const outcome = searchDocs(docs, q('회고'))
    expect(outcome.hits).toEqual([{ id: 'd1', titleMatched: true, bodyHit: -1 }])
  })

  it("buildSnippet('', q) 는 빈 배열", () => {
    expect(buildSnippet('', q('회고'))).toEqual([])
  })
})

describe('buildSnippet — 창·말줄임 (A23)', () => {
  it('매치 앞 30자·뒤 70자, 앞뒤에 말줄임', () => {
    const source = '가'.repeat(50) + '회고' + '나'.repeat(200)
    const parts = buildSnippet(source, q('회고'))
    expect(parts).toEqual([
      { text: '…' + '가'.repeat(30), hit: false },
      { text: '회고', hit: true },
      { text: '나'.repeat(70) + '…', hit: false },
    ])
  })

  it('매치가 맨 앞이면 앞 말줄임이 없다', () => {
    const source = '회고' + '나'.repeat(200)
    const parts = buildSnippet(source, q('회고'))
    expect(parts[0]).toEqual({ text: '회고', hit: true })
  })

  it('창을 넘지 않는 짧은 본문은 말줄임이 없다', () => {
    const parts = buildSnippet('짧은 회고', q('회고'))
    expect(parts).toEqual([
      { text: '짧은 ', hit: false },
      { text: '회고', hit: true },
    ])
  })
})

describe('highlightParts — 공백 접기·강조 위치 (A24)', () => {
  it('공백이 여러 개여도 하나로 접히고 hit 조각 밖에 남는다', () => {
    const expected = [
      { text: '주간 ', hit: false },
      { text: '회고', hit: true },
      { text: ' 정리', hit: false },
    ]
    expect(highlightParts('주간  회고 정리', q('회고'))).toEqual(expected)
    expect(highlightParts('주간\n회고\n정리', q('회고'))).toEqual(expected)
  })
})

describe('highlightParts — 겹치는·맞닿은 매치 (A25)', () => {
  it('겹치는 범위를 하나로 합친다', () => {
    expect(highlightParts('회고록', q('회고 고록'))).toEqual([{ text: '회고록', hit: true }])
  })

  it('맞닿은 범위도 하나로 합친다', () => {
    expect(highlightParts('회고록', q('회고 록'))).toEqual([{ text: '회고록', hit: true }])
  })
})

describe('buildSnippet — 검색어 없는 발췌·서로게이트 보호 (A26)', () => {
  it('필터만 있는 검색은 본문 앞 100자, hit 조각이 없다', () => {
    const body = '가'.repeat(150)
    const parts = buildSnippet(body, q('tag:일기'))
    expect(parts.every((p) => p.hit === false)).toBe(true)
    expect(parts.map((p) => p.text).join('').replace(/…$/, '')).toBe('가'.repeat(100))
  })

  it('이모지가 반으로 잘리지 않는다', () => {
    const source = 'x' + '😀'.repeat(20) + '회고' + '😀'.repeat(60)
    const parts = buildSnippet(source, q('회고'))
    const joined = parts.map((p) => p.text).join('')
    expect(NO_LONE_SURROGATE.test(joined)).toBe(false)
    expect(joined).not.toContain('�')
    expect(parts.some((p) => p.hit && p.text === '회고')).toBe(true)
  })
})

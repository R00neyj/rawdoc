// specs/features/F-133.md 4장 A1·A4, specs/features/F-2113.md 7장 A1~A4
import { describe, expect, it } from 'vitest'
import {
  findFrontmatter,
  frontmatterValueRanges,
  frontmatterValueWrite,
  parseSimpleProperties,
  textAfterFrontmatter,
} from '../../../src/lib/frontmatter'

describe('findFrontmatter — 범위 찾기 (A1)', () => {
  it('---\\na: 1\\n---\\n본문 을 인식한다', () => {
    const text = '---\na: 1\n---\n본문'
    const fm = findFrontmatter(text)!
    expect(fm).not.toBeNull()
    expect(fm.from).toBe(0)
    expect(fm.closeMark).toBe('---')
    expect(text.slice(fm.contentFrom, fm.contentTo)).toBe('a: 1\n')
    expect(textAfterFrontmatter(text, fm)).toBe('본문')
  })

  it('CRLF 문서도 인식한다', () => {
    const text = '---\r\na: 1\r\n---\r\n본문'
    const fm = findFrontmatter(text)!
    expect(fm).not.toBeNull()
    expect(text.slice(fm.contentFrom, fm.contentTo)).toBe('a: 1\r\n')
    expect(textAfterFrontmatter(text, fm)).toBe('본문')
  })

  it('닫는 줄이 ... 이어도 인식한다', () => {
    const fm = findFrontmatter('---\na: 1\n...\n본문')!
    expect(fm).not.toBeNull()
    expect(fm.closeMark).toBe('...')
  })

  it('닫는 줄이 없으면 null', () => {
    expect(findFrontmatter('---\na: 1\n본문')).toBeNull()
  })

  it('첫 줄 앞에 빈 줄이 있으면 null', () => {
    expect(findFrontmatter('\n---\na: 1\n---\n본문')).toBeNull()
  })

  it('본문 중간의 --- 는 무시한다(첫 줄이 --- 가 아니면 애초에 프론트매터가 아니다)', () => {
    expect(findFrontmatter('# 제목\n\n---\n\n본문')).toBeNull()
  })

  it('---- 는 여는 줄이 아니다', () => {
    expect(findFrontmatter('----\na: 1\n----\n')).toBeNull()
  })

  it('빈 프론트매터(---\\n---)를 인식하고 내용이 빈 문자열이다', () => {
    const text = '---\n---'
    const fm = findFrontmatter(text)!
    expect(fm).not.toBeNull()
    expect(text.slice(fm.contentFrom, fm.contentTo)).toBe('')
    expect(textAfterFrontmatter(text, fm)).toBe('')
  })

  it('닫는 줄 뒤 공백이 있어도 인식한다', () => {
    const fm = findFrontmatter('---  \na: 1\n---\t\n본문')
    expect(fm).not.toBeNull()
  })

  it('줄바꿈이 전혀 없는 문서는 null', () => {
    expect(findFrontmatter('---')).toBeNull()
  })
})

describe('parseSimpleProperties — 속성 해석 (A4)', () => {
  it('단순 키·값을 해석한다', () => {
    expect(parseSimpleProperties('title: 문서\ndraft: false')).toEqual([
      { key: 'title', value: '문서' },
      { key: 'draft', value: 'false' },
    ])
  })

  it('감싼 따옴표를 뗀다', () => {
    expect(parseSimpleProperties('title: "따옴표 제목"\nname: \'홑따옴표\'')).toEqual([
      { key: 'title', value: '따옴표 제목' },
      { key: 'name', value: '홑따옴표' },
    ])
  })

  it('목록 값을 배열로 만든다', () => {
    expect(parseSimpleProperties('tags:\n  - a\n  - b\ntitle: 문서')).toEqual([
      { key: 'tags', value: ['a', 'b'] },
      { key: 'title', value: '문서' },
    ])
  })

  it('# 로 시작하는 줄은 주석으로 건너뛴다', () => {
    expect(parseSimpleProperties('# 주석\ntitle: 문서')).toEqual([{ key: 'title', value: '문서' }])
  })

  it('목록 항목이 아닌 들여쓴 줄(중첩 객체)이 있으면 null', () => {
    expect(parseSimpleProperties('parent:\n  child: 1')).toBeNull()
  })

  it('여러 줄 문자열( | ) 본문이 있으면 null', () => {
    expect(parseSimpleProperties('desc: |\n  줄1\n  줄2')).toBeNull()
  })

  it('인라인 값([a, b])은 문자열 그대로 둔다', () => {
    expect(parseSimpleProperties('list: [a, b]')).toEqual([{ key: 'list', value: '[a, b]' }])
  })

  it('빈 프론트매터(빈 문자열)는 빈 배열', () => {
    expect(parseSimpleProperties('')).toEqual([])
  })

  it('키:값 형식도 목록 항목도 아니면 null', () => {
    expect(parseSimpleProperties('그냥 문장입니다')).toBeNull()
  })
})

// F-2113 3.1 표 — [문서, [key, kind, 원문 구간][]]
const RANGE_CASES: [string, [string, 'scalar' | 'listItem', string][]][] = [
  ['---\na: 1\n---\n본문', [['a', 'scalar', '1']]],
  ['---\nb: "x y" # 메모\n---\nx', [['b', 'scalar', '"x y" # 메모']]],
  ['---\ntags:\n  - one\n  - \'two\'\n---\nx', [['tags', 'listItem', 'one'], ['tags', 'listItem', "'two'"]]],
  ['---\nc:\n---\nx', [['c', 'scalar', '']]],
  ['---\nk:\t  v  \n---\nx', [['k', 'scalar', 'v  ']]],
  ['---\nurl: http://x:1\n---\nx', [['url', 'scalar', 'http://x:1']]],
  ['---\na: b\n  - c\n---\nx', [['a', 'listItem', 'c']]],
  ['---\r\na: 1\r\ntags:\r\n  - x\r\n---\r\n본문', [['a', 'scalar', '1'], ['tags', 'listItem', 'x']]],
]

function stripQuotes(value: string): string {
  if (value.length >= 2 && ((value[0] === '"' && value.endsWith('"')) || (value[0] === "'" && value.endsWith("'")))) {
    return value.slice(1, -1)
  }
  return value
}

function contentOf(doc: string): string {
  const fm = findFrontmatter(doc)!
  return doc.slice(fm.contentFrom, fm.contentTo)
}

describe('frontmatterValueRanges — 값 위치 (F-2113 A1)', () => {
  it.each(RANGE_CASES)('%j', (doc, expected) => {
    const ranges = frontmatterValueRanges(doc)
    expect(ranges.map((r) => [r.key, r.kind, doc.slice(r.from, r.to)])).toEqual(expected)
  })

  it('offset 은 문서 절대 위치 — a: 1 은 7–8', () => {
    expect(frontmatterValueRanges('---\na: 1\n---\n본문')).toEqual([{ key: 'a', kind: 'scalar', from: 7, to: 8 }])
  })

  it('빈 값 c: 는 from === to === 줄 끝', () => {
    const [r] = frontmatterValueRanges('---\nc:\n---\nx')
    expect(r.from).toBe(6)
    expect(r.to).toBe(6)
  })

  it('CRLF — \\r 미포함, 8–9 와 22–23', () => {
    const ranges = frontmatterValueRanges('---\r\na: 1\r\ntags:\r\n  - x\r\n---\r\n본문')
    expect(ranges.map((r) => [r.from, r.to])).toEqual([
      [8, 9],
      [22, 23],
    ])
  })

  it.each([
    '---\n  - x\n---\nx',
    '---\nparent:\n  child: 1\n---\nx',
    '---\na: |\n  t\n---\nx',
    '# 제목',
  ])('해석 불가 %j 는 []', (doc) => {
    expect(frontmatterValueRanges(doc)).toEqual([])
  })
})

describe('frontmatterValueRanges — 표시 대응 (F-2113 A2)', () => {
  it.each(RANGE_CASES)('%j 의 칸 표시 = 파서 값 펼친 목록', (doc) => {
    const shown = frontmatterValueRanges(doc).map((r) => stripQuotes(doc.slice(r.from, r.to).trim()))
    const parsed = parseSimpleProperties(contentOf(doc))!.flatMap((p) => (Array.isArray(p.value) ? p.value : [p.value]))
    expect(shown).toEqual(parsed)
  })
})

describe('frontmatterValueWrite — 쓰기 구간 (F-2113 A3)', () => {
  it('"웹"→"웹앱" 은 끝에 앱 삽입 하나', () => {
    expect(frontmatterValueWrite('웹', 10, '웹앱', ' ')).toEqual({
      change: { from: 11, to: 11, insert: '앱' },
      range: { from: 10, to: 12 },
    })
  })

  it('같으면 change: null', () => {
    expect(frontmatterValueWrite('웹', 10, '웹', ' ')).toEqual({ change: null, range: { from: 10, to: 11 } })
  })

  it('c: 빈 값 첫 쓰기는 " x", range.from = from+1', () => {
    expect(frontmatterValueWrite('', 6, 'x', ':')).toEqual({
      change: { from: 6, to: 6, insert: ' x' },
      range: { from: 7, to: 8 },
    })
  })

  it('c:  (콜론 뒤 공백 있는) 빈 값은 공백을 안 붙인다', () => {
    expect(frontmatterValueWrite('', 7, 'x', ' ')).toEqual({
      change: { from: 7, to: 7, insert: 'x' },
      range: { from: 7, to: 8 },
    })
  })

  it('a:b 처럼 붙은 값은 공백을 안 붙인다', () => {
    expect(frontmatterValueWrite('b', 6, 'bc', ':')).toEqual({
      change: { from: 7, to: 7, insert: 'c' },
      range: { from: 6, to: 8 },
    })
  })

  it('c: 빈 값에 빈 문자열은 change: null', () => {
    expect(frontmatterValueWrite('', 6, '', ':')).toEqual({ change: null, range: { from: 6, to: 6 } })
  })
})

describe('frontmatterValueWrite — 구조 유지 (F-2113 A4)', () => {
  const REPLACEMENTS = ['- x', ': y', '# c', '"', "'a", '---', '...', '|', '> t', '[1, 2]', "''"]
  const docs = RANGE_CASES.map(([doc]) => doc)

  for (const doc of docs) {
    const before = frontmatterValueRanges(doc)
    before.forEach((range, cell) => {
      it.each(REPLACEMENTS)(`${JSON.stringify(doc)} 칸 ${cell} ← %j`, (next) => {
        const current = doc.slice(range.from, range.to)
        const { change } = frontmatterValueWrite(current, range.from, next, doc.slice(range.from - 1, range.from))
        const written = change ? doc.slice(0, change.from) + change.insert + doc.slice(change.to) : doc
        expect(parseSimpleProperties(contentOf(written))).not.toBeNull()
        expect(frontmatterValueRanges(written).map((r) => [r.key, r.kind])).toEqual(before.map((r) => [r.key, r.kind]))
      })
    })
  }
})

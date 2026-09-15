// specs/features/F-133.md 4장 A1·A4
import { describe, expect, it } from 'vitest'
import { findFrontmatter, parseSimpleProperties, textAfterFrontmatter } from './frontmatter'

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

// callout.js 단위 테스트 (specs/features/F-128.md 5장 A1)
import { describe, expect, it } from 'vitest'
import { parseCalloutHeader, defaultCalloutTitle } from './callout'

describe('parseCalloutHeader', () => {
  it('종류·제목을 해석한다', () => {
    const header = parseCalloutHeader('[!note] 제목')
    expect(header).toMatchObject({ type: 'note', kind: 'note', fold: '', title: '제목' })
  })

  it('종류는 대소문자를 무시한다', () => {
    const header = parseCalloutHeader('[!TIP]')
    expect(header).toMatchObject({ type: 'TIP', kind: 'tip', fold: '', title: '' })
  })

  it('접기 기호(-)를 인식한다', () => {
    const header = parseCalloutHeader('[!warning]- 접힘')
    expect(header).toMatchObject({ type: 'warning', kind: 'warning', fold: '-', title: '접힘' })
  })

  it('접기 기호(+)를 인식한다', () => {
    const header = parseCalloutHeader('[!warning]+ 펼침')
    expect(header).toMatchObject({ fold: '+' })
  })

  it('지원하지 않는 종류는 note 묶음이 된다', () => {
    const header = parseCalloutHeader('[!custom] x')
    expect(header).toMatchObject({ type: 'custom', kind: 'note' })
  })

  it('별칭 faq 는 question 묶음', () => {
    expect(parseCalloutHeader('[!faq]')).toMatchObject({ kind: 'question' })
  })

  it('GitHub 별칭 important 는 tip 묶음', () => {
    expect(parseCalloutHeader('[!important]')).toMatchObject({ kind: 'tip' })
  })

  it('GitHub 별칭 caution 은 warning 묶음', () => {
    expect(parseCalloutHeader('[!caution]')).toMatchObject({ kind: 'warning' })
  })

  it('[!] 는 null', () => {
    expect(parseCalloutHeader('[!]')).toBeNull()
  })

  it('[! note] 는 null (! 뒤 공백)', () => {
    expect(parseCalloutHeader('[! note]')).toBeNull()
  })

  it('[note] 는 null (! 없음)', () => {
    expect(parseCalloutHeader('[note]')).toBeNull()
  })

  it('제목 앞뒤 공백을 제거한다', () => {
    expect(parseCalloutHeader('[!note]   제목    ')).toMatchObject({ title: '제목' })
  })

  it('제목이 없으면 빈 문자열', () => {
    expect(parseCalloutHeader('[!note]')).toMatchObject({ title: '' })
  })

  it('typeFrom·typeTo 는 [ 부터 ](접기 기호 포함) 끝까지', () => {
    const header = parseCalloutHeader('[!warning]- folded')!
    expect(header.typeFrom).toBe(0)
    expect(header.typeTo).toBe('[!warning]-'.length)
  })

  it('typeTo 는 접기 기호가 없으면 ] 바로 다음', () => {
    const header = parseCalloutHeader('[!note] 제목')!
    expect(header.typeTo).toBe('[!note]'.length)
  })
})

describe('defaultCalloutTitle', () => {
  it('첫 글자만 대문자로 바꾼다', () => {
    expect(defaultCalloutTitle('note')).toBe('Note')
  })

  it('이미 대문자면 그대로', () => {
    expect(defaultCalloutTitle('NOTE')).toBe('NOTE')
  })

  it('한글은 그대로', () => {
    expect(defaultCalloutTitle('할일')).toBe('할일')
  })
})

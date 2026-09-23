// specs/features/F-291.md 3장, 13장 A1~A5
import { describe, expect, it } from 'vitest'
import { findInlineMath, matchMathAt, parseMathBlock } from './mathSyntax'

// A1 — 인라인 통과 표 (3.1 P1~P8)
describe('findInlineMath — 통과(P1~P8)', () => {
  it('P1 $x$ — 최소 형태', () => {
    const line = '$x$'
    const matches = findInlineMath(line)
    expect(matches).toHaveLength(1)
    expect(matches[0]).toEqual({ from: 0, to: 3, innerFrom: 1, innerTo: 2 })
    expect(line.slice(matches[0].innerFrom, matches[0].innerTo)).toBe('x')
  })

  it('P2 $E = mc^2$ — 안쪽 공백은 상관없다', () => {
    const line = '$E = mc^2$'
    const matches = findInlineMath(line)
    expect(matches).toHaveLength(1)
    expect(matches[0]).toEqual({ from: 0, to: line.length, innerFrom: 1, innerTo: line.length - 1 })
    expect(line.slice(matches[0].innerFrom, matches[0].innerTo)).toBe('E = mc^2')
  })

  it('P3 값은 $x^2$ 이다 — 한글 사이', () => {
    const line = '값은 $x^2$ 이다'
    const matches = findInlineMath(line)
    expect(matches).toHaveLength(1)
    const from = line.indexOf('$')
    const to = line.indexOf('$', from + 1) + 1
    expect(matches[0]).toEqual({ from, to, innerFrom: from + 1, innerTo: to - 1 })
    expect(line.slice(matches[0].innerFrom, matches[0].innerTo)).toBe('x^2')
  })

  it('P4 $\\frac{1}{2}$ — 역슬래시 명령', () => {
    const line = '$\\frac{1}{2}$'
    const matches = findInlineMath(line)
    expect(matches).toHaveLength(1)
    expect(matches[0]).toEqual({ from: 0, to: line.length, innerFrom: 1, innerTo: line.length - 1 })
    expect(line.slice(matches[0].innerFrom, matches[0].innerTo)).toBe('\\frac{1}{2}')
  })

  it('P5 a$b$c — 낱말 가운데도 허용', () => {
    const line = 'a$b$c'
    const matches = findInlineMath(line)
    expect(matches).toHaveLength(1)
    expect(matches[0]).toEqual({ from: 1, to: 4, innerFrom: 2, innerTo: 3 })
    expect(line.slice(matches[0].innerFrom, matches[0].innerTo)).toBe('b')
  })

  it('P6 $x$와 $y$ — 한 줄에 둘', () => {
    const line = '$x$와 $y$'
    const matches = findInlineMath(line)
    expect(matches).toHaveLength(2)
    expect(line.slice(matches[0].innerFrom, matches[0].innerTo)).toBe('x')
    expect(line.slice(matches[1].innerFrom, matches[1].innerTo)).toBe('y')
  })

  it('P7 $x$. — 닫는 기호 뒤가 숫자가 아닌 문장부호', () => {
    const matches = findInlineMath('$x$.')
    expect(matches).toHaveLength(1)
  })

  it('P8 $100$ — 안쪽이 숫자인 것은 상관없다', () => {
    const line = '$100$'
    const matches = findInlineMath(line)
    expect(matches).toHaveLength(1)
    expect(line.slice(matches[0].innerFrom, matches[0].innerTo)).toBe('100')
  })
})

// A2 — 인라인 불통과 표 (3.1 N1~N7. N8~N10 은 A13, 이 명세는 mathPreview.test.ts 가 담당)
describe('findInlineMath — 불통과(N1~N7)', () => {
  it('N1 이 책은 $5 이고 저 책은 $7 이다 — 닫는 후보 바로 앞이 공백(R4)', () => {
    expect(findInlineMath('이 책은 $5 이고 저 책은 $7 이다')).toHaveLength(0)
  })

  it('N2 가격은 $5~$10 이다 — 닫는 후보 바로 뒤가 숫자(R5)', () => {
    expect(findInlineMath('가격은 $5~$10 이다')).toHaveLength(0)
  })

  it('N3 $ x $ — 여는 기호 뒤가 공백(R3)', () => {
    expect(findInlineMath('$ x $')).toHaveLength(0)
  })

  it('N4 $x $ — 닫는 기호 앞이 공백(R4)', () => {
    expect(findInlineMath('$x $')).toHaveLength(0)
  })

  it('N5 \\$5 — 이스케이프(R1)', () => {
    expect(findInlineMath('\\$5')).toHaveLength(0)
  })

  it('N6 $x — 같은 줄에 닫는 기호가 없다(R8)', () => {
    expect(findInlineMath('$x')).toHaveLength(0)
  })

  it('N7 $앞 다음 줄 뒤$ — 줄을 넘는다(R7)', () => {
    expect(matchMathAt('$앞\n뒤$', 0)).toBeNull()
  })
})

// A3 — 규칙 하나짜리 경계
describe('findInlineMath — 규칙 하나짜리 경계(A3)', () => {
  it.each([
    ['$x$', 1],
    ['$ x$', 0],
    ['$x $', 0],
    ['$x$5', 0],
    ['$x$a', 1],
    ['$$', 0],
  ])('%s → %i개', (line, count) => {
    expect(findInlineMath(line)).toHaveLength(count)
  })
})

describe('matchMathAt·findInlineMath — 잘못된 입력', () => {
  it('문자열이 아니면 빈 결과 / null', () => {
    expect(findInlineMath(undefined)).toEqual([])
    expect(findInlineMath(null)).toEqual([])
    expect(findInlineMath(123)).toEqual([])
    expect(matchMathAt(undefined, 0)).toBeNull()
  })
})

// A4 — 블록 통과
describe('parseMathBlock — 통과(A4)', () => {
  it('여러 줄', () => {
    expect(parseMathBlock('$$\nx^2\n$$')).toEqual({ tex: 'x^2' })
  })

  it('한 줄', () => {
    expect(parseMathBlock('$$x^2$$')).toEqual({ tex: 'x^2' })
  })

  it('여러 줄, 앞뒤 공백 허용', () => {
    expect(parseMathBlock('$$  \nx\ny\n  $$')).toEqual({ tex: 'x\ny' })
  })
})

// A5 — 블록 불통과
describe('parseMathBlock — 불통과(A5)', () => {
  it.each([
    ['$$\n\n$$', '빈 본문'],
    ['문단\n$$\nx\n$$', '문단에 섞임'],
    ['$$x', '닫는 $$ 없음'],
    ['x$$', '여는 $$ 없음'],
  ])('%s (%s) → null', (text) => {
    expect(parseMathBlock(text)).toBeNull()
  })

  it('문자열이 아니면 null', () => {
    expect(parseMathBlock(undefined)).toBeNull()
    expect(parseMathBlock(123)).toBeNull()
  })
})

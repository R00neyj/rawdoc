// specs/features/F-2002.md 12.1 U1~U7
import { describe, it, expect } from 'vitest'
import { parseCssColor } from './cssColor'

// 0~1 실수 비교라 자릿수를 정해 둔다
function expectRgba(got: ReturnType<typeof parseCssColor>, want: [number, number, number, number]) {
  expect(got).not.toBeNull()
  const rgba = got as [number, number, number, number]
  for (let i = 0; i < 4; i++) expect(rgba[i]).toBeCloseTo(want[i], 6)
}

describe('parseCssColor', () => {
  it('U1 16진 3·6자리', () => {
    expectRgba(parseCssColor('#abc'), [170 / 255, 187 / 255, 204 / 255, 1])
    expectRgba(parseCssColor('#ABC'), [170 / 255, 187 / 255, 204 / 255, 1])
    expectRgba(parseCssColor('#3B4890'), [59 / 255, 72 / 255, 144 / 255, 1])
    expectRgba(parseCssColor('#3b4890'), [59 / 255, 72 / 255, 144 / 255, 1])
  })

  it('U2 16진 4·8자리', () => {
    expectRgba(parseCssColor('#3B489080'), [59 / 255, 72 / 255, 144 / 255, 128 / 255])
    // CSS 는 #RGBA 각 자리를 두 번 반복한다 — d → dd(221). 13/15 가 아니다
    expectRgba(parseCssColor('#abcd'), [170 / 255, 187 / 255, 204 / 255, 221 / 255])
  })

  it('U3 rgb()·rgba() 쉼표꼴', () => {
    expectRgba(parseCssColor('rgb(59, 72, 144)'), [59 / 255, 72 / 255, 144 / 255, 1])
    expectRgba(parseCssColor('rgba(59, 72, 144, 0.3)'), [59 / 255, 72 / 255, 144 / 255, 0.3])
    expectRgba(parseCssColor('rgb(100%, 0%, 0%)'), [1, 0, 0, 1])
    expectRgba(parseCssColor('RGBA(59, 72, 144, 50%)'), [59 / 255, 72 / 255, 144 / 255, 0.5])
  })

  it('U4 공백꼴', () => {
    expectRgba(parseCssColor('rgb(59 72 144)'), [59 / 255, 72 / 255, 144 / 255, 1])
    expectRgba(parseCssColor('rgb(59 72 144 / 30%)'), [59 / 255, 72 / 255, 144 / 255, 0.3])
    expectRgba(parseCssColor('rgb(59 72 144 / 0.3)'), [59 / 255, 72 / 255, 144 / 255, 0.3])
  })

  it('U5 color(srgb …)', () => {
    expectRgba(parseCssColor('color(srgb 0.577255 0.605294 0.760588)'), [0.577255, 0.605294, 0.760588, 1])
    expectRgba(parseCssColor('color(srgb 0.231373 0.282353 0.564706 / 0.3)'), [0.231373, 0.282353, 0.564706, 0.3])
    expectRgba(parseCssColor('color(srgb 100% 0% 50%)'), [1, 0, 0.5, 1])
  })

  it('U6 경계·공백', () => {
    expectRgba(parseCssColor('  #abc  '), [170 / 255, 187 / 255, 204 / 255, 1])
    expectRgba(parseCssColor(' rgb(59, 72, 144) '), [59 / 255, 72 / 255, 144 / 255, 1])
    expectRgba(parseCssColor('rgb(300, -5, 0)'), [1, 0, 0, 1])
    expectRgba(parseCssColor('color(srgb 2 -1 0.5)'), [1, 0, 0.5, 1])
    expectRgba(parseCssColor('rgba(0, 0, 0, 5)'), [0, 0, 0, 1])
  })

  it('U7 거절 — 예외를 던지지 않는다', () => {
    const rejected: unknown[] = [
      'oklch(0.5 0.1 250)',
      'oklab(0.68 0.003 -0.065)',
      'color(display-p3 0.5 0.2 0.1)',
      'hsl(120, 50%, 50%)',
      'hsla(120, 50%, 50%, 0.5)',
      'rebeccapurple',
      '',
      '   ',
      '#12345',
      '#gg0000',
      'rgb(1,2)',
      'rgb(1,2,3,4,5)',
      'color(srgb 0.1 0.2)',
      undefined,
      null,
      42,
      {},
    ]
    for (const input of rejected) {
      expect(parseCssColor(input as string), String(input)).toBeNull()
    }
  })
})

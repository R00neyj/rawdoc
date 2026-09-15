import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { contrastRatio } from './contrast'
import brand from '../../brand.config'

const tokensPath = fileURLToPath(new URL('../styles/tokens.css', import.meta.url))
const tokensCss = readFileSync(tokensPath, 'utf-8')

function readToken(name: string) {
  const pattern = new RegExp(`${name}\\s*:\\s*(#[0-9a-fA-F]{6})`)
  const match = pattern.exec(tokensCss)
  if (!match) {
    throw new Error(`tokens.css 에서 토큰을 찾을 수 없음: ${name}`)
  }
  return match[1]
}

describe('contrastRatio', () => {
  it('검정과 흰색의 대비는 21:1', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 1)
  })

  it('같은 색끼리는 1:1', () => {
    expect(contrastRatio('#123456', '#123456')).toBe(1)
  })

  it('#RRGGBB 가 아니면 예외', () => {
    expect(() => contrastRatio('red', '#FFFFFF')).toThrow()
  })

  it('메인 컬러와 --panel·--paper 대비를 계산한다 (미달이어도 경고만, design.md 3.2)', () => {
    const panel = readToken('--panel')
    const paper = readToken('--paper')
    const panelRatio = contrastRatio(brand.accent, panel)
    const paperRatio = contrastRatio(brand.accent, paper)

    if (panelRatio < 4.5) {
      console.warn(`[contrast] accent-panel 대비 미달: ${panelRatio.toFixed(2)}:1 (기준 4.5:1)`)
    }
    if (paperRatio < 4.5) {
      console.warn(`[contrast] accent-paper 대비 미달: ${paperRatio.toFixed(2)}:1 (기준 4.5:1)`)
    }

    // 메인 컬러 확정 전까지는 미달이어도 테스트를 실패시키지 않는다
    expect(panelRatio).toBeGreaterThan(1)
    expect(paperRatio).toBeGreaterThan(1)
  })
})

// 콜아웃 색 토큰 대비 검사 (specs/features/F-128.md 3장·5장 A4).
// 메인 컬러와 달리 콜아웃은 임시값이 아니라 확정된 색이므로 4.5 미만이면 테스트를
// 실패시킨다("경고가 아니라 실패다", F-128 3장). hex 가 아닌 토큰(--callout-note ·
// --callout-quote 는 var() 참조)은 여기서 검사하지 않는다 — 대비 계산에 필요한 hex 값이
// 없고, 참조 대상(--link · --ink-2)은 F-102 가 이미 검산했다
const CALLOUT_HEX_TOKENS = ['--callout-tip', '--callout-success', '--callout-question', '--callout-warning', '--callout-danger', '--callout-example']

describe('콜아웃 색 토큰 대비 (F-128 3장)', () => {
  it.each(CALLOUT_HEX_TOKENS)('%s 는 --panel 과 4.5:1 이상', (token) => {
    const panel = readToken('--panel')
    const hex = readToken(token)
    expect(contrastRatio(hex, panel)).toBeGreaterThanOrEqual(4.5)
  })
})

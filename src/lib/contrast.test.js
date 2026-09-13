import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { contrastRatio } from './contrast.js'
import brand from '../../brand.config.js'

const tokensPath = fileURLToPath(new URL('../styles/tokens.css', import.meta.url))
const tokensCss = readFileSync(tokensPath, 'utf-8')

function readToken(name) {
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

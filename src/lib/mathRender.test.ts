// specs/features/F-291.md 6장, 13장 A6~A7
import { describe, expect, it } from 'vitest'
import { renderMath } from './mathRender'

describe('renderMath — 성공(A6)', () => {
  it('인라인 — class="katex" 를 담고 <script 는 없다', () => {
    const result = renderMath('x^2')
    expect('html' in result).toBe(true)
    if ('html' in result) {
      expect(result.html).toContain('class="katex"')
      expect(result.html).not.toContain('<script')
    }
  })

  it('블록(display) — katex-display 를 담고 <script 는 없다', () => {
    const result = renderMath('x^2', { display: true })
    expect('html' in result).toBe(true)
    if ('html' in result) {
      expect(result.html).toContain('katex-display')
      expect(result.html).not.toContain('<script')
    }
  })
})

describe('renderMath — 실패(A7)', () => {
  it('문법 오류는 {error} 를 돌려주고 KaTeX 기본 오류 색을 담지 않는다(6.2)', () => {
    const result = renderMath('\\frac{')
    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.error.length).toBeGreaterThan(0)
      expect(result.error).not.toContain('style="color:#cc0000"')
    }
  })
})

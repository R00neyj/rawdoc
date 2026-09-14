// tokens.css 를 읽어 테마별 대비를 검산한다 (specs/features/F-141.md 3.1)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { contrastRatio } from '../lib/contrast.js'
import brand from '../../brand.config.js'

// /* ... */ 주석을 먼저 지운다 — 주석 안 예시 코드에 :root{...} 가 있어 그대로 두면 잘못 걸린다
const css = readFileSync(fileURLToPath(new URL('./tokens.css', import.meta.url)), 'utf-8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
)

// data-theme 블록 하나(:root 포함)의 본문에서 --token: 값 을 뽑아 hex 만 남긴다
function extractBlock(selector) {
  const re = new RegExp(`${selector}\\s*\\{([^}]*)\\}`, 's')
  const match = re.exec(css)
  if (!match) throw new Error(`${selector} 블록을 찾을 수 없음`)
  const tokens = {}
  const tokenRe = /--([\w-]+):\s*([^;]+);/g
  let m
  while ((m = tokenRe.exec(match[1]))) {
    tokens[m[1]] = m[2].trim()
  }
  return tokens
}

function resolve(tokens, value, fallback) {
  const varMatch = /^var\(--([\w-]+)\)$/.exec(value)
  if (varMatch) {
    return tokens[varMatch[1]] ?? fallback?.[varMatch[1]]
  }
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value
  return null // color-mix() 등 계산식 — 별도 검사(accent)
}

const whiteTokens = extractBlock(':root')
const sepiaTokens = { ...whiteTokens, ...extractBlock(":root\\[data-theme='sepia'\\]") }
const darkTokens = { ...whiteTokens, ...extractBlock(":root\\[data-theme='dark'\\]") }

const THEMES = {
  white: whiteTokens,
  sepia: sepiaTokens,
  dark: darkTokens,
}

const AA_TOKENS = ['ink', 'ink-2', 'link', 'danger']
const CALLOUT_TOKENS = [
  'callout-note',
  'callout-tip',
  'callout-success',
  'callout-question',
  'callout-warning',
  'callout-danger',
  'callout-example',
  'callout-quote',
]

describe('테마 3종 대비 (design.md 3.4, F-141 3.1)', () => {
  for (const [name, tokens] of Object.entries(THEMES)) {
    describe(name, () => {
      for (const bg of ['paper', 'panel']) {
        const bgHex = resolve(tokens, tokens[bg])

        test(`--muted vs --${bg} >= 3.0`, () => {
          const hex = resolve(tokens, tokens.muted)
          expect(contrastRatio(hex, bgHex)).toBeGreaterThanOrEqual(3.0)
        })

        for (const token of [...AA_TOKENS, ...CALLOUT_TOKENS]) {
          test(`--${token} vs --${bg} >= 4.5`, () => {
            const hex = resolve(tokens, tokens[token])
            expect(contrastRatio(hex, bgHex)).toBeGreaterThanOrEqual(4.5)
          })
        }
      }
    })
  }
})

describe('메인 컬러 대비 — 확정 전까지 경고만 (design.md 3.2)', () => {
  // 다크는 srgb 55% 흰 혼합으로 계산한다 (design.md 3.4)
  function mixWhite(hex, pct) {
    const int = parseInt(hex.slice(1), 16)
    const r = (int >> 16) & 255
    const g = (int >> 8) & 255
    const b = int & 255
    const mixCh = (c) => Math.round((c * pct) / 100 + 255 * (1 - pct / 100))
    return `#${[r, g, b].map((c) => mixCh(c).toString(16).padStart(2, '0')).join('')}`
  }

  test('brand.config.js 값으로 확인 (경고만, 실패 조건 아님)', () => {
    const accentDark = mixWhite(brand.accent, 55)
    for (const [name, tokens] of Object.entries(THEMES)) {
      const accentHex = name === 'dark' ? accentDark : brand.accent
      for (const bg of ['paper', 'panel']) {
        const bgHex = resolve(tokens, tokens[bg])
        const ratio = contrastRatio(accentHex, bgHex)
        if (ratio < 4.5) {
          console.warn(`경고: ${name} --accent vs --${bg} = ${ratio.toFixed(2)} (4.5 미달)`)
        }
      }
    }
    expect(true).toBe(true)
  })
})

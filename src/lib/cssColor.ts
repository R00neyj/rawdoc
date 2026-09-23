// CSS 색 문자열 → 0~1 sRGB 넷. three 의 Color.setStyle() 이 color(srgb …) 를 못 받아 우리가 파싱한다 (specs/features/F-292.md 3.4, F-2002 3.3·5장). DOM 을 쓰지 않는 순수 모듈이다

// 0~1 로 자른 sRGB 넷. 알파가 없던 입력은 1
export type Rgba = [number, number, number, number]

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  return n < 0 ? 0 : n > 1 ? 1 : n
}

// 16진 두 자리 → 0~1
function hex2(s: string): number {
  return parseInt(s, 16) / 255
}

// 성분 하나. `%` 면 scale 과 무관하게 0~100 을 0~1 로, 아니면 scale 로 나눈다
function component(raw: string, scale: number): number | null {
  const text = raw.trim()
  if (text === '') return null
  if (text.endsWith('%')) {
    const n = Number(text.slice(0, -1))
    return Number.isFinite(n) ? clamp01(n / 100) : null
  }
  const n = Number(text)
  return Number.isFinite(n) ? clamp01(n / scale) : null
}

// `r g b / a` 또는 `r, g, b, a` 를 성분 배열로 가른다. 둘을 섞은 것은 거절한다
function splitComponents(body: string): string[] | null {
  const text = body.trim()
  if (text === '') return null
  if (text.includes(',')) {
    if (text.includes('/')) return null
    return text.split(',')
  }
  const slashParts = text.split('/')
  if (slashParts.length > 2) return null
  const head = slashParts[0].trim().split(/\s+/)
  if (slashParts.length === 1) return head
  const alpha = slashParts[1].trim()
  if (alpha === '') return null
  return [...head, alpha]
}

function parseHex(text: string): Rgba | null {
  const body = text.slice(1)
  if (!/^[0-9a-fA-F]+$/.test(body)) return null
  if (body.length === 3 || body.length === 4) {
    // CSS 는 #RGB(A) 의 각 자리를 두 번 반복한다 — `d` 는 `dd`(221)
    const parts = body.split('').map((c) => hex2(c + c))
    return [parts[0], parts[1], parts[2], body.length === 4 ? parts[3] : 1]
  }
  if (body.length === 6 || body.length === 8) {
    const parts: number[] = []
    for (let i = 0; i < body.length; i += 2) parts.push(hex2(body.slice(i, i + 2)))
    return [parts[0], parts[1], parts[2], body.length === 8 ? parts[3] : 1]
  }
  return null
}

// rgb(…) 성분은 0~255, color(srgb …) 성분은 0~1 이라 scale 로 가른다
function parseTriple(parts: string[], scale: number): Rgba | null {
  if (parts.length !== 3 && parts.length !== 4) return null
  const r = component(parts[0], scale)
  const g = component(parts[1], scale)
  const b = component(parts[2], scale)
  if (r === null || g === null || b === null) return null
  let a = 1
  if (parts.length === 4) {
    const parsed = component(parts[3], 1)
    if (parsed === null) return null
    a = parsed
  }
  return [r, g, b, a]
}

// 받는 모양은 #hex 3·4·6·8자리, rgb()/rgba() 쉼표꼴·공백꼴, color(srgb …) 뿐이다. 그 밖(oklch·oklab·display-p3·쓰레기)은 null. 앞뒤 공백은 버리고 범위 밖 성분은 0~1 로 자른다 (F-2002 5.2)
export function parseCssColor(input: string): Rgba | null {
  if (typeof input !== 'string') return null
  const text = input.trim()
  if (text === '') return null

  if (text.startsWith('#')) return parseHex(text)

  const fn = /^([a-zA-Z]+)\((.*)\)$/s.exec(text)
  if (!fn) return null
  const name = fn[1].toLowerCase()

  if (name === 'rgb' || name === 'rgba') {
    const parts = splitComponents(fn[2])
    return parts ? parseTriple(parts, 255) : null
  }

  if (name === 'color') {
    const body = fn[2].trim()
    const space = /^([a-zA-Z0-9-]+)(\s+|$)/.exec(body)
    // srgb 외의 색 공간(display-p3 등)은 변환 없이 받을 수 없으므로 거절한다
    if (!space || space[1].toLowerCase() !== 'srgb') return null
    const parts = splitComponents(body.slice(space[0].length))
    return parts ? parseTriple(parts, 1) : null
  }

  return null
}

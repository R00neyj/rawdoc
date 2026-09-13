// WCAG 2.x 상대 휘도 공식 기반 대비 계산 (specs/design.md 3.2)
const HEX_PATTERN = /^#([0-9a-fA-F]{6})$/

function toRgb(hex) {
  const match = HEX_PATTERN.exec(hex)
  if (!match) {
    throw new Error(`#RRGGBB 형식이 아님: ${hex}`)
  }
  const int = parseInt(match[1], 16)
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255]
}

function toLinearChannel(channel) {
  const c = channel / 255
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

function relativeLuminance(hex) {
  const [r, g, b] = toRgb(hex).map(toLinearChannel)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** @returns {number} 1(대비 없음) ~ 21(최대 대비) */
export function contrastRatio(hexA, hexB) {
  const lumA = relativeLuminance(hexA)
  const lumB = relativeLuminance(hexB)
  const lighter = Math.max(lumA, lumB)
  const darker = Math.min(lumA, lumB)
  return (lighter + 0.05) / (darker + 0.05)
}

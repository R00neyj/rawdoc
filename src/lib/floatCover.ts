// 휴대폰 폭 떠 있는 알약이 가리는 높이 — CSS @property --float-cover 를 읽는다 (F-2085 3.3)
export const FLOAT_COVER_PROP = '--float-cover'

export function parsePx(raw: string): number {
  const match = /^(\d+(?:\.\d+)?)px$/.exec(raw.trim())
  return match ? Number(match[1]) : 0
}

export function coverOverlap(input: { cover: number; shellTop: number; targetTop: number }): number {
  return Math.max(0, input.cover - (input.targetTop - input.shellTop))
}

export function floatCoverFor(el: Element): number {
  const shell = el.closest('.app-shell')
  if (!shell) return 0
  const cover = parsePx(getComputedStyle(shell).getPropertyValue(FLOAT_COVER_PROP))
  if (cover === 0) return 0
  return coverOverlap({ cover, shellTop: shell.getBoundingClientRect().top, targetTop: el.getBoundingClientRect().top })
}

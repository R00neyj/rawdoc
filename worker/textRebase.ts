// 앞뒤 공통 부분 차이와 외부 변경 옮겨 얹기 — 순수 함수 (specs/features/F-304.md 7.3)

export type TextEdit = { from: number; to: number; insert: string }

function isHigh(code: number) {
  return code >= 0xd800 && code <= 0xdbff
}

function isLow(code: number) {
  return code >= 0xdc00 && code <= 0xdfff
}

// 경계 index 가 서로게이트 쌍 가운데면 true
function splitsPair(text: string, index: number) {
  return index > 0 && index < text.length && isHigh(text.charCodeAt(index - 1)) && isLow(text.charCodeAt(index))
}

export function diffText(a: string, b: string): TextEdit | null {
  if (a === b) return null
  const max = Math.min(a.length, b.length)
  let start = 0
  while (start < max && a.charCodeAt(start) === b.charCodeAt(start)) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a.charCodeAt(endA - 1) === b.charCodeAt(endB - 1)) {
    endA--
    endB--
  }
  // 쌍 가운데에 떨어진 경계는 쌍 밖으로 넓힌다 — 앞은 한 칸 당기고 뒤는 한 칸 민다
  if (splitsPair(a, start) || splitsPair(b, start)) start--
  if (splitsPair(a, endA) || splitsPair(b, endB)) {
    endA++
    endB++
  }
  return { from: start, to: endA, insert: b.slice(start, endB) }
}

export function rebaseExternal(base: string, external: string, current: string): TextEdit | null | 'conflict' {
  const e = diffText(base, external)
  if (!e) return null
  const i = diffText(base, current)
  if (!i) return e
  if (e.to <= i.from) return e
  if (e.from >= i.to) {
    const shift = i.insert.length - (i.to - i.from)
    return { from: e.from + shift, to: e.to + shift, insert: e.insert }
  }
  return 'conflict'
}

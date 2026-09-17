// 한글 한 글자를 치는 동안 화면에 지나가는 조합 단계 — 초성 → 초성+중성 → 완성 (F-239.md 2.1)
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'
const BASE = 0xac00
const LAST = 0xd7a3

export function typeStages(ch: string): string[] {
  const code = ch.charCodeAt(0)
  if (code < BASE || code > LAST) return [ch]
  const offset = code - BASE
  const jong = offset % 28
  const jung = ((offset - jong) / 28) % 21
  const cho = ((offset - jong) / 28 - jung) / 21
  const stages = [CHO.charAt(cho), String.fromCharCode(BASE + cho * 588 + jung * 28)]
  if (jong) stages.push(ch)
  return stages
}

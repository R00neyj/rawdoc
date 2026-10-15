// 글자 수(코드 포인트) max 를 넘으면 앞부분 + `…` — 네이티브 선택칸 항목처럼 폭을 막을 수 없는 자리용
export function truncateChars(text: string, max: number): string {
  const chars = Array.from(text)
  return chars.length <= max ? text : `${chars.slice(0, Math.max(0, max - 1)).join('')}…`
}

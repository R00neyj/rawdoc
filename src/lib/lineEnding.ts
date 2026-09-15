// 줄바꿈 형식 판정·변환 — 순수 함수 (specs/product.md Q9, specs/features/F-110.md 3.3, F-114.md 2.1)
// CM6 는 lineSeparator 를 지정하지 않고 \r\n·\n·\r 을 모두 \n 으로 읽는다. 저장·내보내기
// 시점에만 이 파일로 lineEnding 을 잇는다

export type LineEnding = 'crlf' | 'lf'

export function detectLineEnding(text: string): { lineEnding: LineEnding; mixed: boolean } {
  let crlfCount = 0
  let lfAloneCount = 0
  let crAloneCount = 0

  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (ch === '\r') {
      if (text[i + 1] === '\n') {
        crlfCount++
        i += 2
        continue
      }
      crAloneCount++
      i++
      continue
    }
    if (ch === '\n') {
      lfAloneCount++
    }
    i++
  }

  if (crlfCount === 0 && lfAloneCount === 0 && crAloneCount === 0) {
    return { lineEnding: 'crlf', mixed: false }
  }
  if (lfAloneCount === 0 && crAloneCount === 0) {
    return { lineEnding: 'crlf', mixed: false }
  }
  if (crlfCount === 0 && crAloneCount === 0) {
    return { lineEnding: 'lf', mixed: false }
  }
  return { lineEnding: 'crlf', mixed: true }
}

// '\r\n'·'\r' 을 '\n' 으로 통일한다
export function toEditorText(text: string): string {
  return text.replace(/\r\n|\r/g, '\n')
}

// text 는 '\n' 으로만 줄이 나뉜 텍스트
export function fromEditorText(text: string, lineEnding: LineEnding): string {
  if (lineEnding === 'lf') return text
  return text.replace(/\n/g, '\r\n')
}

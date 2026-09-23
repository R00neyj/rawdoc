// 수식 $…$ · $$…$$ 감지 규칙 (specs/features/F-291.md 3장) — 편집·보기 모드가 matchMathAt 하나를 함께 써 규칙이 한 벌만 존재하게 한다(3.5). 순수 함수, DOM 없음

export type MathMatch = { from: number; to: number; innerFrom: number; innerTo: number }

// pos 바로 앞에 붙은 역슬래시 개수가 홀수인가(R1) — 홀수면 pos 의 글자는 이스케이프되어 기호가 아니다
function isEscaped(text: string, pos: number): boolean {
  let count = 0
  let i = pos - 1
  while (i >= 0 && text[i] === '\\') {
    count++
    i--
  }
  return count % 2 === 1
}

function isSpaceOrTab(ch: string | undefined): boolean {
  return ch === ' ' || ch === '\t'
}

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= '0' && ch <= '9'
}

// text[start] 가 여는 $ 라는 가정 아래 3.1 R1~R8 규칙으로 짝을 찾는다(R7 — 줄바꿈을 만나면 멈춘다)
export function matchMathAt(text: unknown, start: number): MathMatch | null {
  if (typeof text !== 'string') return null
  if (text[start] !== '$') return null
  if (isEscaped(text, start)) return null // R1
  if (text[start + 1] === '$') return null // R2 — $$ 는 인라인 여는 기호가 아니다(블록, 3.3)

  const afterOpen = text[start + 1]
  if (afterOpen === undefined || afterOpen === '\n' || isSpaceOrTab(afterOpen)) return null // R3

  let j = start + 1
  while (j < text.length) {
    const ch = text[j]
    if (ch === '\n') return null // R7 — 줄바꿈을 넘지 않는다
    if (ch === '$' && !isEscaped(text, j)) {
      const before = text[j - 1]
      const after = text[j + 1]
      const validClose = !isSpaceOrTab(before) && !isDigit(after) // R4·R5
      if (validClose && j > start + 1) return { from: start, to: j + 1, innerFrom: start + 1, innerTo: j } // R6
    }
    j++
  }
  return null // 같은 줄에 유효한 닫는 $ 가 없다
}

// 한 줄 글자에서 R8 순서대로 matchMathAt 을 반복 적용한다(편집 모드가 쓴다) — 규칙은 matchMathAt 한 곳에만 적는다
export function findInlineMath(lineText: unknown): MathMatch[] {
  const results: MathMatch[] = []
  if (typeof lineText !== 'string') return results

  let i = 0
  while (i < lineText.length) {
    if (lineText[i] !== '$') {
      i++
      continue
    }
    const match = matchMathAt(lineText, i)
    if (!match) {
      i++
      continue
    }
    results.push(match)
    i = match.to
  }
  return results
}

// 문단 글자 하나 → 블록 수식이면 { tex }, 아니면 null (3.3 B1~B5). parseImageBlock 과 같은 모양
export function parseMathBlock(paragraphText: unknown): { tex: string } | null {
  if (typeof paragraphText !== 'string') return null
  const lines = paragraphText.split(/\r\n|\r|\n/)

  if (lines.length === 1) {
    const line = lines[0]
    if (!line.startsWith('$$') || !line.endsWith('$$')) return null
    const tex = line.slice(2, -2)
    if (tex.trim() === '') return null // B4
    return { tex }
  }

  const first = lines[0]
  const last = lines[lines.length - 1]
  if (first.trimEnd() !== '$$') return null // 첫 줄은 $$ 뿐(뒤 공백만 허용)
  if (last.trim() !== '$$') return null // 마지막 줄은 $$ 뿐(앞뒤 공백 허용)

  const tex = lines.slice(1, -1).join('\n')
  if (tex.trim() === '') return null // B4 — 사이 줄이 없거나 공백뿐
  return { tex }
}

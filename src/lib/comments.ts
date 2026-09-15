// 주석 문법(%% …%%, <!-- … -->) 제거 — 공유 화면 노출 방지, 펜스·인라인코드 안은 제외, 줄 수·CRLF 유지 (F-214.md 2.1)

function matchFenceAtLineStart(text: string, i: number): { char: string; len: number } | null {
  let j = i
  let spaces = 0
  while (spaces < 3 && text[j] === ' ') {
    j++
    spaces++
  }
  const ch = text[j]
  if (ch !== '`' && ch !== '~') return null
  let len = 0
  while (text[j] === ch) {
    len++
    j++
  }
  if (len < 3) return null
  return { char: ch, len }
}

function isClosingFenceLine(text: string, i: number, fenceChar: string, fenceLen: number): boolean {
  let j = i
  let spaces = 0
  while (spaces < 3 && text[j] === ' ') {
    j++
    spaces++
  }
  let len = 0
  while (text[j] === fenceChar) {
    len++
    j++
  }
  if (len < fenceLen) return false
  while (j < text.length && text[j] !== '\n' && text[j] !== '\r') {
    if (text[j] !== ' ' && text[j] !== '\t') return false
    j++
  }
  return true
}

function findEol(text: string, i: number): number {
  let j = i
  while (j < text.length && text[j] !== '\n' && text[j] !== '\r') j++
  if (text[j] === '\r' && text[j + 1] === '\n') return j + 2
  if (j < text.length) return j + 1
  return j
}

function findBacktickClose(text: string, from: number, count: number): number {
  let j = from
  while (j < text.length) {
    if (text[j] === '`') {
      const runStart = j
      let runLen = 0
      while (text[j] === '`') {
        runLen++
        j++
      }
      if (runLen === count) return runStart
    } else if (text[j] === '\n' && isBlankLineAt(text, j + 1)) {
      return -1 // 인라인코드는 문단(빈 줄)을 넘지 않는다 — 넘겨 찾으면 사이 주석이 새어 나간다
    } else {
      j++
    }
  }
  return -1
}

const BLANK_LINE_RE = /[ \t]*\r?(?:\n|$)/y

function isBlankLineAt(text: string, i: number): boolean {
  BLANK_LINE_RE.lastIndex = i
  return BLANK_LINE_RE.test(text)
}

function keepNewlinesOnly(s: string): string {
  let out = ''
  for (let j = 0; j < s.length; j++) {
    if (s[j] === '\n' || s[j] === '\r') out += s[j]
  }
  return out
}

export function stripComments(text: string): string {
  let out = ''
  let i = 0
  const n = text.length
  let atLineStart = true
  let fenceChar: string | null = null
  let fenceLen = 0

  while (i < n) {
    if (atLineStart) {
      if (fenceChar === null) {
        const fence = matchFenceAtLineStart(text, i)
        if (fence) {
          fenceChar = fence.char
          fenceLen = fence.len
          const eol = findEol(text, i)
          out += text.slice(i, eol)
          i = eol
          continue
        }
      } else {
        if (isClosingFenceLine(text, i, fenceChar, fenceLen)) {
          fenceChar = null
          fenceLen = 0
        }
        const eol = findEol(text, i)
        out += text.slice(i, eol)
        i = eol
        continue
      }
      atLineStart = false
    }

    if (text[i] === '`') {
      const tickStart = i
      let tickCount = 0
      while (text[i] === '`') {
        tickCount++
        i++
      }
      const closeIdx = findBacktickClose(text, i, tickCount)
      if (closeIdx === -1) {
        out += text.slice(tickStart, i)
      } else {
        out += text.slice(tickStart, closeIdx + tickCount)
        i = closeIdx + tickCount
      }
      continue
    }

    if (text[i] === '%' && text[i + 1] === '%') {
      const closeIdx = text.indexOf('%%', i + 2)
      if (closeIdx === -1) {
        out += text[i]
        i++
      } else {
        out += keepNewlinesOnly(text.slice(i + 2, closeIdx))
        i = closeIdx + 2
      }
      continue
    }

    if (text.startsWith('<!--', i)) {
      const closeIdx = text.indexOf('-->', i + 4)
      if (closeIdx === -1) {
        out += text[i]
        i++
      } else {
        out += keepNewlinesOnly(text.slice(i + 4, closeIdx))
        i = closeIdx + 3
      }
      continue
    }

    if (text[i] === '\n') atLineStart = true
    out += text[i]
    i++
  }

  return out
}

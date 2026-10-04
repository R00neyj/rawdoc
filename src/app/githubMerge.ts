// 당기기 합치기의 줄 단위 덩어리 계산 — 지연 조각에만 든다 (specs/features/F-2129.md 3.1)
import { Change, diff, type DiffConfig } from '@codemirror/merge'

const REFINE_MAX = 1_000
// 대리쌍 영역(D800–DFFF)을 빼야 라이브러리가 줄 사이를 대리쌍 중간으로 보지 않는다
const LINE_CODES = 0xd800 + (0x10000 - 0xe000)

function lineCode(n: number): string {
  return String.fromCharCode(n < 0xd800 ? n : n + 0x800)
}

// 줄을 끝 \n 까지 한 덩어리로 — 덩어리 경계가 곧 글자 위치라 되돌리기가 정확하다
function splitLines(s: string): string[] {
  return s.match(/[^\n]*\n|[^\n]+$/g) ?? []
}

function offsets(parts: string[]): number[] {
  const out = [0]
  for (const p of parts) out.push(out[out.length - 1] + p.length)
  return out
}

function wholeChange(a: string, b: string): Change[] {
  let pre = 0
  const max = Math.min(a.length, b.length)
  while (pre < max && a.charCodeAt(pre) === b.charCodeAt(pre)) pre++
  let suf = 0
  while (suf < max - pre && a.charCodeAt(a.length - 1 - suf) === b.charCodeAt(b.length - 1 - suf)) suf++
  return [new Change(pre, a.length - suf, pre, b.length - suf)]
}

export function mergeLineDiff(a: string, b: string): readonly Change[] {
  if (a === b) return []
  const linesA = splitLines(a)
  const linesB = splitLines(b)
  const codes = new Map<string, string>()
  const encode = (line: string) => {
    let c = codes.get(line)
    if (c === undefined) {
      if (codes.size >= LINE_CODES) return null
      c = lineCode(codes.size)
      codes.set(line, c)
    }
    return c
  }
  let encA = ''
  let encB = ''
  for (const l of linesA) {
    const c = encode(l)
    if (c === null) return wholeChange(a, b)
    encA += c
  }
  for (const l of linesB) {
    const c = encode(l)
    if (c === null) return wholeChange(a, b)
    encB += c
  }
  const offA = offsets(linesA)
  const offB = offsets(linesB)
  const out: Change[] = []
  for (const lc of diff(encA, encB, { timeout: 500 })) {
    const fromA = offA[lc.fromA]
    const toA = offA[lc.toA]
    const fromB = offB[lc.fromB]
    const toB = offB[lc.toB]
    if (toA - fromA <= REFINE_MAX && toB - fromB <= REFINE_MAX && toA > fromA && toB > fromB) {
      for (const c of diff(a.slice(fromA, toA), b.slice(fromB, toB))) out.push(new Change(c.fromA + fromA, c.toA + fromA, c.fromB + fromB, c.toB + fromB))
    } else {
      out.push(new Change(fromA, toA, fromB, toB))
    }
  }
  return out
}

export const MERGE_DIFF_CONFIG: DiffConfig = { override: mergeLineDiff }
export const MERGE_COLLAPSE = { margin: 3, minSize: 4 }

export function mergeChanges(base: string, result: string): { from: number; to: number; insert: string }[] {
  return mergeLineDiff(base, result).map((c) => ({ from: c.fromA, to: c.toA, insert: result.slice(c.fromB, c.toB) }))
}

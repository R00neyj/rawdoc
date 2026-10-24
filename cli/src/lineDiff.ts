// 줄 단위 diff(Myers)와 unified diff 문자열. 줄은 끝 '\n' 을 품은 채 비교한다 — 마지막 줄의 줄바꿈 유무도 차이로 잡힌다
import { toEditorText } from '../../src/lib/markdown/lineEnding'

export type DiffOp = { kind: 'equal' | 'delete' | 'insert'; line: string }

// 편집 거리가 이보다 크면 가운데를 통째로 지우고 넣은 것으로 본다 — 추적 배열이 거리의 제곱만큼 커진다
const MAX_EDIT_DISTANCE = 2000

// CRLF·CR 은 LF 로 맞춘 뒤 줄마다 '\n' 을 붙여 나눈다. 빈 글은 줄이 없다
export function splitLines(text: string): string[] {
  const normalized = toEditorText(text)
  if (normalized === '') return []
  const lines = normalized.split('\n').map((l) => `${l}\n`)
  const last = lines.length - 1
  if (normalized.endsWith('\n')) lines.pop()
  else lines[last] = lines[last].slice(0, -1)
  return lines
}

function middleDiff(a: string[], b: string[]): DiffOp[] {
  const n = a.length
  const m = b.length
  const max = Math.min(n + m, MAX_EDIT_DISTANCE)
  const offset = max + 1
  const v = new Int32Array(2 * max + 3)
  const trace: Int32Array[] = []
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice())
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x++
        y++
      }
      v[offset + k] = x
      if (x >= n && y >= m) return backtrack(a, b, trace, d, offset)
    }
  }
  return [...a.map((line): DiffOp => ({ kind: 'delete', line })), ...b.map((line): DiffOp => ({ kind: 'insert', line }))]
}

function backtrack(a: string[], b: string[], trace: Int32Array[], dEnd: number, offset: number): DiffOp[] {
  const ops: DiffOp[] = []
  let x = a.length
  let y = b.length
  const snake = (toX: number, toY: number) => {
    while (x > toX && y > toY) {
      x--
      y--
      ops.push({ kind: 'equal', line: a[x] })
    }
  }
  for (let d = dEnd; d > 0; d--) {
    const v = trace[d]
    const k = x - y
    const down = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])
    const prevK = down ? k + 1 : k - 1
    const prevX = v[offset + prevK]
    snake(prevX, prevX - prevK)
    if (down) ops.push({ kind: 'insert', line: b[--y] })
    else ops.push({ kind: 'delete', line: a[--x] })
  }
  snake(0, 0)
  return ops.reverse()
}

export function diffLines(a: string[], b: string[]): DiffOp[] {
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const equal = (line: string): DiffOp => ({ kind: 'equal', line })
  return [
    ...a.slice(0, start).map(equal),
    ...middleDiff(a.slice(start, endA), b.slice(start, endB)),
    ...a.slice(endA).map(equal),
  ]
}

const NO_NEWLINE = '\\ No newline at end of file\n'

function rangeText(start: number, count: number): string {
  if (count === 1) return String(start)
  return `${count === 0 ? start - 1 : start},${count}`
}

export type UnifiedDiff = { text: string; added: number; removed: number }

// 두 글이 같으면 text 는 빈 문자열. context 는 바뀐 줄 앞뒤로 보여 줄 줄 수
export function unifiedDiff(oldText: string, newText: string, labels: { old: string; new: string }, context = 3): UnifiedDiff {
  const ops = diffLines(splitLines(oldText), splitLines(newText))
  const changed = ops.flatMap((op, i) => (op.kind === 'equal' ? [] : [i]))
  if (changed.length === 0) return { text: '', added: 0, removed: 0 }

  const groups: Array<[number, number]> = []
  for (const i of changed) {
    const last = groups[groups.length - 1]
    if (last && i - last[1] <= 2 * context + 1) last[1] = i
    else groups.push([i, i])
  }

  // ops 앞에서부터 옛·새 줄 번호(1부터)를 센다
  const oldNo: number[] = []
  const newNo: number[] = []
  let o = 1
  let n = 1
  for (const op of ops) {
    oldNo.push(o)
    newNo.push(n)
    if (op.kind !== 'insert') o++
    if (op.kind !== 'delete') n++
  }

  const out = [`--- ${labels.old}\n`, `+++ ${labels.new}\n`]
  let added = 0
  let removed = 0
  for (const [first, last] of groups) {
    const from = Math.max(0, first - context)
    const to = Math.min(ops.length - 1, last + context)
    const slice = ops.slice(from, to + 1)
    const oldCount = slice.filter((op) => op.kind !== 'insert').length
    const newCount = slice.filter((op) => op.kind !== 'delete').length
    out.push(`@@ -${rangeText(oldNo[from], oldCount)} +${rangeText(newNo[from], newCount)} @@\n`)
    for (const op of slice) {
      if (op.kind === 'insert') added++
      if (op.kind === 'delete') removed++
      const prefix = op.kind === 'equal' ? ' ' : op.kind === 'insert' ? '+' : '-'
      out.push(op.line.endsWith('\n') ? `${prefix}${op.line}` : `${prefix}${op.line}\n${NO_NEWLINE}`)
    }
  }
  return { text: out.join(''), added, removed }
}

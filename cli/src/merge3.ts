// 줄 단위 3-way 합치기(diff3). base 에서 mine·theirs 가 각자 바꾼 곳을 모으고, 같은 곳을 다르게 바꿨으면 충돌 표시를 넣는다
import { diffLines, splitLines } from './lineDiff'

export type Merge3Labels = { mine: string; theirs: string }
export type Merge3Result = { text: string; conflicts: number }

export const MINE_LABEL = '내 파일'
export const THEIRS_LABEL_PREFIX = '서버 판 '

// merge 가 남긴 여는 줄과 닫는 줄이 둘 다 있으면 정리되지 않은 충돌로 본다
export function hasConflictMarkers(text: string): boolean {
  const lines = splitLines(text).map((l) => l.replace(/\n$/, ''))
  return lines.some((l) => l.startsWith(`<<<<<<< ${MINE_LABEL}`)) && lines.some((l) => l.startsWith(`>>>>>>> ${THEIRS_LABEL_PREFIX}`))
}

// base 줄 i 가 other 의 몇 번째 줄과 맞는지. 맞는 줄이 없으면 -1
function matchesOf(base: string[], other: string[]): Int32Array {
  const match = new Int32Array(base.length).fill(-1)
  let i = 0
  let j = 0
  for (const op of diffLines(base, other)) {
    if (op.kind === 'equal') match[i++] = j++
    else if (op.kind === 'delete') i++
    else j++
  }
  return match
}

function same(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((line, i) => line === b[i])
}

// 표시 줄이 앞 줄 끝에 붙지 않게 마지막 줄에 줄바꿈을 채운다
function closed(lines: string[]): string[] {
  const last = lines.length - 1
  return last >= 0 && !lines[last].endsWith('\n') ? [...lines.slice(0, last), `${lines[last]}\n`] : lines
}

// 결과는 LF 글. 입력의 CRLF 는 LF 로 맞춰 비교한다
export function merge3(base: string, mine: string, theirs: string, labels: Merge3Labels): Merge3Result {
  const b = splitLines(base)
  const m = splitLines(mine)
  const t = splitLines(theirs)
  const matchM = matchesOf(b, m)
  const matchT = matchesOf(b, t)
  const out: string[] = []
  let conflicts = 0
  let i = 0
  let im = 0
  let it = 0
  for (;;) {
    if (i < b.length && matchM[i] === im && matchT[i] === it) {
      out.push(b[i])
      i++
      im++
      it++
      continue
    }
    let j = i
    while (j < b.length && (matchM[j] === -1 || matchT[j] === -1)) j++
    const endM = j < b.length ? matchM[j] : m.length
    const endT = j < b.length ? matchT[j] : t.length
    const baseChunk = b.slice(i, j)
    const mineChunk = m.slice(im, endM)
    const theirsChunk = t.slice(it, endT)
    if (same(mineChunk, baseChunk)) out.push(...theirsChunk)
    else if (same(theirsChunk, baseChunk) || same(mineChunk, theirsChunk)) out.push(...mineChunk)
    else {
      conflicts++
      out.push(`<<<<<<< ${labels.mine}\n`, ...closed(mineChunk), '=======\n', ...closed(theirsChunk), `>>>>>>> ${labels.theirs}\n`)
    }
    if (j >= b.length) break
    i = j
    im = endM
    it = endT
  }
  return { text: out.join(''), conflicts }
}

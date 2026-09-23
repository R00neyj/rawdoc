// 화면 맨 위 원문 줄 ↔ 화면 좌표 순수 함수, import 없이 DOM·CM6·React 를 다루지 않는다 — editor 와 app 이 둘 다 쓴다 (specs/features/F-295.md 6장)

// 화면 맨 위에 보이는 원문 줄. 정수부 = 1-based 줄 번호, 소수부 = 그 블록 안에서 위로 잘린 비율
export type ScrollAnchor = number

// 원문 줄 번호가 붙은 블록 하나. top·bottom 은 스크롤러 안쪽 좌표(scrollTop 과 같은 단위)
export type LineBlock = { line: number; top: number; bottom: number }

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x))
}

export function anchorInBlock(startLine: number, endLine: number, ratio: number): ScrollAnchor {
  const width = Math.max(1, endLine - startLine)
  return startLine + clamp01(ratio) * width
}

export function ratioInBlock(startLine: number, endLine: number, anchor: ScrollAnchor): number {
  const width = Math.max(1, endLine - startLine)
  return clamp01((anchor - startLine) / width)
}

function endLineOf(blocks: LineBlock[], i: number): number {
  return blocks[i + 1]?.line ?? blocks[i].line + 1
}

function heightOf(blocks: LineBlock[], i: number): number {
  const nextTop = blocks[i + 1]?.top ?? blocks[i].bottom
  return Math.max(1, nextTop - blocks[i].top)
}

export function anchorAtTop(blocks: LineBlock[], top: number): ScrollAnchor | null {
  if (blocks.length === 0) return null
  if (top < blocks[0].top) return blocks[0].line

  let i = 0
  for (let j = 0; j < blocks.length; j++) {
    if (blocks[j].top <= top) i = j
    else break
  }

  return anchorInBlock(blocks[i].line, endLineOf(blocks, i), (top - blocks[i].top) / heightOf(blocks, i))
}

export function topForAnchor(blocks: LineBlock[], anchor: ScrollAnchor): number | null {
  if (blocks.length === 0) return null
  if (anchor < blocks[0].line) return 0

  let i = 0
  for (let j = 0; j < blocks.length; j++) {
    if (blocks[j].line <= anchor) i = j
    else break
  }

  return blocks[i].top + ratioInBlock(blocks[i].line, endLineOf(blocks, i), anchor) * heightOf(blocks, i)
}

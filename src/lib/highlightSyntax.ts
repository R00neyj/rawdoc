// ==...== 짝 찾기 (specs/features/F-283.md 3.3). 순수 함수, DOM·CM6·markdown-it 없음 — src/lib/wikiLink.ts 와 같은 자리. 편집·원문 모드 decoration(highlightMark.ts)이 이 함수를 쓴다

export type HighlightMatch = { from: number; to: number; innerFrom: number; innerTo: number }

// 왼쪽부터 '==' 를 찾고 가장 가까운 닫는 '==' 와 짝짓는다(찾으면 그 뒤부터 다시 센다) — formatCommands.ts 의 findMarkerPairs 와 같은 규칙. 안쪽이 비거나(====) 여는/닫는 기호 옆이 공백이면 짝이 아니다(3.2 플랭킹과 맞춘다)
export function findHighlights(lineText: unknown): HighlightMatch[] {
  const results: HighlightMatch[] = []
  if (typeof lineText !== 'string') return results

  let i = 0
  while (i <= lineText.length - 2) {
    if (lineText.slice(i, i + 2) !== '==') {
      i += 1
      continue
    }

    const innerFrom = i + 2
    let j = innerFrom
    let close = -1
    while (j <= lineText.length - 2) {
      if (lineText.slice(j, j + 2) === '==') {
        close = j
        break
      }
      j += 1
    }
    if (close === -1) {
      i += 1
      continue
    }

    const innerTo = close
    if (innerTo <= innerFrom) {
      i += 1
      continue
    }
    if (lineText[innerFrom] === ' ' || lineText[innerTo - 1] === ' ') {
      i += 1
      continue
    }

    results.push({ from: i, to: close + 2, innerFrom, innerTo })
    i = close + 2
  }

  return results
}

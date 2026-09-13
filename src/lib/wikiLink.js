// 위키링크 찾기·해석 (specs/features/F-131.md 2장·2.1)
// 순수 함수. DOM·CM6·markdown-it 을 다루지 않는다 — editor/preview/wikiLinks.js 와
// viewer/renderMarkdown.js 가 각자 쓴다 (architecture.md 1장 "editor → lib, viewer → lib")

// 한 줄 안 위키링크 정규식 (F-131 2장). 대상·별칭 모두 대괄호·파이프·줄바꿈을 담지 않는다
const WIKILINK_RE = /\[\[([^[\]|\n]+?)(?:\|([^[\]\n]+?))?\]\]/g

/**
 * 한 줄 글자에서 위키링크를 전부 찾는다.
 * - `![[…]]`(이미지식)는 대상이 아니다 (원문 그대로)
 * - 대상 제목은 `#` 뒤를 떼고 앞뒤 공백을 지운다(M1 은 `#` 뒤를 무시). 비면 위키링크가 아니다
 * - `targetFrom`·`targetTo` 는 대괄호 안 원문 그대로의 범위(별칭이 있으면 그 앞까지, `#`
 *   뒤도 포함) — "보이는 글자" 범위 계산에 쓴다(별칭 없을 때는 이 범위 전체가 보이는 글자다)
 * @param {string} lineText
 * @returns {{from:number, to:number, target:string, alias:string|null, targetFrom:number, targetTo:number}[]}
 */
export function findWikiLinks(lineText) {
  const results = []
  if (typeof lineText !== 'string') return results

  WIKILINK_RE.lastIndex = 0
  let match
  while ((match = WIKILINK_RE.exec(lineText))) {
    const [full, rawTarget, rawAlias] = match
    const from = match.index
    const to = from + full.length

    if (lineText[from - 1] === '!') continue // ![[…]] 는 대상이 아니다 (F-131 2장)

    const targetFrom = from + 2
    const targetTo = targetFrom + rawTarget.length

    const hashIndex = rawTarget.indexOf('#')
    const semanticTarget = (hashIndex === -1 ? rawTarget : rawTarget.slice(0, hashIndex)).trim()
    if (semanticTarget === '') continue // 대상이 비면 위키링크가 아니다

    results.push({
      from,
      to,
      target: semanticTarget,
      alias: rawAlias !== undefined ? rawAlias : null,
      targetFrom,
      targetTo,
    })
  }

  return results
}

/**
 * 대상 제목 → 문서. `docs` 는 `updatedAt` 내림차순 목록이어야 한다 (F-131 2.1)
 * 1. 제목(앞뒤 공백 제거)이 대상과 정확히 같은 문서
 * 2. 없으면 대소문자 무시(`toLocaleLowerCase('ko')`)로 같은 문서
 * 3. 여러 개면 목록 앞(최근 수정)의 것
 * 제목이 빈 문서는 매칭하지 않는다
 * @param {string} target
 * @param {{title:string}[]} docs
 * @returns {object|null}
 */
export function resolveWikiTarget(target, docs) {
  if (typeof target !== 'string') return null
  const trimmedTarget = target.trim()
  if (trimmedTarget === '') return null

  const candidates = (docs ?? []).filter(
    (doc) => doc && typeof doc.title === 'string' && doc.title.trim() !== '',
  )

  const exact = candidates.find((doc) => doc.title.trim() === trimmedTarget)
  if (exact) return exact

  const lowerTarget = trimmedTarget.toLocaleLowerCase('ko')
  const caseInsensitive = candidates.find(
    (doc) => doc.title.trim().toLocaleLowerCase('ko') === lowerTarget,
  )
  return caseInsensitive ?? null
}

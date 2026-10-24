// 초성·받침 느슨한 비교가 든 조각 매칭 — 순수 함수, DOM·React 없음 (specs/features/F-2053.md 4.3)
import { normalizeForSearch, foldCase } from './docSearch'

export type MatchText = { plain: string; compact: readonly string[] }
export type MatchTerm = { plain: string; chars: readonly string[]; loose: boolean; last: boolean }
export type TermHit = { start: boolean; loose: boolean }

function normalize(text: string): string {
  return foldCase(normalizeForSearch(text))
}

// 초성으로 쓰는 19개 — 음절 분해 공식의 초성 순서와 같다 (4.3)
const BASIC_INITIALS = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ']
const BASIC_INITIAL_INDEX = new Map(BASIC_INITIALS.map((c, i) => [c, i]))

// 겹자음 11개 → 두 초성 (4.3의 3)
const COMPOUND_DECOMPOSE: Record<string, [string, string]> = {
  ㄳ: ['ㄱ', 'ㅅ'],
  ㄵ: ['ㄴ', 'ㅈ'],
  ㄶ: ['ㄴ', 'ㅎ'],
  ㄺ: ['ㄹ', 'ㄱ'],
  ㄻ: ['ㄹ', 'ㅁ'],
  ㄼ: ['ㄹ', 'ㅂ'],
  ㄽ: ['ㄹ', 'ㅅ'],
  ㄾ: ['ㄹ', 'ㅌ'],
  ㄿ: ['ㄹ', 'ㅍ'],
  ㅀ: ['ㄹ', 'ㅎ'],
  ㅄ: ['ㅂ', 'ㅅ'],
}

function isHangulSyllable(ch: string): boolean {
  const code = ch.codePointAt(0) ?? -1
  return code >= 0xac00 && code <= 0xd7a3
}

function initialIndexOf(ch: string): number {
  return Math.floor((ch.codePointAt(0)! - 0xac00) / 588)
}

function medialIndexOf(ch: string): number {
  return Math.floor(((ch.codePointAt(0)! - 0xac00) % 588) / 28)
}

function batchimIndexOf(ch: string): number {
  return (ch.codePointAt(0)! - 0xac00) % 28
}

// 종성(받침) 28개 순서 — 0번은 받침 없음. 겹받침은 두 글자 (4.3의 2)
const BATCHIM_JAMO: readonly (string | null)[] = [
  null,
  'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ',
  'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
]
const SIMPLE_BATCHIM_INDEX = new Map<string, number>()
BATCHIM_JAMO.forEach((jamo, i) => {
  if (jamo && jamo.length === 1) SIMPLE_BATCHIM_INDEX.set(jamo, i)
})

// 대상 글 준비 — plain 은 공백을 그대로 둔 정규화한 글(일반 비교), compact 는 공백을 뗀 글자 배열(느슨한 비교) (4.3)
export function prepareMatchText(text: string): MatchText {
  const plain = normalize(text)
  const compact = Array.from(plain.replace(/\s+/g, ''))
  return { plain, compact }
}

// 검색어를 조각으로 — 명령·템플릿은 공백만, 문서는 공백과 / 도 나눈다(options.slash) (4.1)
export function splitMatchTerms(query: string, options?: { slash?: boolean }): MatchTerm[] {
  const normalized = normalize(query).trim()
  if (normalized === '') return []

  const splitRe = options?.slash ? /[\s/]+/ : /\s+/
  const rawTerms = normalized.split(splitRe).filter((t) => t.length > 0)

  return rawTerms.map((plain, i) => {
    const chars: string[] = []
    for (const ch of plain) {
      const decomposed = COMPOUND_DECOMPOSE[ch]
      if (decomposed) chars.push(...decomposed)
      else chars.push(ch)
    }
    const last = i === rawTerms.length - 1
    const hasJamo = chars.some((c) => BASIC_INITIAL_INDEX.has(c))
    // 마지막 조각은 마지막 글자가 받침이 있어도 느슨한 비교를 시도한다 — 조합 중 받침이 다음 글자 초성으로 넘어가는 경우가 있어서 (main 결정 2026-09-28)
    const loose = hasJamo || last
    return { plain, chars, loose, last }
  })
}

// 글자 하나 비교 — 같은 글자, 초성 자모, (마지막 조각의 마지막 글자일 때만) 받침 확장. nextT 는 대상의 다음 글자(받침이 다음 초성으로 넘어간 경우에 쓴다) (4.3의 2, main 결정 2026-09-28)
function charMatches(q: string, t: string, allowBatchimExt: boolean, nextT: string | undefined): boolean {
  if (q === t) return true
  const qInitial = BASIC_INITIAL_INDEX.get(q)
  if (qInitial !== undefined) {
    return isHangulSyllable(t) && initialIndexOf(t) === qInitial
  }
  if (!allowBatchimExt || !isHangulSyllable(q) || !isHangulSyllable(t)) return false
  if (initialIndexOf(t) !== initialIndexOf(q) || medialIndexOf(t) !== medialIndexOf(q)) return false

  const qBatchim = batchimIndexOf(q)
  if (qBatchim === 0) return true // 조각의 마지막 글자가 받침 없음 — 초성·중성만 같으면 맞는다
  const jamo = BATCHIM_JAMO[qBatchim]
  if (!jamo) return false
  const tBatchim = batchimIndexOf(t)
  if (tBatchim === qBatchim) return true // 받침까지 같음 (q===t 로 이미 걸리지만 방어적으로 둔다)

  const decomposed = COMPOUND_DECOMPOSE[jamo]
  if (decomposed) {
    // 겹받침 — 대상 글자는 앞 자음만 받침으로 갖고, 다음 글자 초성이 뒤 자음과 같으면 맞는다(조합 중 받침이 갈라진 경우)
    const [front, back] = decomposed
    const frontIdx = SIMPLE_BATCHIM_INDEX.get(front)
    if (frontIdx === undefined || tBatchim !== frontIdx) return false
    return nextT !== undefined && isHangulSyllable(nextT) && initialIndexOf(nextT) === BASIC_INITIAL_INDEX.get(back)
  }
  // 홑받침 — 대상 글자는 받침이 없고, 다음 글자 초성이 그 받침과 같으면 맞는다(받침이 다음 글자 초성으로 넘어간 경우)
  if (tBatchim !== 0) return false
  return nextT !== undefined && isHangulSyllable(nextT) && initialIndexOf(nextT) === BASIC_INITIAL_INDEX.get(jamo)
}

// 조각 하나가 대상 글에 맞는지 — 일반 비교 먼저, 안 맞으면(자격 있을 때만) 느슨한 비교 (4.3)
export function matchTerm(term: MatchTerm, text: MatchText): TermHit | null {
  if (term.plain !== '' && text.plain.includes(term.plain)) {
    return { start: text.plain.startsWith(term.plain), loose: false }
  }
  if (!term.loose) return null

  const { chars } = term
  const { compact } = text
  const len = chars.length

  for (let p = 0; p + len <= compact.length; p++) {
    let ok = true
    for (let i = 0; i < len; i++) {
      const isLastChar = i === len - 1
      const allowBatchimExt = isLastChar && term.last
      const nextT = isLastChar ? compact[p + i + 1] : undefined
      if (!charMatches(chars[i], compact[p + i], allowBatchimExt, nextT)) {
        ok = false
        break
      }
    }
    if (ok) return { start: p === 0, loose: true }
  }
  return null
}

// 콜아웃 머리 줄 해석과 종류 → 색 묶음 매핑 (specs/features/F-128.md 2장)
// 순수 함수. DOM·CM6·markdown-it 을 다루지 않는다 — lines.js·inline.js·renderMarkdown.js 가 각자 쓴다

export type CalloutHeader = {
  type: string
  kind: string
  fold: string
  title: string
  typeFrom: number
  typeTo: number
}

// '>' 와 그 뒤 공백을 뗀 나머지에 적용하는 머리 줄 정규식 (F-128 2장)
// 1번: 종류(대소문자 그대로 캡처, 비교는 소문자로), 2번: 접기 기호, 3번: 제목
const HEADER_RE = /^\[!([^\]\s]+)\]([+-]?)(?:[ \t]+(.*))?$/

// 종류(별칭, 소문자) → 색 묶음 (F-128 2.1). 별칭은 모두 소문자로 등록한다
const KIND_ALIASES: Record<string, string> = {
  note: 'note',
  info: 'note',
  todo: 'note',

  abstract: 'tip',
  summary: 'tip',
  tldr: 'tip',
  tip: 'tip',
  hint: 'tip',
  important: 'tip', // GitHub [!IMPORTANT]

  success: 'success',
  check: 'success',
  done: 'success',

  question: 'question',
  help: 'question',
  faq: 'question',

  warning: 'warning',
  caution: 'warning', // GitHub [!CAUTION]
  attention: 'warning',

  failure: 'danger',
  fail: 'danger',
  missing: 'danger',
  danger: 'danger',
  error: 'danger',
  bug: 'danger',

  example: 'example',

  quote: 'quote',
  cite: 'quote',
}

// 종류 이름 → 색 묶음. 별칭 목록에 없으면 Obsidian 규칙대로 'note' (F-128 2.1 표 마지막 행)
function calloutKind(type: string): string {
  return KIND_ALIASES[type.toLowerCase()] ?? 'note'
}

// 콜아웃 머리 줄(> 와 그 뒤 공백을 뗀 첫 줄)을 해석한다. typeFrom·typeTo 는 '[' 부터 ']'(접기 기호 포함) 끝까지의 위치
export function parseCalloutHeader(text: string): CalloutHeader | null {
  const match = HEADER_RE.exec(text)
  if (!match) return null

  const [, type, fold, titleRaw] = match
  // '[' '!' type ']' 뒤에 fold 가 곧바로 온다 — 위치는 문자 길이로 계산한다
  const closeBracketIndex = 2 + type.length // '[' + '!' + type 뒤가 ']'
  const typeTo = closeBracketIndex + 1 + fold.length // ']' 다음(+1) + fold 길이

  return {
    type,
    kind: calloutKind(type),
    fold,
    title: (titleRaw ?? '').trim(),
    typeFrom: 0,
    typeTo,
  }
}

// 제목이 없을 때 쓰는 기본 제목 — 첫 글자만 대문자 (F-128 2.2)
export function defaultCalloutTitle(type: string): string {
  if (type.length === 0) return type
  return type.charAt(0).toUpperCase() + type.slice(1)
}

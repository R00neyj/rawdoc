// 주석 문법(%% …%%, <!-- … -->) 제거 — 공유 화면 노출 방지, 펜스·인라인코드 안은 제외, 줄 수·CRLF 유지 (F-214.md 2.1)
// "코드 안" 판정은 여는 기호 앞마다 끼운 PUA 문자 표지를 markdown-it 코드 토큰 경계로 본다 — 줄 첫 칸 기준 자체 스캐너는 이를 몰라 뒤쪽 주석을 남겼다 (리뷰 L1·L2)
import MarkdownIt from 'markdown-it'
import type { Token } from 'markdown-it'
import { findFrontmatter, textAfterFrontmatter } from './frontmatter'

// 보기 화면(src/viewer/renderMarkdown.ts)과 같은 옵션. 그쪽 플러그인은 코드 토큰 경계를 만들지 않아 넣지 않는다
const md = new MarkdownIt({ html: false, linkify: true, typographer: false, breaks: false })

const CODE_TOKEN_TYPES = new Set(['fence', 'code_block', 'code_inline'])
// 표지 = base(열기) + 10진수 자리들(base+0x10…+0x19) + base+1(닫기). 문서에 그 범위 문자가 있으면 다음 후보로
const MARK_BASES = [0xe000, 0xe100, 0xe200, 0xe300, 0xf000]
// 지운 결과를 다시 해석해 더 지울 것이 없을 때까지 되풀이하는 횟수 상한
const MAX_PASSES = 8

function keepNewlinesOnly(s: string): string {
  let out = ''
  for (let j = 0; j < s.length; j++) {
    if (s[j] === '\n' || s[j] === '\r') out += s[j]
  }
  return out
}

function isOpenerAt(text: string, i: number): boolean {
  return (text[i] === '%' && text[i + 1] === '%') || text.startsWith('<!--', i)
}

function pickMarkBase(text: string): number | null {
  for (const base of MARK_BASES) {
    let clash = false
    for (let j = 0; j < text.length; j++) {
      const c = text.charCodeAt(j)
      if (c >= base && c <= base + 0x1f) {
        clash = true
        break
      }
    }
    if (!clash) return base
  }
  return null
}

function collectCodeContent(tokens: Token[], out: string[]): void {
  for (const t of tokens) {
    if (CODE_TOKEN_TYPES.has(t.type)) out.push(t.content)
    if (t.children) collectCodeContent(t.children, out)
  }
}

// 여는 기호 위치 가운데 markdown-it 이 코드 안으로 읽는 위치들. 표지 문자를 고를 수 없으면 null
function codeOpenerPositions(text: string): Set<number> | null {
  const base = pickMarkBase(text)
  if (base === null) return null
  const open = String.fromCharCode(base)
  const close = String.fromCharCode(base + 1)
  const digit = (d: number) => String.fromCharCode(base + 0x10 + d)

  let marked = ''
  for (let i = 0; i < text.length; i++) {
    if (isOpenerAt(text, i)) {
      marked += open
      for (const d of String(i)) marked += digit(Number(d))
      marked += close
    }
    marked += text[i]
  }

  // 보기 화면처럼 프론트매터는 떼고 본문만 파싱한다. 프론트매터 안은 코드가 아니다
  const frontmatter = findFrontmatter(marked)
  const body = frontmatter ? textAfterFrontmatter(marked, frontmatter) : marked

  const contents: string[] = []
  collectCodeContent(md.parse(body, {}), contents)
  const inCode = new Set<number>()
  const markRe = new RegExp(`${open}([${digit(0)}-${digit(9)}]+)${close}`, 'g')
  for (const c of contents) {
    for (const m of c.matchAll(markRe)) {
      let i = 0
      for (const ch of m[1]) i = i * 10 + (ch.charCodeAt(0) - base - 0x10)
      inCode.add(i)
    }
  }
  return inCode
}

function stripOnce(text: string, inCode: Set<number>): string {
  let out = ''
  let i = 0
  const n = text.length
  while (i < n) {
    if (isOpenerAt(text, i) && !inCode.has(i)) {
      const isHtml = text[i] === '<'
      const closeIdx = isHtml ? text.indexOf('-->', i + 4) : text.indexOf('%%', i + 2)
      if (closeIdx !== -1) {
        out += keepNewlinesOnly(text.slice(i + (isHtml ? 4 : 2), closeIdx))
        i = closeIdx + (isHtml ? 3 : 2)
        continue
      }
    }
    out += text[i]
    i++
  }
  return out
}

export function stripComments(text: string): string {
  if (!text.includes('%%') && !text.includes('<!--')) return text
  // 주석을 지우면 블록 구조가 바뀔 수 있다(예: 주석이 펜스 여는 줄을 삼킴). 받는 사람이 보는 것은 결과 문서의
  // 해석이므로, 결과를 다시 해석해 더 지울 것이 없을 때까지 되풀이한다
  let current = text
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const inCode = codeOpenerPositions(current)
    // 표지 문자를 고를 수 없으면 코드 구분 없이 지운다 — 코드 속 글자가 빠지는 편이 주석 노출보다 낫다
    const next = stripOnce(current, inCode ?? new Set())
    if (next === current) return current
    current = next
  }
  return stripOnce(current, new Set())
}

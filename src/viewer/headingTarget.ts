// 원문 → 제목 목록·링크 헤딩이 가리키는 줄. 보기 결과의 data-source-line 과 같은 줄 번호를 내려고 renderMarkdown 의 markdown-it 을 쓴다 (specs/features/F-2018.md 7.1·7.2)
import { findFrontmatter, textAfterFrontmatter } from '../lib/frontmatter'
import { parseMarkdownTokens } from './renderMarkdown'

export type DocHeading = { level: 1 | 2 | 3 | 4 | 5 | 6; text: string; raw: string; line: number }

export function listDocHeadings(markdown: string): DocHeading[] {
  if (typeof markdown !== 'string' || markdown === '') return []
  const frontmatter = findFrontmatter(markdown)
  const body = frontmatter ? textAfterFrontmatter(markdown, frontmatter) : markdown
  const lineOffset = frontmatter ? (markdown.slice(0, markdown.length - body.length).match(/\n/g) || []).length : 0

  const tokens = parseMarkdownTokens(body)
  const headings: DocHeading[] = []
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token.type !== 'heading_open' || token.level !== 0 || !token.map) continue
    const inline = tokens[i + 1]
    let text = ''
    for (const child of inline?.children ?? []) {
      if (child.type === 'text' || child.type === 'code_inline') text += child.content
      else if (child.type === 'softbreak') text += ' '
    }
    headings.push({
      level: Number(token.tag.slice(1)) as DocHeading['level'],
      text: text.trim(),
      raw: (inline?.content ?? '').trim(),
      line: lineOffset + token.map[0] + 1,
    })
  }
  return headings
}

const loose = (s: string) =>
  s
    .replace(/[#^:|[\]%]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

// 정확 → 대소문자 무시 → 기호 지운 비교(text 또는 raw). 앞 단계에서 맞으면 그 단계의 문서 순서 첫 제목
export function findHeadingLine(markdown: string, wanted: string): number | null {
  const target = typeof wanted === 'string' ? wanted.trim() : ''
  if (target === '') return null
  const headings = listDocHeadings(markdown)
  const folded = target.toLowerCase()
  const loosened = loose(target)
  const stages: ((h: DocHeading) => boolean)[] = [
    (h) => h.text === target,
    (h) => h.text.toLowerCase() === folded,
    (h) => loosened !== '' && (loose(h.text) === loosened || loose(h.raw) === loosened),
  ]
  for (const matches of stages) {
    const hit = headings.find(matches)
    if (hit) return hit.line
  }
  return null
}

// 마크다운 원문 → 평문(.txt) 변환. 순수 함수, DOM 없음 — 보기 모드와 같은 토큰을 순회한다, HTML 을 다시 파싱하지 않는다(F-278.md 4.1)
import type { Token } from 'markdown-it'
import { parseMarkdownTokens } from './renderMarkdown'
import { stripComments } from '../lib/comments'
import { findFrontmatter, textAfterFrontmatter } from '../lib/frontmatter'
import { isMermaidInfo } from '../lib/codeLang'
import type { ParsedImageBlock } from '../lib/imageBlock'
import type { LineEnding } from '../types'

// ==글자== 만 뗀다 — F-283 이 하이라이트를 토큰으로 지원할 때까지의 예외(4.6)
const HIGHLIGHT_RE = /==(.+?)==/g
function stripHighlight(s: string): string {
  return s.replace(HIGHLIGHT_RE, '$1')
}

const CHECKBOX_RE = /^<input\s+type="checkbox"/i
const BR_RE = /^<br\s*\/?>/i

// children(같은 깊이의 인라인 토큰 배열) 안에서 openIndex 의 짝이 되는 닫는 토큰 위치를 찾는다(중첩 대비 깊이 계산)
function findInlineClose(children: Token[], openIndex: number, openType: string, closeType: string): number {
  let depth = 1
  for (let j = openIndex + 1; j < children.length; j++) {
    if (children[j].type === openType) depth++
    else if (children[j].type === closeType) {
      depth--
      if (depth === 0) return j
    }
  }
  return children.length
}

// 인라인 토큰 배열 → 평문 (4.5)
function inlineToText(children: Token[]): string {
  let out = ''
  let i = 0
  while (i < children.length) {
    const t = children[i]
    switch (t.type) {
      case 'text':
        out += stripHighlight(t.content)
        i++
        break
      case 'code_inline':
        out += t.content
        i++
        break
      case 'softbreak':
        out += ' '
        i++
        break
      case 'hardbreak':
        out += '\n'
        i++
        break
      case 'strong_open':
      case 'strong_close':
      case 'em_open':
      case 'em_close':
      case 's_open':
      case 's_close':
        i++
        break
      case 'link_open': {
        const close = findInlineClose(children, i, 'link_open', 'link_close')
        const inner = inlineToText(children.slice(i + 1, close))
        const href = t.attrGet('href') ?? ''
        out += inner === href || t.markup === 'linkify' ? href : `${inner} (${href})`
        i = close + 1
        break
      }
      case 'image': {
        const alt = inlineToText(t.children ?? []).trim()
        out += alt ? `[이미지: ${alt}]` : '[이미지]'
        i++
        break
      }
      case 'wikilink_open': {
        const close = findInlineClose(children, i, 'wikilink_open', 'wikilink_close')
        out += inlineToText(children.slice(i + 1, close))
        i = close + 1
        break
      }
      case 'wikilink_span_open': {
        const close = findInlineClose(children, i, 'wikilink_span_open', 'wikilink_span_close')
        out += inlineToText(children.slice(i + 1, close))
        i = close + 1
        break
      }
      case 'html_inline':
        if (BR_RE.test(t.content)) out += '\n'
        // 체크박스는 4.4 에서 처리 — 인라인 출력에는 넣지 않는다. 그 밖의 html_inline 은 버린다(4.5)
        i++
        break
      default:
        out += t.children ? inlineToText(t.children) : t.content
        i++
    }
  }
  return out
}

// tokens[openIndex] 와 짝이 되는 closeType 토큰 위치를 [openIndex, end) 안에서 찾는다(블록 레벨, 4.4)
function findBlockClose(tokens: Token[], openIndex: number, closeType: string, end: number): number {
  const openType = tokens[openIndex].type
  let depth = 1
  for (let j = openIndex + 1; j < end; j++) {
    if (tokens[j].type === openType) depth++
    else if (tokens[j].type === closeType) {
      depth--
      if (depth === 0) return j
    }
  }
  return end - 1
}

// 모든 줄 앞에 prefix. 빈 줄은 뒤에 공백을 남기지 않는다(인용, 4.4)
function prefixLines(text: string, prefix: string): string {
  return text
    .split('\n')
    .map((line) => (line === '' ? prefix.trimEnd() : prefix + line))
    .join('\n')
}

// list_item_open 의 class="task-list-item" 인 항목에서 체크 여부를 읽는다(taskListsRule 이 남긴 html_inline)
function findCheckboxChecked(tokens: Token[], start: number, end: number): boolean {
  for (let j = start; j < end; j++) {
    const tok = tokens[j]
    if (tok.type === 'inline' && tok.children) {
      const first = tok.children[0]
      if (first && first.type === 'html_inline' && CHECKBOX_RE.test(first.content)) {
        return first.content.includes('checked')
      }
    }
  }
  return false
}

function renderTable(tokens: Token[], start: number, end: number): string {
  const rows: string[] = []
  let i = start
  while (i < end) {
    if (tokens[i].type === 'tr_open') {
      const rowClose = findBlockClose(tokens, i, 'tr_close', end)
      const cells: string[] = []
      let j = i + 1
      while (j < rowClose) {
        const cellType = tokens[j].type
        if (cellType === 'th_open' || cellType === 'td_open') {
          const cellCloseType = cellType === 'th_open' ? 'th_close' : 'td_close'
          const cellClose = findBlockClose(tokens, j, cellCloseType, rowClose)
          const inline = tokens[j + 1]
          cells.push(inline?.type === 'inline' ? inlineToText(inline.children ?? []) : '')
          j = cellClose + 1
        } else {
          j++
        }
      }
      rows.push(cells.join('\t'))
      i = rowClose + 1
    } else {
      i++
    }
  }
  return rows.join('\n')
}

// 목록 하나(bullet_list_open 또는 ordered_list_open 안쪽) → 평문 한 블록. 항목 안은 줄바꿈 하나로 잇는다 — 문서 전체의 '\n\n' 잇기와 다르다(4.4)
function renderList(tokens: Token[], start: number, end: number, ordered: boolean): string {
  const items: string[] = []
  let autoNum = 1
  let i = start
  while (i < end) {
    const t = tokens[i]
    if (t.type !== 'list_item_open') {
      i++
      continue
    }
    const close = findBlockClose(tokens, i, 'list_item_close', end)

    let marker = ordered ? `${t.info && t.info.trim() !== '' ? t.info.trim() : String(autoNum)}. ` : '- '
    if (t.attrGet('class') === 'task-list-item') {
      marker += findCheckboxChecked(tokens, i + 1, close) ? '[x]' : '[ ]'
    }

    const innerBlocks = renderBlockSequence(tokens, i + 1, close)
    const combinedInner = innerBlocks.join('\n')
    const lines = combinedInner.split('\n')
    const built = lines.map((line, idx) => (idx === 0 ? marker + line : line === '' ? '' : `  ${line}`)).join('\n')
    items.push(built)

    autoNum++
    i = close + 1
  }
  return items.join('\n')
}

// tokens[start, end) 의 최상위 블록들을 평문 문자열 배열로. 호출부가 이어붙이는 방식을 정한다(문서·인용은 '\n\n', 목록 항목 안은 '\n')
function renderBlockSequence(tokens: Token[], start: number, end: number): string[] {
  const blocks: string[] = []
  let i = start
  while (i < end) {
    const t = tokens[i]
    switch (t.type) {
      case 'heading_open': {
        const close = findBlockClose(tokens, i, 'heading_close', end)
        const inline = tokens[i + 1]
        blocks.push(inline?.type === 'inline' ? inlineToText(inline.children ?? []) : '')
        i = close + 1
        break
      }
      case 'paragraph_open': {
        const close = findBlockClose(tokens, i, 'paragraph_close', end)
        const inline = tokens[i + 1]
        blocks.push(inline?.type === 'inline' ? inlineToText(inline.children ?? []) : '')
        i = close + 1
        break
      }
      case 'bullet_list_open':
      case 'ordered_list_open': {
        const closeType = t.type === 'bullet_list_open' ? 'bullet_list_close' : 'ordered_list_close'
        const close = findBlockClose(tokens, i, closeType, end)
        blocks.push(renderList(tokens, i + 1, close, t.type === 'ordered_list_open'))
        i = close + 1
        break
      }
      case 'blockquote_open': {
        const close = findBlockClose(tokens, i, 'blockquote_close', end)
        const inner = renderBlockSequence(tokens, i + 1, close).join('\n\n')
        blocks.push(prefixLines(inner, '> '))
        i = close + 1
        break
      }
      case 'table_open': {
        const close = findBlockClose(tokens, i, 'table_close', end)
        blocks.push(renderTable(tokens, i + 1, close))
        i = close + 1
        break
      }
      case 'fence':
      case 'code_block': {
        if (t.type === 'fence' && isMermaidInfo(t.info)) {
          blocks.push('[다이어그램]')
        } else {
          blocks.push(t.content.replace(/\n$/, ''))
        }
        i++
        break
      }
      case 'html_block': {
        const parsed = t.meta as ParsedImageBlock | undefined
        if (parsed) blocks.push(parsed.alt ? `[이미지: ${parsed.alt}]` : '[이미지]')
        i++
        break
      }
      case 'hr':
        blocks.push('---')
        i++
        break
      default:
        i++
    }
  }
  return blocks
}

// 4.3 입력 처리 순서 그대로. text 는 에디터 원문(handle.getText 결과) — line ending 은 이 함수가 끝에서 맞춘다
export function toPlainText(text: string, lineEnding: LineEnding): string {
  const withoutComments = stripComments(text)
  const frontmatter = findFrontmatter(withoutComments)
  const body = frontmatter ? textAfterFrontmatter(withoutComments, frontmatter) : withoutComments

  const tokens = parseMarkdownTokens(body)
  const joined = renderBlockSequence(tokens, 0, tokens.length).join('\n\n')

  let result = `${joined}\n`
  if (lineEnding === 'crlf') result = result.replace(/\n/g, '\r\n')
  return result
}

// 마크다운 → HTML 문자열 변환 (specs/features/F-123.md 3.2)
// 순수 함수. DOM·React 를 다루지 않는다
import MarkdownIt from 'markdown-it'

import { parseCalloutHeader, defaultCalloutTitle } from '../lib/callout.js'

// html:false — 원문 HTML 태그는 파싱하지 않고 글자 그대로(이스케이프되어) 보인다.
// 링크·이미지 주소 검사는 markdown-it 기본 validateLink 를 그대로 쓴다
// (javascript: vbscript: file: data: 를 막는다)
const md = new MarkdownIt({ html: false, linkify: true, typographer: false, breaks: false })

// ----- 작업 목록 (F-123.md 3.2) -----
// markdown-it-task-lists 는 갱신이 끊겨 쓰지 않고 직접 만든다
const TASK_PREFIX_RE = /^\[( |x|X)\] /

function taskListsRule(state) {
  const tokens = state.tokens
  const listStack = []

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]

    if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') {
      listStack.push(token)
      continue
    }
    if (token.type === 'bullet_list_close' || token.type === 'ordered_list_close') {
      listStack.pop()
      continue
    }
    if (token.type !== 'list_item_open') continue

    let j = i + 1
    if (tokens[j] && tokens[j].type === 'paragraph_open') j++
    const inline = tokens[j]
    if (!inline || inline.type !== 'inline' || !inline.children || inline.children.length === 0) {
      continue
    }

    const firstChild = inline.children[0]
    if (firstChild.type !== 'text') continue

    const match = TASK_PREFIX_RE.exec(firstChild.content)
    if (!match) continue

    const checked = match[1] !== ' '
    // "[ ] "·"[x] "·"[X] " 중 앞 3글자("[ ]" 형태)만 떼어 낸다. 남는 공백 1개가
    // 체크박스와 본문 사이 구분자가 된다 (F-123.md 3.2)
    firstChild.content = firstChild.content.slice(3)

    const checkbox = new state.Token('html_inline', '', 0)
    checkbox.content = `<input type="checkbox" disabled${checked ? ' checked' : ''}>`
    inline.children.unshift(checkbox)

    token.attrSet('class', 'task-list-item')
    const list = listStack[listStack.length - 1]
    if (list) list.attrSet('class', 'contains-task-list')
  }
}

md.core.ruler.push('task_lists', taskListsRule)

// ----- 콜아웃 (F-128.md 3.2, 4.2) -----
// 'inline' 규칙 전에 실행해 blockquote_open 바로 다음(첫 문단)의 raw 텍스트(아직
// 인라인 파싱 전, token.content)를 직접 검사한다. markdown-it 은 이 content 에
// 인용의 '>' 와 그 뒤 공백을 이미 떼어 두므로 F-128 2장 정규식을 그대로 적용할 수 있다.
// 중첩 인용도 blockquote_open 은 전부 이 규칙을 거치므로 "보기 모드는 안쪽도 콜아웃으로
// 변환한다"(F-128 2장)가 그대로 만족된다 — 편집 모드처럼 "바깥만" 예외를 두지 않는다
function calloutRule(state) {
  const tokens = state.tokens

  for (let i = 0; i < tokens.length; i++) {
    const open = tokens[i]
    if (open.type !== 'blockquote_open') continue

    const paragraphOpen = tokens[i + 1]
    const inline = tokens[i + 2]
    const paragraphClose = tokens[i + 3]
    if (paragraphOpen?.type !== 'paragraph_open') continue
    if (inline?.type !== 'inline') continue
    if (paragraphClose?.type !== 'paragraph_close') continue

    const content = inline.content
    const newlineIndex = content.indexOf('\n')
    const firstLine = newlineIndex === -1 ? content : content.slice(0, newlineIndex)
    const header = parseCalloutHeader(firstLine)
    if (!header) continue

    const rest = newlineIndex === -1 ? '' : content.slice(newlineIndex + 1)
    const type = header.type.toLowerCase()

    // 짝이 되는 blockquote_close 를 찾는다 (중첩 인용 대비 깊이 계산)
    let depth = 1
    let closeIndex = -1
    for (let j = i + 1; j < tokens.length; j++) {
      if (tokens[j].type === 'blockquote_open') depth++
      else if (tokens[j].type === 'blockquote_close') {
        depth--
        if (depth === 0) {
          closeIndex = j
          break
        }
      }
    }
    if (closeIndex === -1) continue // 짝을 못 찾으면(있을 수 없지만) 손대지 않는다

    // Blockquote → div (F-128 4.2. blockquote 스타일이 섞이지 않게)
    open.tag = 'div'
    open.attrSet('class', `markdown-callout md-callout--${header.kind}`)
    open.attrSet('data-callout', type)
    tokens[closeIndex].tag = 'div'

    // 머리 줄의 [!type] 과 접기 기호는 출력하지 않는다 — 제목만 별도 문단으로 뗀다
    const titleOpen = new state.Token('paragraph_open', 'p', 1)
    titleOpen.attrSet('class', 'markdown-callout-title')
    const titleInline = new state.Token('inline', '', 0)
    titleInline.content = header.title || defaultCalloutTitle(header.type)
    titleInline.children = []
    const titleClose = new state.Token('paragraph_close', 'p', -1)

    const replacement = [titleOpen, titleInline, titleClose]

    if (rest.length > 0) {
      // 첫 줄 다음부터가 본문 (F-128 2장). 원래 문단이 이어서 갖고 있던 내용이라
      // 인라인 파싱은 그대로 뒤이은 'inline' 코어 규칙이 처리한다
      const bodyOpen = new state.Token('paragraph_open', 'p', 1)
      const bodyInline = new state.Token('inline', '', 0)
      bodyInline.content = rest
      bodyInline.children = []
      const bodyClose = new state.Token('paragraph_close', 'p', -1)
      replacement.push(bodyOpen, bodyInline, bodyClose)
    }

    tokens.splice(i + 1, 3, ...replacement)
  }
}

md.core.ruler.before('inline', 'callout', calloutRule)

// ----- 링크: target·rel (F-123.md 3.2) -----
const defaultLinkOpen =
  md.renderer.rules.link_open ||
  function (tokens, idx, options, env, self) {
    return self.renderToken(tokens, idx, options)
  }

md.renderer.rules.link_open = function (tokens, idx, options, env, self) {
  tokens[idx].attrSet('target', '_blank')
  tokens[idx].attrSet('rel', 'noopener noreferrer')
  return defaultLinkOpen(tokens, idx, options, env, self)
}

// ----- 이미지: <img> 대신 링크 (F-123.md 3.2, F-116 오프라인 원칙) -----
md.renderer.rules.image = function (tokens, idx, options, env, self) {
  const token = tokens[idx]
  const srcIndex = token.attrIndex('src')
  const src = srcIndex >= 0 ? token.attrs[srcIndex][1] : ''
  const alt = self.renderInlineAsText(token.children || [], options, env).trim()
  const label = alt === '' ? '이미지' : `이미지: ${alt}`
  return `<a href="${md.utils.escapeHtml(src)}" target="_blank" rel="noopener noreferrer">${md.utils.escapeHtml(label)}</a>`
}

// 코드블록(fence)의 language-{info 첫 단어} 클래스, 제목 앵커 없음은 markdown-it 기본
// 동작 그대로다 (options.highlight 를 주지 않아 구문 강조 없음)

/**
 * @param {string} text 저장소·에디터 원문 그대로 (CRLF 도 그대로 넘길 수 있다 —
 *   markdown-it 이 파싱 전 줄바꿈을 정규화한다)
 * @returns {string} HTML 문자열
 */
export function renderMarkdown(text) {
  return md.render(text)
}

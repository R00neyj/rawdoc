// 마크다운 → HTML 문자열 변환 (specs/features/F-123.md 3.2)
// 순수 함수. DOM·React 를 다루지 않는다
import MarkdownIt from 'markdown-it'

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

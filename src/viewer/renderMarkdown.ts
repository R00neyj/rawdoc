// 마크다운 → HTML 문자열 변환 (specs/features/F-123.md 3.2)
// 순수 함수. DOM·React 를 다루지 않는다
import MarkdownIt from 'markdown-it'
import type { StateCore, Token, RendererRule } from 'markdown-it'

import { parseCalloutHeader, defaultCalloutTitle } from '../lib/callout'
import { calloutIconSvg } from '../lib/calloutIcons'
import { findWikiLinks } from '../lib/wikiLink'
import { findFrontmatter, parseSimpleProperties, textAfterFrontmatter } from '../lib/frontmatter'
import { parseImageBlock } from '../lib/imageBlock'
import type { ParsedImageBlock } from '../lib/imageBlock'
import { isMermaidInfo } from '../lib/codeLang'

// html:false — 원문 HTML 태그는 파싱하지 않고 글자 그대로(이스케이프되어) 보인다.
// 링크·이미지 주소 검사는 markdown-it 기본 validateLink 를 그대로 쓴다
// (javascript: vbscript: file: data: 를 막는다)
const md = new MarkdownIt({ html: false, linkify: true, typographer: false, breaks: false })

// ----- 작업 목록 (F-123.md 3.2) -----
// markdown-it-task-lists 는 갱신이 끊겨 쓰지 않고 직접 만든다
const TASK_PREFIX_RE = /^\[( |x|X)\] /

function taskListsRule(state: StateCore): void {
  const tokens = state.tokens
  const listStack: Token[] = []

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
function calloutRule(state: StateCore): void {
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

    // 머리 줄의 [!type] 과 접기 기호는 출력하지 않는다 — 제목만 별도 문단으로 뗀다.
    // 종류 아이콘은 제목 앞 첫 자식(F-148 3.2) — html_inline 토큰으로 titleInline.children
    // 에 먼저 넣어 둔다. 'inline' 코어 규칙이 titleInline.content 를 파싱해 나온 토큰들을
    // 이 배열에 이어 붙이므로(비우지 않고 push) 순서가 [아이콘, ...제목 파싱 결과] 가 된다.
    // svg 는 앱에 들어 있는 파일 원문(calloutIconSvg)이라 사용자 입력이 아니다
    const titleOpen = new state.Token('paragraph_open', 'p', 1)
    titleOpen.attrSet('class', 'markdown-callout-title')
    const iconToken = new state.Token('html_inline', '', 0)
    iconToken.content = `<span class="markdown-callout-icon" aria-hidden="true">${calloutIconSvg(header.type)}</span>`
    const titleInline = new state.Token('inline', '', 0)
    titleInline.content = header.title || defaultCalloutTitle(header.type)
    titleInline.children = [iconToken]
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

// ----- 이미지 블록 (F-158.md 2.1) — src 는 출력하지 않고 data-attachment 로 id 만 남겨 Viewer 가 채운다 -----
function renderImageBlockHtml(parsed: ParsedImageBlock): string {
  const align = md.utils.escapeHtml(parsed.align)
  const id = md.utils.escapeHtml(parsed.id)
  const alt = md.utils.escapeHtml(parsed.alt)
  const style = parsed.width ? ` style="width:${parsed.width}px"` : ''
  const widthAttr = parsed.width ? ` width="${parsed.width}"` : ''
  return `<div class="md-image md-image--${align}"${style}><img data-attachment="${id}" alt="${alt}"${widthAttr}></div>\n`
}

// token.level === 0 은 목록·인용 등 컨테이너 밖(최상위) 문단만 고른다는 뜻이다
function imageBlockRule(state: StateCore): void {
  const tokens = state.tokens

  for (let i = 0; i < tokens.length; i++) {
    const open = tokens[i]
    if (open.type !== 'paragraph_open' || open.level !== 0) continue

    const inline = tokens[i + 1]
    const close = tokens[i + 2]
    if (inline?.type !== 'inline' || close?.type !== 'paragraph_close') continue

    const parsed = parseImageBlock(inline.content)
    if (!parsed) continue

    const html = new state.Token('html_block', '', 0)
    html.content = renderImageBlockHtml(parsed)
    html.block = true
    html.map = open.map

    tokens.splice(i, 3, html)
  }
}

md.core.ruler.before('inline', 'image_block', imageBlockRule)

// ----- 링크: target·rel (F-123.md 3.2) -----
const defaultLinkOpen: RendererRule =
  md.renderer.rules.link_open ||
  function (tokens, idx, options, _env, self) {
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
  const src = srcIndex >= 0 ? String(token.attrs![srcIndex][1]) : ''
  const alt = self.renderInlineAsText(token.children || [], options, env).trim()
  const label = alt === '' ? '이미지' : `이미지: ${alt}`
  return `<a href="${md.utils.escapeHtml(src)}" target="_blank" rel="noopener noreferrer">${md.utils.escapeHtml(label)}</a>`
}

// 코드블록(fence)의 language-{info 첫 단어} 클래스, 제목 앵커 없음은 markdown-it 기본
// 동작 그대로다 (options.highlight 를 주지 않아 구문 강조 없음)

// ----- Mermaid 다이어그램 (F-258.md 2.4) — mermaid 면 placeholder div(Viewer.tsx 가 채운다), 아니면 기본 fence 렌더러 위임 -----
const defaultFence: RendererRule =
  md.renderer.rules.fence ||
  function (tokens, idx, options, _env, self) {
    return self.renderToken(tokens, idx, options)
  }

md.renderer.rules.fence = function (tokens, idx, options, env, self) {
  const token = tokens[idx]
  if (isMermaidInfo(token.info)) {
    return `<div class="md-mermaid" data-mermaid-source="${md.utils.escapeHtml(token.content)}"></div>\n`
  }
  return defaultFence(tokens, idx, options, env, self)
}

// ----- 제목 원문 줄 번호 (F-144.md 3.4) — body 기준 0-based 에 프론트매터 줄 수를 더해 1-based -----
const defaultHeadingOpen: RendererRule =
  md.renderer.rules.heading_open ||
  function (tokens, idx, options, _env, self) {
    return self.renderToken(tokens, idx, options)
  }

md.renderer.rules.heading_open = function (tokens, idx, options, env, self) {
  const token = tokens[idx]
  if (token.map && (token.tag === 'h1' || token.tag === 'h2' || token.tag === 'h3')) {
    const lineOffset = (env as { lineOffset?: number } | undefined)?.lineOffset ?? 0
    const sourceLine = lineOffset + token.map[0] + 1
    token.attrSet('data-source-line', String(sourceLine))
  }
  return defaultHeadingOpen(tokens, idx, options, env, self)
}

// ----- 위키링크 (F-131.md 4장, F-252.md 4.1) -----
// 'inline' 규칙(코드 span·기존 링크 등을 이미 처리해 각각 code_inline·link_open 등의
// 토큰으로 나눈 뒤) 다음에 실행해, 남은 'text' 자식 토큰(순수 글자)만 훑는다 — 이렇게
// 하면 인라인코드·fence(펜스는 애초에 'inline' 토큰이 아니다)는 자연히 대상에서 빠진다.
// 표 칸은 'inline' 토큰이 따로 생기므로 table_open/close 로 깊이를 세어 건너뛴다

// 대상 제목 → href 문자열(찾으면) | null(못 찾으면) — href 모양은 호출부가 정한다 (F-252.md 4.1)
type ResolveWikiLink = (target: string) => string | null

function wikiLinkTokens(
  state: StateCore,
  target: string,
  alias: string | null | undefined,
  resolveWikiLink: ResolveWikiLink | undefined,
): Token[] {
  const label = alias ?? target
  const text = new state.Token('text', '', 0)
  text.content = label

  if (resolveWikiLink === undefined) {
    // 옵션이 없으면(F-130 공유 화면) 클릭 불가능한 글자만 (F-131 4장)
    const spanOpen = new state.Token('wikilink_span_open', 'span', 1)
    spanOpen.attrSet('class', 'wikilink wikilink--plain')
    const spanClose = new state.Token('wikilink_span_close', 'span', -1)
    return [spanOpen, text, spanClose]
  }

  // 'link_open'/'link_close' 를 그대로 쓰지 않는다 — 그 타입은 위 F-123 규칙이
  // target="_blank" rel="noopener noreferrer" 를 붙인다(F-131 4장: 새 탭 속성 없음).
  // 다른 타입 이름으로 만들어 그 규칙을 타지 않고 기본 renderToken 으로 렌더한다
  const href = resolveWikiLink(target)
  const open = new state.Token('wikilink_open', 'a', 1)
  const close = new state.Token('wikilink_close', 'a', -1)
  open.attrSet('data-wikilink', target)
  if (href) {
    open.attrSet('class', 'wikilink')
    open.attrSet('href', href)
  } else {
    open.attrSet('class', 'wikilink wikilink--missing')
    open.attrSet('href', '#')
  }

  return [open, text, close]
}

function wikiLinkRule(state: StateCore, resolveWikiLink: ResolveWikiLink | undefined): void {
  const tokens = state.tokens
  let tableDepth = 0

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token.type === 'table_open') tableDepth++
    else if (token.type === 'table_close') tableDepth--
    if (token.type !== 'inline' || tableDepth > 0 || !token.children) continue

    let changed = false
    const nextChildren: Token[] = []

    for (const child of token.children) {
      if (child.type !== 'text') {
        nextChildren.push(child)
        continue
      }

      const matches = findWikiLinks(child.content)
      if (matches.length === 0) {
        nextChildren.push(child)
        continue
      }

      changed = true
      let cursor = 0
      for (const m of matches) {
        if (m.from > cursor) {
          const before = new state.Token('text', '', 0)
          before.content = child.content.slice(cursor, m.from)
          nextChildren.push(before)
        }
        nextChildren.push(...wikiLinkTokens(state, m.target, m.alias, resolveWikiLink))
        cursor = m.to
      }
      if (cursor < child.content.length) {
        const after = new state.Token('text', '', 0)
        after.content = child.content.slice(cursor)
        nextChildren.push(after)
      }
    }

    if (changed) token.children = nextChildren
  }
}

// wikilink_open/close·wikilink_span_open/close 는 renderer 규칙이 따로 없어 markdown-it
// 기본 renderToken(tag·attrs·nesting 기준)으로 렌더된다 — <a class=… href=…>…</a> 또는
// <span class=…>…</span>. F-123 의 link_open 규칙(target·rel 추가)은 타입이 달라 타지 않는다
md.core.ruler.after('inline', 'wikilink', (state) =>
  wikiLinkRule(state, (state.env as { resolveWikiLink?: ResolveWikiLink } | undefined)?.resolveWikiLink),
)

// ----- 표 칸 안 <br> (F-162.md 2.3, html:false 예외 — taskListsRule 의 체크박스와 같은 html_inline 토큰 방식) -----
const CELL_BR_RE = /<br\s*\/?>/gi

function tableBrRule(state: StateCore): void {
  const tokens = state.tokens
  let tableDepth = 0

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token.type === 'table_open') tableDepth++
    else if (token.type === 'table_close') tableDepth--
    if (token.type !== 'inline' || tableDepth === 0 || !token.children) continue

    let changed = false
    const nextChildren: Token[] = []

    for (const child of token.children) {
      if (child.type !== 'text') {
        nextChildren.push(child)
        continue
      }

      const content = child.content
      CELL_BR_RE.lastIndex = 0
      let cursor = 0
      let match
      let localChanged = false
      while ((match = CELL_BR_RE.exec(content))) {
        localChanged = true
        if (match.index > cursor) {
          const before = new state.Token('text', '', 0)
          before.content = content.slice(cursor, match.index)
          nextChildren.push(before)
        }
        const br = new state.Token('html_inline', '', 0)
        br.content = '<br>'
        nextChildren.push(br)
        cursor = match.index + match[0].length
      }
      if (!localChanged) {
        nextChildren.push(child)
        continue
      }
      changed = true
      if (cursor < content.length) {
        const after = new state.Token('text', '', 0)
        after.content = content.slice(cursor)
        nextChildren.push(after)
      }
    }

    if (changed) token.children = nextChildren
  }
}

md.core.ruler.after('inline', 'table_br', tableBrRule)

// ----- 프론트매터 (F-133.md 3.3) -----
// 변환 전에 findFrontmatter 로 떼어 내고 나머지 본문만 markdown-it 에 넣는다.
// 성공(속성 있음): 표. 구조를 알아볼 수 없음(null): 원문 그대로 <pre>. 빈 프론트매터
// (속성 없음): 아무것도 출력하지 않는다
function renderFrontmatter(text: string, frontmatter: { contentFrom: number; contentTo: number }): string {
  const content = text.slice(frontmatter.contentFrom, frontmatter.contentTo)
  const props = parseSimpleProperties(content)

  if (props === null) {
    return `<pre class="markdown-frontmatter-raw"><code>${md.utils.escapeHtml(content)}</code></pre>`
  }
  if (props.length === 0) return ''

  const rows = props
    .map(({ key, value }) => {
      const shown = Array.isArray(value) ? value.join(', ') : value
      return `<tr><th>${md.utils.escapeHtml(key)}</th><td>${md.utils.escapeHtml(shown)}</td></tr>`
    })
    .join('')
  return `<table class="markdown-frontmatter"><tbody>${rows}</tbody></table>`
}

// text: 저장소·에디터 원문 그대로 (CRLF 도 그대로 넘길 수 있다 — markdown-it 이 파싱 전
// 줄바꿈을 정규화한다). options.resolveWikiLink: 위키링크 대상 제목 → 문서 id. 생략하면
// (F-130 공유 화면) 위키링크를 클릭 불가능한 글자로만 렌더한다 (F-131 4장)
export function renderMarkdown(text: string, options: { resolveWikiLink?: ResolveWikiLink } = {}): string {
  const env: { resolveWikiLink?: ResolveWikiLink; lineOffset?: number } = { resolveWikiLink: options.resolveWikiLink }
  const frontmatter = findFrontmatter(text)
  if (!frontmatter) return md.render(text, env)

  const body = textAfterFrontmatter(text, frontmatter)
  env.lineOffset = (text.slice(0, text.length - body.length).match(/\n/g) || []).length
  return renderFrontmatter(text, frontmatter) + md.render(body, env)
}

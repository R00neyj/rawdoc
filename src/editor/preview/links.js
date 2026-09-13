// 편집 모드 링크 클릭 (specs/features/F-129.md)
// 링크 찾기(findLinkAt), 열 수 있는 주소 판정(isOpenableUrl), 클릭 처리 확장(linkClicks)을 이 파일에 모은다.
// decoration 은 만들지 않는다 — 기호 숨김·표시용 mark 는 inline.js 몫이다 (F-129 2 파일 소유)
import { syntaxTree } from '@codemirror/language'
import { EditorView } from '@codemirror/view'

import { selectionTouches } from './active.js'
import { isComposing } from '../composition.js'

/** F-129 3.1: 이 스킴으로 시작하는 것만 연다 (대소문자 무시) */
const OPENABLE_SCHEMES = ['http:', 'https:', 'mailto:']

/**
 * @param {string} url
 * @returns {boolean}
 */
export function isOpenableUrl(url) {
  if (typeof url !== 'string') return false
  const lower = url.toLowerCase()
  return OPENABLE_SCHEMES.some((scheme) => lower.startsWith(scheme))
}

/**
 * `Link` 노드(`[글자](URL)` 형태, URL 있는 것만)의 "링크 글자" 범위.
 * 구조: LinkMark('[') …글자… LinkMark(']') LinkMark('(') URL [LinkTitle] LinkMark(')')
 * (spike 참고 없음 — @lezer/markdown finishLink 소스 구조 그대로)
 * @returns {{from:number, to:number, url:string}|null}
 */
function linkTarget(state, linkNode) {
  const urlNode = linkNode.getChild('URL')
  if (!urlNode) return null // `[a][ref]`·`[a]` 처럼 URL 이 없으면 대상이 아니다

  const open = linkNode.firstChild // '['
  let close = null
  for (let child = open?.nextSibling; child; child = child.nextSibling) {
    if (child.name === 'LinkMark') {
      close = child // 두 번째로 만나는 LinkMark 가 닫는 ']'
      break
    }
  }
  if (!open || open.name !== 'LinkMark' || !close || open.to >= close.from) return null

  return { from: open.to, to: close.from, url: state.doc.sliceString(urlNode.from, urlNode.to) }
}

/**
 * `Autolink`(`<https://…>`) 안 `URL` 자식의 범위. `<` `>` 는 제외한다.
 * @returns {{from:number, to:number, url:string}|null}
 */
function autolinkTarget(state, autolinkNode) {
  const urlNode = autolinkNode.getChild('URL')
  if (!urlNode) return null
  return { from: urlNode.from, to: urlNode.to, url: state.doc.sliceString(urlNode.from, urlNode.to) }
}

/**
 * pos 를 담고 있는 `Link` 노드(있다면)를 찾는다. 3.2 "드러남" 판정(Link 전체 범위)에 쓴다.
 * findLinkAt 이 돌려주는 범위는 "링크 글자" 범위(괄호·URL 제외)라 이 판정에는 못 쓴다.
 */
function enclosingLink(state, pos) {
  const tree = syntaxTree(state)
  for (const side of [1, -1]) {
    for (let n = tree.resolveInner(pos, side); n; n = n.parent) {
      if (n.name === 'Link') return n
    }
  }
  return null
}

/**
 * 구문 트리 기준으로 pos 위치의 "열 수 있는 링크 글자" 를 찾는다 (F-129 3.1·3.4).
 * - `[글자](URL)` → `글자` 범위 (URL 없는 참조·shortcut 링크, Image 는 null)
 * - 맨 주소(부모가 Link 아닌 URL) → 그 글자 범위
 * - `<URL>`(Autolink) → `<` `>` 안 글자 범위
 * @param {import('@codemirror/state').EditorState} state
 * @param {number} pos
 * @returns {{from:number, to:number, url:string}|null}
 */
export function findLinkAt(state, pos) {
  const tree = syntaxTree(state)

  for (const side of [1, -1]) {
    const start = tree.resolveInner(pos, side)
    let excluded = false // Link(URL 없음)·Image 안쪽 — 맨 URL 대체 판정에서 제외

    for (let n = start; n; n = n.parent) {
      if (n.name === 'Link') {
        const target = linkTarget(state, n)
        if (target) return target
        excluded = true
        break
      }
      if (n.name === 'Autolink') {
        const target = autolinkTarget(state, n)
        if (target) return target
        excluded = true
        break
      }
      if (n.name === 'Image') {
        excluded = true
        break
      }
    }

    if (!excluded && start.name === 'URL') {
      return { from: start.from, to: start.to, url: state.doc.sliceString(start.from, start.to) }
    }
  }

  return null
}

/**
 * 클릭 좌표가 실제 링크 글자 위인지 (F-134 3.2). `posAtCoords` 만 쓰면 줄 끝 오른쪽
 * 빈 곳을 눌러도 줄 끝 위치가 나와, 줄이 링크·맨 URL 로 끝나면 클릭한 자리가 링크
 * 밖인데도 링크가 열려버린다. 표시용 mark(`inline.js` 의 `.md-link`, F-129 3.3)가
 * 링크 글자에만 붙으므로, 실제로 누른 DOM 요소(event.target)가 그 안인지로 판정한다.
 * @param {EventTarget|null} target `event.target`
 * @returns {boolean}
 */
export function clickTargetIsLinkText(target) {
  return !!target?.closest?.('.md-link')
}

/**
 * 편집 모드 링크 클릭 확장 (F-129 3.3·3.4).
 * `mousedown` 에서 처리한다 — 기본 동작을 막아야(preventDefault) 여는 클릭에서 커서가
 * 움직이지 않는다. 원문 모드에는 이 확장 자체가 들어가지 않는다(index.js 는 live 모드에만
 * 등록) — 3.3 "원문 모드에서는 링크를 열지 않는다" 는 그래서 별도 분기가 필요 없다.
 */
export function linkClicks() {
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      if (event.button !== 0) return false // 왼쪽 버튼만
      if (isComposing(view)) return false // 조합 중이면 가로채지 않는다

      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
      if (pos == null) return false

      const link = findLinkAt(view.state, pos)
      if (!link) return false
      if (!clickTargetIsLinkText(event.target)) return false // F-134 3.2: 줄 끝 오른쪽 여백 등

      if (event.shiftKey) return false // 기존 선택 확장 동작 그대로
      if (event.ctrlKey || event.metaKey) return false // 열지 않고 누른 위치에 커서 — 기본 동작

      // 드러난 상태(커서가 링크에 닿음)면 보통 커서 이동 — 열지 않는다
      const enclosing = enclosingLink(view.state, pos)
      if (enclosing && selectionTouches(view.state, enclosing.from, enclosing.to)) return false

      if (!isOpenableUrl(link.url)) return false // 열 수 없는 주소 — 보통 커서 이동

      event.preventDefault()
      window.open(link.url, '_blank', 'noopener,noreferrer')
      return true
    },
  })
}

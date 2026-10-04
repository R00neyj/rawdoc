// 블록 위젯 — 표·코드블록(F-106). CM6 는 block decoration 을 ViewPlugin 에서 못 받아(plugins 제약) StateField 로 제공한다(spike blocks.js 225~232행)
// 그 결과 visibleRanges 로 못 좁혀 buildBlocks 가 문서 전체를 순회한다(F-106 2.5 성능 기록) — decoration 은 문서를 바꾸지 않는다(CLAUDE.md 불변조건)
import { Prec, StateField } from '@codemirror/state'
import type { EditorState, Extension, Range as CMRange } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap } from '@codemirror/view'
import type { DecorationSet } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'

import { parseImageBlock } from '../../lib/imageBlock'
import { imageLineTarget, parseImageLine } from '../../lib/imageMarkdown'
import type { ResolveImagePath } from '../../lib/imageMarkdown'
import { parseMathBlock } from '../../lib/mathSyntax'
import { createCodeCopyButton } from '../../lib/codeCopyButton'
import { displayLang, isMermaidInfo } from '../../lib/codeLang'
import { isComposing, isForced } from '../composition'
import { isEditorFocused } from './active'
import { isFrontmatterComposing } from './frontmatterEdit'
import type { ResolveAttachment } from './imageWidget'
import { ImageWidget, destroyImageCache } from './imageWidget'
import { MathBlockWidget } from './mathWidget'
import { MermaidWidget, destroyMermaidCache } from './mermaidWidget'
import {
  TableWidget,
  enterTableFromKeyboard,
  isCellComposing,
  trackActiveEditRange,
  trackPendingWrites,
} from './tableWidget'

export type { ResolveAttachment }

// 커서나 선택 영역이 [from, to] 와 겹치는가
// active.ts 의 activeLines 를 안 쓴다 — 그쪽은 줄 번호 집합, 여기는 노드 범위(줄 경계로 확장한 값) 겹침으로 판정 기준이 다르다
function overlaps(state: EditorState, from: number, to: number): boolean {
  for (const range of state.selection.ranges) {
    if (range.to >= from && range.from <= to) return true
  }
  return false
}

// 표 원문 범위 안에 있는 빈 커서인가(F-139 3.1) — 표를 치는 도중 위젯이 그 범위를 가리면 커서가 위젯 DOM(비활성) 안에 놓여 키 입력이 사라진다
// 이때는 코드블록과 같은 "겹치면 원문" 경로를 타게 한다. Shift+방향키의 비어있지 않은 선택은 해당 없음(F-125 A2), 칸 편집 중도 안 겹친다
function emptyCursorInside(state: EditorState, from: number, to: number): boolean {
  const { main } = state.selection
  return main.empty && main.head >= from && main.head <= to
}

// 위젯 DOM 에서 클릭한 지점의 블록 시작 기준 상대 오프셋 — data-offset(코드 줄 span, 표 셀 td/th)이 있으면 그 값, 없으면 0
function offsetAt(event: MouseEvent): number {
  const target = (event.target as Element | null)?.closest?.('[data-offset]') as HTMLElement | null
  return target ? Number(target.dataset.offset) : 0
}

// 위젯 DOM 에 "클릭하면 원문으로 진입"을 붙인다(F-106 2.3, spike 18~35행) — mousedown 에서 preventDefault 안 하면 CM6 가 selection 을 다시 잡아 진입 위치가 어긋난다
// 위치는 위젯이 안 들고 클릭 시점에 view.posAtDOM(wrap) 으로 역산한다 — eq() 가 true 면 옛 위젯 인스턴스가 그대로라 저장해 둔 위치는 낡을 수 있다
export function enterOnClick(wrap: HTMLElement, view: EditorView): void {
  wrap.addEventListener('mousedown', (event) => {
    event.preventDefault()
    const pos = view.posAtDOM(wrap) + offsetAt(event)
    view.dispatch({ selection: { anchor: pos } })
    view.focus()
  })
}

// 위젯 DOM 요소별 ResizeObserver 추적(F-134 3.6) — observer 를 위젯 인스턴스에 저장하면, eq() 가 참일 때 CM 이 옛 DOM 에 새 인스턴스를 이어붙여도 toDOM 이 다시 안 불려 새 인스턴스엔 observer 가 없다
// 나중에 destroy(dom) 은 그 최신 인스턴스에서 불려 원래 만든 observer 를 못 끊고 샌다 — DOM 요소를 key 로 쓰면 어느 인스턴스가 만들었는지와 무관하게 해제 가능
const heightObservers = new WeakMap<HTMLElement, ResizeObserver>()

// 위젯 최상위 요소 높이가 toDOM 이후 바뀌면 CM6 에 알린다(F-124 3.4 12번) — requestMeasure() 없으면 아래 줄들의 클릭 위치가 어긋난다
// 추가 rAF 재측정을 시도했다가 이상 현상을 만났지만 원인은 코드가 아니라 백그라운드 탭(document.hidden)이었다 — ResizeObserver 하나면 충분하다(실측 로그 참고)
export function observeHeight(el: HTMLElement, view: EditorView): void {
  const observer = new ResizeObserver(() => view.requestMeasure())
  observer.observe(el)
  heightObservers.set(el, observer)
}

// el 에 연결된 ResizeObserver 를 해제한다 — 어느 위젯 인스턴스가 불렀는지와 무관하다(F-134 3.6), el 자체가 key
export function stopObservingHeight(el: HTMLElement): void {
  heightObservers.get(el)?.disconnect()
  heightObservers.delete(el)
}

type CodeLine = { text: string; offset: number }

// 복사 버튼이 클립보드에 넣을 문자열 (F-240.md 3.3) — 펜스 줄·정보 문자열 없이 본문 줄만 '\n' 으로 잇는다
export function codeBlockText(lines: CodeLine[]): string {
  return lines.map((line) => line.text).join('\n')
}

// 펜스 코드블록 위젯. 구문 강조는 하지 않는다 (F-106 2.1)
class CodeWidget extends WidgetType {
  info: string
  lines: CodeLine[]
  key: string

  // info: CodeInfo(언어). lines: 각 줄 원문(들여쓰기·"> " 접두 제외)과 블록 시작 기준 상대 offset(그 줄 첫 글자 위치)
  // 목록·인용 안 코드블록은 줄마다 CodeText 가 나뉘어(F-134 3.4) offset 이 등차수열이 아닐 수 있어 줄별로 든다
  constructor(info: string, lines: CodeLine[]) {
    super()
    this.info = info
    this.lines = lines
    // 비교 기준은 화면 표시 내용뿐 아니라 클릭 위치 계산에 쓰는 offset 도 포함한다(F-134 3.3) — 칸 글자가 같아도 공백·구분 행·펜스 길이·들여쓰기가 다르면 offset 이 달라진다
    // eq 를 참으로 잘못 판정하면 CM 이 옛 DOM(옛 data-offset)을 재사용해 클릭 위치가 어긋난다
    this.key = JSON.stringify({ info, lines })
  }

  eq(other: CodeWidget): boolean {
    return other.key === this.key
  }

  toDOM(view: EditorView): HTMLElement {
    // 최상위 요소(wrap)에는 세로 margin 을 쓰지 않는다 — CM6 는 위젯 높이를 DOM 에서 잴 때 margin 을 안 넣는다(F-124 3.4 12번 원인 (나))
    // 위아래 간격은 wrap 의 padding 으로 주고(=wrap 높이에 포함), 배경·모서리는 inner 에 준다 — 그래야 간격 자리가 배경색으로 안 칠해진다
    const wrap = document.createElement('div')
    wrap.className = 'md-block md-codeblock'

    const inner = document.createElement('div')
    inner.className = 'md-codeblock-inner'

    // 머리줄 — 언어 + 복사 버튼 (F-240.md 3.2). 언어 글자 클릭은 그대로 편집 진입, 복사 버튼만 mousedown stopPropagation 으로 막는다(imageWidget.ts 와 같은 방식)
    const head = document.createElement('div')
    head.className = 'md-codeblock-head'
    const langWord = displayLang(this.info)
    if (langWord) {
      const lang = document.createElement('span')
      lang.className = 'md-codeblock-lang'
      lang.textContent = langWord
      head.appendChild(lang)
    }
    const copyBtn = createCodeCopyButton(() => codeBlockText(this.lines))
    copyBtn.addEventListener('mousedown', (event) => event.stopPropagation())
    head.appendChild(copyBtn)
    inner.appendChild(head)

    const pre = document.createElement('pre')
    this.lines.forEach((line, i) => {
      const span = document.createElement('span')
      span.className = 'md-codeblock-line'
      span.dataset.offset = String(line.offset)
      span.textContent = line.text
      pre.appendChild(span)
      if (i < this.lines.length - 1) pre.appendChild(document.createTextNode('\n'))
    })

    // pre 를 스크롤 전용 래퍼로 감싼다 — 긴 코드 줄이 문서 전체를 가로로 밀지 않고 코드블록 안에서만 가로 스크롤되게 한다(F-124 3.4)
    // data-offset 클릭 위치 계산은 pre 안 구조(span[data-offset])를 그대로 두므로 영향받지 않는다
    const scroll = document.createElement('div')
    scroll.className = 'md-codeblock-scroll'
    scroll.appendChild(pre)
    inner.appendChild(scroll)
    wrap.appendChild(inner)

    observeHeight(wrap, view)

    enterOnClick(wrap, view)
    return wrap
  }

  ignoreEvent(): boolean {
    return true
  }

  destroy(dom: HTMLElement): void {
    stopObservingHeight(dom)
  }
}

// 목록·인용 안 코드블록은 lezer 가 줄마다 CodeText 를 나눈다(각 줄 들여쓰기·"> " 건너뛰기 위해, @lezer/markdown/dist/index.js:396-402,478-487) — 모든 조각을 모아 줄 단위로 이어 붙인다(이전엔 마지막 조각만 써 목록·인용 안에서 마지막 줄만 보였다, F-134 3.4)
// 조각 끝의 연결용 \n 하나만 버리고, 조각이 하나뿐이면 아무것도 안 버린다. blockFrom/blockTo/theme 는 TARGET 맵 시그니처를 맞추려 받고, mermaid 정보문자열(F-258 2.1)이면 MermaidWidget, 아니면 CodeWidget
function codeWidget(state: EditorState, node: SyntaxNode, blockFrom: number, _blockTo: number, theme: string): WidgetType {
  let info = ''
  const codeTexts: SyntaxNode[] = []
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === 'CodeInfo') info = state.doc.sliceString(child.from, child.to)
    else if (child.name === 'CodeText') codeTexts.push(child)
  }

  const lines: CodeLine[] = []
  codeTexts.forEach((child, i) => {
    const text = state.doc.sliceString(child.from, child.to)
    const parts = text.split('\n')
    if (i < codeTexts.length - 1 && parts[parts.length - 1] === '') parts.pop()
    let offset = child.from
    for (const part of parts) {
      lines.push({ text: part, offset: offset - blockFrom })
      offset += part.length + 1 // +1 은 다음 줄과의 '\n'
    }
  })

  if (isMermaidInfo(info)) return new MermaidWidget(codeBlockText(lines), theme)
  return new CodeWidget(info, lines)
}

// 표는 tableModel.ts 가 텍스트를 직접 해석하므로(lezer TableCell 미사용 — tableModel.ts 상단 참고) 블록 전체 원문을 그대로 잘라 TableWidget 에 넘긴다 — node·theme 은 안 쓰지만 TARGET 맵의 다른 항목(codeWidget)과 시그니처를 맞추려 받는다. blockFrom·blockTo: 치환 범위 시작·끝(줄 경계로 확장)
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- _theme 은 시그니처를 맞추려고만 받는다(TARGET.Table)
function tableWidget(state: EditorState, _node: SyntaxNode, blockFrom: number, blockTo: number, _theme: string): TableWidget {
  return new TableWidget(state.doc.sliceString(blockFrom, blockTo))
}

// theme: 앱 테마(F-260 2.2) — 호출부(buildBlocks)가 항상 넘긴다
type BlockMaker = (state: EditorState, node: SyntaxNode, blockFrom: number, blockTo: number, theme: string) => WidgetType
const TARGET: Record<string, BlockMaker> = { Table: tableWidget, FencedCode: codeWidget }

// 목록·인용 안인가 (F-157 2.1 "문서 최상위"). 이미지 블록·수식 블록·표가 검사한다 — 코드블록은 F-106 그대로 목록·인용 안에서도 위젯이 된다.
// 표는 tableModel 이 줄 앞 `>`·`-`·들여쓰기를 모르고 칸으로 읽거나 행 추가에서 빠뜨려 구조를 깨므로 원문으로 둔다 (리뷰 E2)
const LIST_OR_QUOTE = new Set(['Blockquote', 'BulletList', 'OrderedList', 'ListItem'])
function isInsideListOrQuote(node: SyntaxNode): boolean {
  for (let n = node.parent; n; n = n.parent) {
    if (LIST_OR_QUOTE.has(n.name)) return true
  }
  return false
}

// 선택에 따라 위젯↔원문이 바뀔 수 있는 블록 하나 (리뷰 E6). table 이면 F-139 3.1 규칙을 탄다
export type BlockSpan = { from: number; to: number; table: boolean }

// 이 블록을 위젯으로 보이는가 — buildBlocks 와 선택만 바뀐 갱신의 건너뛰기 판정이 같은 규칙을 쓴다
function showsWidget(state: EditorState, hasFocus: boolean, span: BlockSpan): boolean {
  const showsSource = hasFocus && overlaps(state, span.from, span.to)
  if (span.table) {
    // 표는 커서·선택이 걸쳐 있어도 항상 위젯이다(F-125 2.1). 예외(F-139 3.1): 포커스가 있고
    // 빈 커서가 표 원문 범위 안이면 "겹치면 원문" 규칙을 탄다
    const alwaysWidget = !hasFocus || !emptyCursorInside(state, span.from, span.to)
    return alwaysWidget || !showsSource
  }
  return !showsSource
}

// 블록마다 위젯이면 1, 원문이면 0 — 같으면 선택이 바뀌어도 decoration 이 같다 (리뷰 E6)
export function blockVisibilityKey(state: EditorState, hasFocus: boolean, spans: readonly BlockSpan[]): string {
  let key = hasFocus ? 'f' : 'n'
  for (const span of spans) key += showsWidget(state, hasFocus, span) ? '1' : '0'
  return key
}

// 표·코드블록·이미지 블록을 위젯 decoration 으로 치환한다(DOM 없이 동작). hasFocus: 편집기 포커스(F-146 3.2) — 없으면 겹침을 무시하고 항상 위젯(접힌 프리뷰)으로 본다, 기본값 true 는 기존 호출부(테스트 등) 동작 유지
// resolveAttachment: 이미지 블록 위젯이 첨부를 읽는 콜백(F-157 2.2). theme: 앱 테마, 기본값 없음(호출부가 항상 넘김) — mermaid 코드블록 위젯에 쓰인다(F-260 2.2)
export function buildBlocks(
  state: EditorState,
  hasFocus = true,
  resolveAttachment: ResolveAttachment | undefined,
  theme: string,
  spans?: BlockSpan[],
  resolveImagePath?: ResolveImagePath,
): CMRange<Decoration>[] {
  const out: CMRange<Decoration>[] = []
  syntaxTree(state).iterate({
    enter: (node) => {
      // 이미지 블록 (F-157 2.1) — HTMLBlock 은 TARGET 에 없어 parseImageBlock 이 실패하거나 목록·인용 안이면 원문 그대로 둔다
      if (node.name === 'HTMLBlock') {
        if (isInsideListOrQuote(node.node)) return
        const from = state.doc.lineAt(node.from).from
        const to = state.doc.lineAt(node.to).to
        const parsed = parseImageBlock(state.doc.sliceString(from, to))
        if (!parsed) return
        const span = { from, to, table: false }
        spans?.push(span)
        if (showsWidget(state, hasFocus, span)) {
          out.push(
            Decoration.replace({ widget: new ImageWidget(parsed, resolveAttachment), block: true }).range(from, to),
          )
        }
        return false
      }

      // 수식 블록 $$…$$(F-291 4.2) — 문서 최상위 문단만(B3), 문단 자식은 인라인 노드뿐이라 내려가지 않는다(인라인 수식은 mathPreview 가 그린다)
      if (node.name === 'Paragraph') {
        if (isInsideListOrQuote(node.node)) return false
        const from = state.doc.lineAt(node.from).from
        const to = state.doc.lineAt(node.to).to
        // 이미지 한 줄 `![…](attachments/…)` (F-2127 4.1) — 문단 첫 글자(앞 0~3칸 뒤)가 `!` 일 때만 해석한다
        if (state.doc.sliceString(node.from, node.from + 1) === '!') {
          const line = parseImageLine(state.doc.sliceString(from, to))
          const target = line && imageLineTarget(line, resolveImagePath)
          if (line && target) {
            const span = { from, to, table: false }
            spans?.push(span)
            if (showsWidget(state, hasFocus, span)) {
              const parsed = { align: line.align, id: target.id, ext: target.ext, src: line.url, alt: line.alt, width: line.width }
              out.push(
                Decoration.replace({ widget: new ImageWidget(parsed, resolveAttachment, 'markdown'), block: true }).range(from, to),
              )
            }
            return false
          }
        }
        // 수식 블록은 문단 첫 두 글자가 `$$` 여야 한다(parseMathBlock) — 아니면 파싱 안 하고, 문단 자식은 인라인 노드뿐이라 내려가지 않는다(리뷰 E6)
        if (state.doc.sliceString(from, from + 2) !== '$$') return false
        const parsed = parseMathBlock(state.doc.sliceString(from, to))
        if (!parsed) return false
        const span = { from, to, table: false }
        spans?.push(span)
        if (showsWidget(state, hasFocus, span)) {
          out.push(Decoration.replace({ widget: new MathBlockWidget(parsed.tex), block: true }).range(from, to))
        }
        return false
      }

      const make = TARGET[node.name]
      if (!make) return
      if (node.name === 'Table' && isInsideListOrQuote(node.node)) return false

      // block decoration 은 줄 경계에 놓여야 한다 — 표·코드블록은 이미 줄 단위지만 파서가 주는 범위를 그대로 믿지 않고 줄로 확장한다
      const from = state.doc.lineAt(node.from).from
      const to = state.doc.lineAt(node.to).to

      // 표는 커서·선택이 걸쳐 있어도 항상 위젯이다(F-125 2.1) — 칸 편집은 위젯 안 하위 에디터로 하므로 원문 노출이 불필요(코드블록은 "겹치면 원문" 유지)
      // 예외(F-139 3.1): 주 에디터 빈 커서가 표 범위 안이면 emptyCursorInside 가 참이라 overlaps 도 참이 되어 아래 `!overlaps` 로 자연히 원문 노출. 포커스 없으면(F-146 3.2) 예외 없이 항상 위젯
      const span = { from, to, table: node.name === 'Table' }
      spans?.push(span)
      if (showsWidget(state, hasFocus, span)) {
        out.push(Decoration.replace({ widget: make(state, node.node, from, to, theme), block: true }).range(from, to))
      }
      // 어느 쪽이든 블록 내부는 더 볼 것이 없다. 표 안 인라인·코드블록 강조는 하지 않는다.
      return false
    },
  })
  return out
}

// pos 를 포함하는 Table 노드(있으면)를 찾는다 — 표는 항상 위젯이라(F-125 2.1) 그 줄에 커서가 닿아도 화면엔 원문이 안 보인다
// 원문 자리로 커서를 두는 대신 칸 편집을 시작해야 한다(2.3)
function findTableAt(state: EditorState, pos: number): SyntaxNode | null {
  let found: SyntaxNode | null = null
  syntaxTree(state).iterate({
    from: pos,
    to: pos,
    enter: (node) => {
      if (node.name === 'Table') found = node.node
    },
  })
  return found
}

// 방향키가 블록 위젯을 통째로 건너뛰는 것을 막는다(F-106 2.2) — Decoration.replace({block:true}) 는 view.moveVertically 가 위젯을 한 시각 줄로 보고 넘기게 한다(spike 178~187행) — atomicRanges 는 안 쓴다(쓰면 방향키로 들어가는 길 자체가 막힘)
// 판정은 논리 줄 차이 — 두 줄 이상 뛰면 옆 줄로 돌려보내 겹침 판정으로 블록을 연다(F-106 2.2 3장 A3). 표는 옆 줄 대신 칸 편집을 시작한다(2.1·2.3). down: 아래로 이동이면 true
function stepIntoBlock(down: boolean) {
  return (view: EditorView): boolean => {
    const { state } = view
    const main = state.selection.main
    // 선택 영역이 있으면 개입하지 않는다 — Shift+방향키를 망가뜨리지 않기 위해서다.
    if (!main.empty) return false

    const cur = state.doc.lineAt(main.head).number
    const landing = state.doc.lineAt(view.moveVertically(main, down).head).number
    if (Math.abs(landing - cur) <= 1) return false

    const target = down ? cur + 1 : cur - 1
    if (target < 1 || target > state.doc.lines) return false
    const targetPos = state.doc.line(target).from

    // 표로 들어가는 경우: 아래 화살표는 머리 행 첫 칸, 위 화살표는 마지막 행 첫 칸에서 편집을 시작한다(F-125 2.3)
    // enterTableFromKeyboard 의 fromAbove 는 "위에서 내려오며 들어왔다(=아래로 이동)"는 뜻이라 down 과 같다
    const tableNode = findTableAt(state, targetPos)
    if (tableNode) {
      const tableFrom = state.doc.lineAt(tableNode.from).from
      if (enterTableFromKeyboard(view, tableFrom, down)) return true
    }

    view.dispatch({
      selection: { anchor: targetPos },
      scrollIntoView: true,
    })
    return true
  }
}

// createEditor 가 defaultKeymap 을 먼저 조립하므로(F-109 shortcutKeymap 도 Prec.high) Prec.highest 로 둬야 ArrowDown/ArrowUp 을 먼저 받는다
const blockKeymap = Prec.highest(
  keymap.of([
    { key: 'ArrowDown', run: stepIntoBlock(true) },
    { key: 'ArrowUp', run: stepIntoBlock(false) },
  ]),
)

// 표·코드블록 위젯 확장 — StateField 는 view 를 못 받아 위젯 없는 ViewPlugin(tracker)으로 view 참조만 잡아 클로저에서 읽는다(최초 create 시점엔 조합 중일 수 없다). IME 규칙은 F-104 2.3 과 같다
// 표 칸 조합(F-125 2.2)은 칸의 하위 EditorView 에서 일어나 주 view.composing 이 계속 false 라 isCellComposing 도 봐야 한다 — 안 보면 재계산이 하위 뷰 DOM 을 파괴한다. resolveAttachment(F-157 2.2)·theme(F-260 2.2)은 호출부가 넘긴다
export function blockPreview({
  resolveAttachment,
  theme,
  resolveImagePath,
}: {
  resolveAttachment?: ResolveAttachment
  theme: string
  resolveImagePath?: ResolveImagePath
}): Extension {
  const viewRef: { current: EditorView | null } = { current: null }
  const tracker = ViewPlugin.fromClass(
    class {
      constructor(view: EditorView) {
        viewRef.current = view
      }
      // 에디터 destroy 때 이미지 블록 위젯이 만든 blob URL 을 모두 해제한다(F-157 2.2). mermaid 위젯 캐시도 비운다(blob URL 없어 해제 불필요, F-258 2.3)
      destroy() {
        destroyImageCache(viewRef.current)
        destroyMermaidCache(viewRef.current)
      }
    },
  )

  // deco 와 함께 그걸 만든 블록 목록(spans)·위젯/원문 상태(key)를 든다. stale: 조합 중 map 만 해 spans 가 낡았다는 뜻 — 선택만 바뀐 갱신에서 건너뛰지 않는다(리뷰 E6)
  type FieldValue = { deco: DecorationSet; spans: BlockSpan[]; key: string; stale: boolean }
  function build(state: EditorState, hasFocus: boolean): FieldValue {
    const spans: BlockSpan[] = []
    const deco = Decoration.set(buildBlocks(state, hasFocus, resolveAttachment, theme, spans, resolveImagePath), true)
    return { deco, spans, key: blockVisibilityKey(state, hasFocus, spans), stale: false }
  }

  const field = StateField.define<FieldValue>({
    // EditorState.create 시점엔 view 가 없어 포커스를 알 수 없다 — false 가 맞다(autoFocus 의 focus() 가 곧 focusin·forceRecalc 로 다시 그린다, F-146 3.2)
    create: (state) => build(state, false),
    update(value, tr) {
      // F-135 3.2: 편집 중인 칸이 있으면 모든 주 문서 트랜잭션마다(칸 자신의 입력 포함) 세션이 든 칸 범위를 옮긴다
      // 아래에서 조합 중이라 위젯을 다시 안 그리고 건너뛰는 경우에도 범위는 계속 옮겨야 한다
      if (tr.docChanged) trackActiveEditRange(viewRef.current, tr)
      // F-138 3.5: endEdit 이 미뤄둔 쓰기(마이크로태스크 dispatch 대기 중)도 같은 이유로 모든 트랜잭션마다 범위를 옮긴다
      if (tr.docChanged) trackPendingWrites(viewRef.current, tr)
      if (!isForced(tr)) {
        // F-134 3.8: 배경 구문 분석이 끝나 트리만 바뀐 갱신도 재계산 조건에 넣는다
        // 안 넣으면 긴 문서 뒷부분(첫 파싱이 못 미친 곳)의 위젯이 다음 문서·선택 변화까지 늦게 생긴다
        const treeChanged = syntaxTree(tr.startState) !== syntaxTree(tr.state)
        if (!tr.docChanged && !tr.selection && !treeChanged) return value
        if (isComposing(viewRef.current) || isCellComposing(viewRef.current) || isFrontmatterComposing(viewRef.current)) {
          return tr.docChanged ? { ...value, deco: value.deco.map(tr.changes), stale: true } : value
        }
        // 선택만 바뀌었고 어느 블록도 위젯↔원문이 바뀌지 않으면 다시 만들어도 같은 결과다 — 문서 전체 순회·파싱을 건너뛴다 (리뷰 E6)
        if (!tr.docChanged && !treeChanged && !value.stale) {
          if (blockVisibilityKey(tr.state, isEditorFocused(viewRef.current), value.spans) === value.key) return value
        }
      }
      return build(tr.state, isEditorFocused(viewRef.current))
    },
    provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
  })

  return [blockKeymap, tracker, field]
}

// CM6 EditorView 생성·확장 조립 (specs/features/F-103.md 3.1)
// basicSetup 을 쓰지 않는다 — 자동완성·검색 패널을 넣지 않는다. 괄호·강조 기호 자동
// 짝은 `@codemirror/autocomplete` 의 closeBrackets() 가 아니라 F-127 의 autoPair() 다
import type { Extension } from '@codemirror/state'
import { Compartment, EditorState, Prec } from '@codemirror/state'
import { dropCursor, EditorView, keymap, lineNumbers } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { indentUnit } from '@codemirror/language'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'

import { autoPair } from './autoPair'
import { compositionCatchup, forceRecalc, isComposing, isForced } from './composition'
import {
  docTitleExtension,
  focusTitleFromBody,
  focusTitleWidget,
  setBreadcrumbEffect,
  setTitleEffect,
  setTitleReadOnlyEffect,
} from './docTitle'
import type { Breadcrumb, OnNavigateFolder, OnTitleChange, OnTitleCommit } from './docTitle'
import { frontmatterExtension } from './frontmatter'
import { highlightExtension } from './highlight'
import { shortcutKeymap } from './commands'
import { extractHeadings } from './outline'
import type { Heading } from './outline'
import { imageInsert } from './imageInsert'
import type { OnImageFiles } from './imageInsert'
import { livePreview } from './preview/index'
import { fenceLinePreview } from './preview/lines'
import { setWikiTitlesEffect, wikiTitlesField } from './preview/wikiLinks'
import type { OnOpenWikiLink } from './preview/wikiLinks'
import type { ResolveAttachment } from './preview/blocks'
import { wikiComplete } from './wikiComplete'

// 제목 목록 갱신 debounce (specs/features/F-144.md 3.3 "입력이 멈춘 뒤(150ms) 갱신")
const HEADINGS_DEBOUNCE_MS = 150

type ViewMode = 'live' | 'raw' | 'view'
type LineEnding = 'crlf' | 'lf'
type IndentSize = 2 | 4

type PreviewCallbacks = { onOpenWikiLink?: OnOpenWikiLink; resolveAttachment?: ResolveAttachment }

function previewExtensionFor(mode: ViewMode, { onOpenWikiLink, resolveAttachment }: PreviewCallbacks = {}): Extension {
  return mode === 'live' ? livePreview({ onOpenWikiLink, resolveAttachment }) : []
}

function attributesExtensionFor(mode: ViewMode): Extension {
  return EditorView.editorAttributes.of({ 'data-view': mode })
}

// 줄 번호(거터) 켜기·끄기 — 끈 상태는 data-gutters='off' 로 표시해 app.css 가 반응한다 (F-147 2장)
function lineNumbersExtensionFor(on: boolean): Extension {
  return on ? lineNumbers() : []
}

function gutterAttributesExtensionFor(on: boolean): Extension {
  return EditorView.editorAttributes.of({ 'data-gutters': on ? 'on' : 'off' })
}

// 들여쓰기 칸 수 — indentUnit(공백 N칸)·tabSize 를 함께 바꾼다 (F-154 2.3)
function indentExtensionsFor(size: IndentSize): Extension[] {
  return [indentUnit.of(' '.repeat(size)), EditorState.tabSize.of(size)]
}

// 읽기 전용 — readOnly 는 기본 명령을 막고, editable=false 는 contentEditable 자체를 끈다 (F-212.md 2.4)
function readOnlyExtensionsFor(readOnly: boolean): Extension[] {
  return [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]
}

// src/app/fileDrop.js 의 isExternalFileDrag() 와 같은 판정 — src/editor 는 src/app 을 import 하지 않아(단방향 계층) 옮겨 적는다
function isExternalFileDrag(dataTransfer: DataTransfer | null): boolean {
  const types = dataTransfer?.types
  if (!types) return false
  return Array.from(types).includes('Files')
}

// CM6 기본 파일 삽입을 외부 파일 끌어놓기에서만 막는다. true 를 돌려주면 이벤트는 계속 버블돼 App 의 처리(F-145.md 2.2·2.3)로 넘어간다
const dropFileGuard = EditorView.domEventHandlers({
  dragover(event) {
    if (!isExternalFileDrag(event.dataTransfer)) return false
    event.preventDefault()
    return true
  },
  drop(event) {
    if (!isExternalFileDrag(event.dataTransfer)) return false
    event.preventDefault()
    return true
  },
})

// 좌우 여백(.cm-content·.cm-gutters 밖, F-143 3.8) 클릭 시 포커스만 없앤다(F-146 3.1) — EditorView.domEventHandlers 는 contentDOM 에만 붙어 scroller 자신을 target 으로 한 클릭엔 안 닿아 view.scrollDOM 에 원시 리스너를 붙인다. 막지 않으면 tabIndex=-1 인 scroller 가 기본 동작으로 포커스를 먹어 view.dom 안에 남는다
function attachMarginClickGuard(view: EditorView): () => void {
  const handler = (event: MouseEvent) => {
    if (event.button !== 0) return
    const target = event.target as HTMLElement | null
    if (target?.closest?.('.cm-content, .cm-gutters')) return
    event.preventDefault()
    ;(view.root.activeElement as HTMLElement | null)?.blur()
  }
  view.scrollDOM.addEventListener('mousedown', handler)
  return () => view.scrollDOM.removeEventListener('mousedown', handler)
}

// 편집기 포커스 변화를 밀린 재계산 신호(forceRecalc)로 전달한다(F-146 3.2) — focusin·focusout 은 버블링해 view.dom 밑 어디든(표 칸 하위 EditorView 포함) 뜨고, relatedTarget 이 여전히 view.dom 안이면 실제 전환이 아니라 건너뛴다. 조합 중 여백 클릭(3.3)은 attachMarginClickGuard 의 blur() 가 compositionend 를 유도하고 composition.js 의 compositionCatchup 이 뒤이어 forceRecalc 를 보낸다 — 여기서 다시 보내도 내용엔 영향 없다
function focusRelay(): Extension {
  let editorFocused = false
  return EditorView.domEventHandlers({
    focusin(_event, view) {
      if (editorFocused) return false
      editorFocused = true
      view.dispatch({ effects: forceRecalc.of(null) })
      return false
    },
    focusout(event, view) {
      if (view.dom.contains(event.relatedTarget as Node | null)) return false
      editorFocused = false
      view.dispatch({ effects: forceRecalc.of(null) })
      return false
    },
  })
}

type CreateEditorOptions = {
  text?: string
  viewMode?: ViewMode
  // 줄 번호(거터) 표시 여부, 기본 true (F-147 2장). 이후 전환은 handle.setLineNumbers(on) 으로
  // 한다 — 이 값은 최초 생성에만 쓴다
  lineNumbers?: boolean
  // 들여쓰기 칸 수, 기본 4 (F-154 2.3). 이후 전환은 handle.setIndent(n) 으로 한다 —
  // 이 값은 최초 생성에만 쓴다
  indent?: IndentSize
  // 읽기 전용, 기본 false (F-212.md 2.4). 이후 전환은 handle.setReadOnly(on) 으로 한다
  readOnly?: boolean
  onDocChange?: (state: EditorState) => void
  onSelectionChange?: (state: EditorState) => void
  // 위키링크 대상 판정용 문서 제목 목록(F-131). 이후 갱신은 handle.setWikiTitles() 로 한다 —
  // 이 값은 최초 생성에만 쓴다
  wikiTitles?: string[]
  onOpenWikiLink?: OnOpenWikiLink
  // 붙여넣기·끌어놓기 이미지 받기 (F-156.md 2.4·2.5). App 이 저장·알림을 하고 첨부 메타를 돌려준다
  onImageFiles?: OnImageFiles
  // 편집 모드 이미지 블록 위젯이 첨부를 읽는 콜백 (F-157.md 2.2)
  resolveAttachment?: ResolveAttachment
  // 본문 맨 위 제목 (F-217.md 2장) — 이후 갱신은 handle.setTitle()·setTitleReadOnly() 로 한다. 이 값은 최초 생성에만 쓴다
  title?: string
  titleReadOnly?: boolean
  onTitleChange?: OnTitleChange
  onTitleCommit?: OnTitleCommit
  // 문서가 든 폴더 경로 (F-234.md 3.2) — 이후 갱신은 handle.setBreadcrumb() 로 한다. 이 값은 최초 생성에만 쓴다
  breadcrumb?: Breadcrumb
  onNavigateFolder?: OnNavigateFolder
}

export function createEditor(parent: HTMLElement, options: CreateEditorOptions = {}) {
  const {
    text = '',
    viewMode = 'live',
    lineNumbers: showLineNumbers = true,
    indent: indentSize = 4,
    readOnly: initialReadOnly = false,
    onDocChange,
    onSelectionChange,
    wikiTitles = [],
    onOpenWikiLink,
    onImageFiles,
    resolveAttachment,
    title = '',
    titleReadOnly = false,
    onTitleChange = () => {},
    onTitleCommit = () => {},
    breadcrumb = [],
    onNavigateFolder = () => {},
  } = options

  let destroyed = false

  // 목차 갱신은 조합 중 보류, 조합 종료(forceRecalc) 시 즉시 따라잡음 (F-144 3.3)
  const headingsListeners = new Set<(headings: Heading[]) => void>()
  let headingsTimer: ReturnType<typeof setTimeout> | undefined

  function notifyHeadings(state: EditorState) {
    const headings = extractHeadings(state)
    headingsListeners.forEach((cb) => cb(headings))
  }

  const previewCompartment = new Compartment()
  const attributesCompartment = new Compartment()
  const lineNumbersCompartment = new Compartment()
  const gutterAttributesCompartment = new Compartment()
  const indentCompartment = new Compartment()
  const readOnlyCompartment = new Compartment()

  const extensions: Extension[] = [
    docTitleExtension({
      title,
      readOnly: titleReadOnly,
      onChange: onTitleChange,
      onCommit: onTitleCommit,
      breadcrumb,
      onNavigateFolder,
    }),
    lineNumbersCompartment.of(lineNumbersExtensionFor(showLineNumbers)),
    gutterAttributesCompartment.of(gutterAttributesExtensionFor(showLineNumbers)),
    readOnlyCompartment.of(readOnlyExtensionsFor(initialReadOnly)),
    history(),
    EditorView.lineWrapping,
    // 놓을 자리 표시(F-156.md 2.5) — imageInsert() 는 dropFileGuard 보다 먼저 등록해 같은 'drop' 이벤트를 먼저 가로채야 한다(CM6 는 등록 순서로 호출)
    dropCursor(),
    imageInsert({ onImageFiles }),
    dropFileGuard,
    focusRelay(),
    // autoPair() 의 Backspace 키맵(Prec.high)이 markdown()의 deleteMarkupBackward
    // (역시 Prec.high)보다 먼저 받으려면 같은 우선순위 안에서 더 앞서 조립해야 한다
    // (@codemirror/view keymap 문서: "specified early... get checked first")
    autoPair(),
    // base 기본값(commonmarkLanguage)은 GFM 표를 파싱하지 않는다 (spike index.js 86~88행)
    // extensions: 문서 첫 줄 YAML 프론트매터를 Frontmatter 노드로 만든다 (F-133 3.2) —
    // 모드(편집·원문) 공통. 이게 없으면 lezer 는 첫 `---` 를 HorizontalRule, 그 다음
    // 줄을 SetextHeading2 로 잘못 읽는다
    markdown({ base: markdownLanguage, extensions: [frontmatterExtension()] }),
    indentCompartment.of(indentExtensionsFor(indentSize)),
    highlightExtension(),
    // 펼친 코드블록 줄 표시 (F-124 3.4 11번) — 모드(편집·원문)와 무관하게 항상 켠다.
    // highlight.js 의 주석 참고: 태그 자체를 나누는 방법은 실측으로 안 먹히는 것을
    // 확인해 줄 decoration 으로 바꿨다
    fenceLinePreview(),
    // 위키링크 대상 문서 제목(F-131). 모드와 무관하게 항상 켠다 — wikiComplete() 도
    // 같은 필드를 읽고, 모드 전환으로 previewCompartment 가 바뀌어도 값을 잃지 않는다
    wikiTitlesField.init(() => wikiTitles),
    wikiComplete(),
    previewCompartment.of(previewExtensionFor(viewMode, { onOpenWikiLink, resolveAttachment })),
    attributesCompartment.of(attributesExtensionFor(viewMode)),
    // 본문 첫 시각 줄에서 ↑ 는 제목으로 포커스를 옮긴다 — defaultKeymap 커서 이동보다 먼저 받아야 한다 (F-217.md 2.3)
    Prec.high(keymap.of([{ key: 'ArrowUp', run: focusTitleFromBody }])),
    // F-109 단축키가 defaultKeymap 보다 먼저 키를 받도록 Prec.high
    Prec.high(keymap.of(shortcutKeymap)),
    keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
    compositionCatchup(() => destroyed),
    EditorView.updateListener.of((update) => {
      if (update.docChanged && onDocChange) onDocChange(update.state)
      if (update.selectionSet && onSelectionChange) onSelectionChange(update.state)

      if (isForced(update)) {
        clearTimeout(headingsTimer)
        notifyHeadings(update.state)
      } else if (update.docChanged && !isComposing(update.view)) {
        clearTimeout(headingsTimer)
        headingsTimer = setTimeout(() => {
          if (destroyed) return
          notifyHeadings(update.state)
        }, HEADINGS_DEBOUNCE_MS)
      }
    }),
  ]

  const state = EditorState.create({ doc: text, extensions })
  const view = new EditorView({ state, parent })
  const detachMarginClickGuard = attachMarginClickGuard(view)

  return {
    view,

    getText(lineEnding: LineEnding): string {
      const sep = lineEnding === 'crlf' ? '\r\n' : '\n'
      return view.state.doc.sliceString(0, view.state.doc.length, sep)
    },

    focus() {
      view.focus()
    },

    setCursorToStart() {
      view.dispatch({ selection: { anchor: 0, head: 0 } })
    },

    // mode 는 재마운트하지 않는다. 커서·선택·실행 취소 기록 유지
    setViewMode(mode: ViewMode) {
      const scroll = view.scrollSnapshot()
      view.dispatch({
        effects: [
          previewCompartment.reconfigure(previewExtensionFor(mode, { onOpenWikiLink, resolveAttachment })),
          attributesCompartment.reconfigure(attributesExtensionFor(mode)),
          scroll,
        ],
      })
    },

    // on(boolean) — 재마운트하지 않는다. 커서·선택·실행 취소 기록·스크롤 위치 유지 (F-147 2장)
    setLineNumbers(on: boolean) {
      const scroll = view.scrollSnapshot()
      view.dispatch({
        effects: [
          lineNumbersCompartment.reconfigure(lineNumbersExtensionFor(on)),
          gutterAttributesCompartment.reconfigure(gutterAttributesExtensionFor(on)),
          scroll,
        ],
      })
    },

    // 2|4 — 재마운트하지 않는다. 이미 쓴 문서 원문은 바꾸지 않는다 (F-154 2.3)
    setIndent(size: IndentSize) {
      const scroll = view.scrollSnapshot()
      view.dispatch({
        effects: [indentCompartment.reconfigure(indentExtensionsFor(size)), scroll],
      })
    },

    // on(boolean) — 재마운트하지 않는다. 커서·선택·실행 취소 기록 유지 (F-212.md 2.4)
    setReadOnly(on: boolean) {
      view.dispatch({ effects: readOnlyCompartment.reconfigure(readOnlyExtensionsFor(on)) })
    },

    // 문서 제목 목록 갱신 (F-131 3장) — 문서 생성·삭제·제목 변경 시 App 이 부른다
    setWikiTitles(titles: string[]) {
      view.dispatch({ effects: setWikiTitlesEffect.of(titles) })
    },

    // 본문 맨 위 제목 값 갱신 (F-217.md 2.2) — 포커스가 없을 때만 위젯 DOM 값을 바꾼다
    setTitle(value: string) {
      view.dispatch({ effects: setTitleEffect.of(value) })
    },

    // 읽기 전용 전환 (F-217.md 2.4)
    setTitleReadOnly(on: boolean) {
      view.dispatch({ effects: setTitleReadOnlyEffect.of(on) })
    },

    // 폴더 경로 + 이동 콜백 갱신 (F-234.md 3.3) — 경로가 바뀌면 위젯을 다시 그린다(TitleWidget.eq)
    setBreadcrumb(next: Breadcrumb, onNavigate: OnNavigateFolder) {
      view.dispatch({ effects: setBreadcrumbEffect.of({ breadcrumb: next, onNavigateFolder: onNavigate }) })
    },

    // 제목에 포커스 (+ 전체 선택) — 새 문서(F-217.md 2.3, ia.md 3.3)
    focusTitle(selectAll = false) {
      focusTitleWidget(view, selectAll)
    },

    getHeadings(): Heading[] {
      return extractHeadings(view.state)
    },

    // 구독 해제 함수를 돌려준다
    onHeadingsChange(callback: (headings: Heading[]) => void): () => void {
      headingsListeners.add(callback)
      return () => headingsListeners.delete(callback)
    },

    // 화면 밖 줄 높이 추정 오차를 그려진 뒤(rAF 2회) 실측으로 보정 (F-144 3.3, F-152 2.5)
    scrollToHeading(pos: number) {
      const clamped = Math.max(0, Math.min(pos, view.state.doc.length))
      view.dispatch({ effects: EditorView.scrollIntoView(clamped, { y: 'start', yMargin: 16 }) })
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (destroyed) return
          const coords = view.coordsAtPos(clamped)
          if (!coords) return
          const scrollerTop = view.scrollDOM.getBoundingClientRect().top
          const delta = coords.top - scrollerTop - 16
          if (Math.abs(delta) > 0.5) view.scrollDOM.scrollTop += delta
        })
      })
    },

    // 두 번째 호출은 무시한다
    destroy() {
      if (destroyed) return
      destroyed = true
      clearTimeout(headingsTimer)
      headingsListeners.clear()
      detachMarginClickGuard()
      view.destroy()
    },
  }
}

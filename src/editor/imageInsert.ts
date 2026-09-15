// 붙여넣기·끌어놓기로 이미지 받기, 넣을 원문 위치 계산 (F-156.md 2.4·2.5·2.6). 저장은 App 이 넘긴 onImageFiles 콜백이 한다
import { syntaxTree } from '@codemirror/language'
import type { EditorState, Extension } from '@codemirror/state'
import { StateEffect, StateField } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

import { buildImageBlock } from '../lib/imageBlock'
import type { ImageExt } from '../lib/imageBlock'
import { isComposing } from './composition'

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp)$/i
const MD_EXT_RE = /\.md$/i

// 펜스 코드블록·표·프론트매터 범위 안에는 넣지 않는다 (F-156.md 2.6). 표 칸은 별도 하위 EditorView 라 안 닿지만 바깥 문서의 Table 노드도 방어적으로 막는다
const BLOCKED_NODE = new Set(['FencedCode', 'Table', 'Frontmatter'])

// pos 가 펜스 코드블록·표·프론트매터 안인가 (2.6)
export function isBlockedPosition(state: EditorState, pos: number): boolean {
  const node = syntaxTree(state).resolveInner(pos, -1)
  for (let n: typeof node | null = node; n; n = n.parent) {
    if (BLOCKED_NODE.has(n.name)) return true
  }
  return false
}

function lineBounds(text: string, pos: number): { from: number; to: number } {
  // pos===0 특수 처리: lastIndexOf('\n', -1) 은 0 으로 잘려 인덱스 0 이 '\n' 이면 문서 시작 줄을 잘못 앞줄로 본다
  const from = pos === 0 ? 0 : text.lastIndexOf('\n', pos - 1) + 1
  let to = text.indexOf('\n', pos)
  if (to === -1) to = text.length
  return { from, to }
}

// 이미지 블록을 넣을 자리를 계산한다(2.6). docText 는 '\n' 줄바꿈 전체 원문, basePos 는 기준 위치, blockTexts 는 파일 순서대로 만든 블록들 → {from, insert, cursor}
export function computeImagePlacement(
  docText: string,
  basePos: number,
  blockTexts: string[],
): { from: number; insert: string; cursor: number } {
  const pos = Math.max(0, Math.min(basePos, docText.length))
  const { from: lineFrom, to: lineTo } = lineBounds(docText, pos)
  const isEmptyLine = lineFrom === lineTo
  const blockText = blockTexts.join('\n\n')

  let aboveNonEmpty: boolean
  if (isEmptyLine) {
    if (lineFrom === 0) {
      aboveNonEmpty = false
    } else {
      const prevLineEnd = lineFrom - 1 // 앞 줄 바로 뒤 '\n' 위치
      const prevLineStart = docText.lastIndexOf('\n', prevLineEnd - 1) + 1
      aboveNonEmpty = prevLineStart < prevLineEnd
    }
  } else {
    aboveNonEmpty = true // base line 자신이 "블록 위 줄" 이 된다
  }

  const hasNextLine = lineTo < docText.length
  let belowNonEmpty = false
  let nextLineFrom = -1
  if (hasNextLine) {
    nextLineFrom = lineTo + 1
    let nextLineTo = docText.indexOf('\n', nextLineFrom)
    if (nextLineTo === -1) nextLineTo = docText.length
    belowNonEmpty = nextLineFrom < nextLineTo
  }

  const leadingBlank = aboveNonEmpty
  const trailingBlank = hasNextLine && belowNonEmpty

  const from = isEmptyLine ? lineFrom : lineTo
  const lead = (leadingBlank ? '\n' : '') + blockText
  const body = isEmptyLine ? lead : '\n' + lead
  const insert = hasNextLine ? body + (trailingBlank ? '\n' : '') : body + '\n'

  const cursor = hasNextLine ? nextLineFrom + insert.length : from + insert.length

  return { from, insert, cursor }
}

function isImageFile(file: File): boolean {
  if (file.type && file.type.startsWith('image/')) return true
  return IMAGE_EXT_RE.test(file.name ?? '')
}

function isMdFile(file: File): boolean {
  return MD_EXT_RE.test(file.name ?? '')
}

// src/app/fileDrop.js 의 isExternalFileDrag() 와 같은 판정 — src/editor 는 src/app 을 import 하지 않아(단방향 계층) 옮겨 적는다
function isExternalFileDrag(dataTransfer: DataTransfer | null): boolean {
  const types = dataTransfer?.types
  if (!types) return false
  return Array.from(types).includes('Files')
}

// 보기 모드에서는 아무것도 하지 않는다(2.4). 모드는 attributesExtensionFor 가 dom 에 data-view 로 반영해 둔 값으로 판정한다(App state 를 직접 못 본다)
function isViewOnly(view: EditorView): boolean {
  return view.dom.dataset.view === 'view'
}

function measureContentWidth(view: EditorView): number {
  const el = view.contentDOM
  const cs = getComputedStyle(el)
  const padding = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0)
  return Math.floor(el.clientWidth - padding)
}

function waitForCompositionEnd(view: EditorView): Promise<void> {
  if (!isComposing(view)) return Promise.resolve()
  return new Promise((resolve) => {
    const handler = () => {
      view.contentDOM.removeEventListener('compositionend', handler)
      setTimeout(resolve, 0)
    }
    view.contentDOM.addEventListener('compositionend', handler)
  })
}

// 저장(비동기) 사이에 문서가 바뀌면 기준 위치를 그 변경에 맞춰 옮긴다 (F-156.md 2.6)
const setTrackedPos = StateEffect.define<number>()
const trackedPosField = StateField.define<number | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setTrackedPos)) return e.value
    }
    if (value == null) return null
    return tr.changes.mapPos(value)
  },
})

export type AttachedImage = { id: string; ext: ImageExt; alt: string; width: number }
export type ImageInsertSource = 'paste' | 'drop'
export type OnImageFiles = (
  files: File[],
  meta: { source: ImageInsertSource; blocked?: boolean },
) => Promise<AttachedImage[] | undefined> | AttachedImage[] | undefined

async function handleIncomingImages(
  view: EditorView,
  files: File[],
  { source, pos, onImageFiles }: { source: ImageInsertSource; pos: number; onImageFiles?: OnImageFiles },
): Promise<void> {
  if (isBlockedPosition(view.state, pos)) {
    onImageFiles?.([], { source, blocked: true })
    return
  }

  view.dispatch({ effects: setTrackedPos.of(pos) })
  const contentWidth = measureContentWidth(view)

  const attached = await onImageFiles?.(files, { source })
  if (!attached || attached.length === 0) return
  if (!view.contentDOM.isConnected) return // 그 사이 문서를 떠났다(에디터 파괴)

  await waitForCompositionEnd(view) // 한글 조합 중이면 조합이 끝난 뒤 넣는다

  const trackedPos = view.state.field(trackedPosField, false)
  const targetPos = trackedPos ?? pos

  const blocks = attached.map((img) =>
    buildImageBlock({
      id: img.id,
      ext: img.ext,
      alt: img.alt,
      width: Math.max(1, Math.min(img.width, contentWidth || img.width)),
    }),
  )

  const placement = computeImagePlacement(view.state.doc.toString(), targetPos, blocks)
  view.dispatch({
    changes: { from: placement.from, insert: placement.insert },
    selection: { anchor: placement.cursor },
    userEvent: source === 'paste' ? 'input.paste' : 'input.drop',
  })
}

// 붙여넣기·끌어놓기 이미지 받기(2.4·2.5). createEditor.ts 가 onImageFiles(files, {source, blocked?}) => Promise<attached[]> 옵션과 함께 조립한다
export function imageInsert({ onImageFiles }: { onImageFiles?: OnImageFiles } = {}): Extension {
  return [
    trackedPosField,
    EditorView.domEventHandlers({
      paste(event, view) {
        if (!onImageFiles) return false
        if (isViewOnly(view)) return false
        const dt = event.clipboardData
        if (!dt) return false
        // text/plain 이 비어 있지 않으면 글자 붙여넣기가 이긴다 (F-156.md 2.4)
        if (dt.getData('text/plain')) return false
        const files = Array.from(dt.files ?? [])
        const imageFiles = files.filter(isImageFile)
        if (imageFiles.length === 0) return false

        event.preventDefault()
        handleIncomingImages(view, imageFiles, {
          source: 'paste',
          pos: view.state.selection.main.to,
          onImageFiles,
        })
        return true
      },
      drop(event, view) {
        if (!onImageFiles) return false
        if (isViewOnly(view)) return false
        if (!isExternalFileDrag(event.dataTransfer)) return false
        const files = Array.from(event.dataTransfer?.files ?? [])
        // .md 가 섞이면 F-145(App.jsx 창 전체 처리)가 맡는다 — 여기서는 손대지 않는다
        if (files.some(isMdFile)) return false
        const imageFiles = files.filter(isImageFile)
        if (imageFiles.length === 0) return false

        event.preventDefault()
        event.stopPropagation() // App 의 창 전체 드롭 처리(F-145)가 다시 처리하지 않도록
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.to
        handleIncomingImages(view, imageFiles, { source: 'drop', pos, onImageFiles })
        return true
      },
    }),
  ]
}

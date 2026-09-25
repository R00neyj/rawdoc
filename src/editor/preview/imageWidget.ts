// 편집 모드 이미지 블록 위젯 (specs/features/F-157.md). 위치는 위젯이 들고 있지 않고(F-106 2.1), 상호작용 시점에 view.posAtDOM(wrap) 으로 역산한다(F-106 2.3 과 같은 방식)
import { EditorView, WidgetType } from '@codemirror/view'

import type { ImageAlign, ParsedImageBlock } from '../../lib/imageBlock'
import { imageAlignChange, imageWidthChange, imageBlockDeleteRange } from '../../lib/imageBlock'
import { createAttachmentUrl, revokeAttachmentUrl } from '../../lib/attachmentUrls'
import { observeHeight, stopObservingHeight } from './blocks'

import formatAlignLeftSvg from '@material-symbols/svg-400/outlined/format_align_left.svg?raw'
import formatAlignCenterSvg from '@material-symbols/svg-400/outlined/format_align_center.svg?raw'
import formatAlignRightSvg from '@material-symbols/svg-400/outlined/format_align_right.svg?raw'
import deleteSvg from '@material-symbols/svg-400/outlined/delete.svg?raw'
import brokenImageSvg from '@material-symbols/svg-400/outlined/broken_image.svg?raw'

const MIN_WIDTH = 48

export type AttachmentRecord = { blob: Blob; width: number; height: number; e2ee?: true }
export type ResolveAttachment = (id: string) => Promise<AttachmentRecord | null>
type CacheEntry = { url: string | null; promise: Promise<{ url: string; width: number; height: number } | null> }

// 주 EditorView → Map<첨부id, {url, promise}> (F-157 2.2). blocks.js 의 tracker ViewPlugin 이 destroy() 에서 destroyImageCache(view) 를 부른다
const cacheByView = new WeakMap<EditorView, Map<string, CacheEntry>>()

function getImageCache(view: EditorView): Map<string, CacheEntry> {
  let cache = cacheByView.get(view)
  if (!cache) {
    cache = new Map()
    cacheByView.set(view, cache)
  }
  return cache
}

// 에디터(view) destroy 때 부른다 — 캐시에 만든 blob URL 을 모두 해제한다
export function destroyImageCache(view: EditorView | null | undefined): void {
  if (!view) return
  const cache = cacheByView.get(view)
  if (!cache) return
  for (const entry of cache.values()) {
    if (entry.url) revokeAttachmentUrl(entry.url)
  }
  cacheByView.delete(view)
}

// id 별로 한 번만 resolveAttachment 를 불러 blob URL 을 만든다(캐시 적중이면 같은 Promise 재사용)
function loadAttachment(
  view: EditorView,
  id: string,
  resolveAttachment: ResolveAttachment | undefined,
): Promise<{ url: string; width: number; height: number } | null> {
  const cache = getImageCache(view)
  const cached = cache.get(id)
  if (cached) return cached.promise
  const entry: CacheEntry = { url: null, promise: Promise.resolve(null) }
  entry.promise = Promise.resolve()
    .then(() => resolveAttachment?.(id))
    .then((record) => {
      if (!record) return null
      const url = createAttachmentUrl(record)
      entry.url = url
      return { url, width: record.width, height: record.height }
    })
    .catch(() => null)
  cache.set(id, entry)
  return entry.promise
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  return node
}

// 문서 칸 글자 폭(.cm-content 안쪽 폭) — imageInsert.js measureContentWidth() 와 같은 계산을 옮겨 적는다(그 함수는 export 되어 있지 않다)
function measureMaxWidth(view: EditorView): number {
  const contentEl = view.contentDOM
  const cs = getComputedStyle(contentEl)
  const padding = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0)
  return Math.max(MIN_WIDTH, Math.floor(contentEl.clientWidth - padding))
}

// wrap(위젯 최상위 DOM)의 현재 문서 위치에서 3줄 블록 범위를 구한다(F-106 2.3 과 같은 방식)
function currentBlockRange(view: EditorView, wrap: HTMLElement): { blockFrom: number; blockTo: number } {
  const blockFrom = view.posAtDOM(wrap)
  const startLine = view.state.doc.lineAt(blockFrom).number
  const endLineNo = Math.min(startLine + 2, view.state.doc.lines)
  const blockTo = view.state.doc.line(endLineNo).to
  return { blockFrom, blockTo }
}

function currentBlockText(view: EditorView, wrap: HTMLElement): { blockFrom: number; text: string } {
  const { blockFrom, blockTo } = currentBlockRange(view, wrap)
  return { blockFrom, text: view.state.doc.sliceString(blockFrom, blockTo) }
}

function dispatchAlign(view: EditorView, wrap: HTMLElement, align: ImageAlign): void {
  const { blockFrom, text } = currentBlockText(view, wrap)
  const change = imageAlignChange(text, blockFrom, align)
  if (change) view.dispatch({ changes: change, userEvent: 'input.image' })
}

function dispatchWidth(view: EditorView, wrap: HTMLElement, width: number): void {
  const { blockFrom, text } = currentBlockText(view, wrap)
  const change = imageWidthChange(text, blockFrom, width)
  if (change) view.dispatch({ changes: change, userEvent: 'input.image' })
}

// 이미지 블록 3줄(+줄바꿈 1개) 을 지우는 트랜잭션 1개, 커서는 지운 자리(F-218 2.2)
function dispatchDelete(view: EditorView, wrap: HTMLElement): void {
  const { blockFrom, blockTo } = currentBlockRange(view, wrap)
  const range = imageBlockDeleteRange(view.state.doc.toString(), blockFrom, blockTo)
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: '' },
    selection: { anchor: range.from },
    userEvent: 'delete.image',
  })
  view.focus()
}

function buildAlignButton(
  align: ImageAlign,
  label: string,
  svg: string,
  alignNow: ImageAlign,
): { wrapBtn: HTMLDivElement; btn: HTMLButtonElement } {
  const wrapBtn = el('div', 'icon-btn-wrap md-image-align-wrap')
  const btn = el('button', 'icon-btn md-image-align-btn')
  btn.type = 'button'
  btn.dataset.align = align
  btn.setAttribute('aria-label', label)
  btn.setAttribute('aria-pressed', String(align === alignNow))
  btn.innerHTML = svg
  wrapBtn.appendChild(btn)
  const tip = el('span', 'icon-tooltip icon-tooltip--center')
  tip.textContent = label
  wrapBtn.appendChild(tip)
  return { wrapBtn, btn }
}

function buildDeleteButton(view: EditorView, wrap: HTMLElement): HTMLDivElement {
  const wrapBtn = el('div', 'icon-btn-wrap md-image-align-wrap')
  const btn = el('button', 'icon-btn md-image-delete-btn')
  btn.type = 'button'
  btn.setAttribute('aria-label', '이미지 삭제')
  btn.innerHTML = deleteSvg
  wrapBtn.appendChild(btn)
  const tip = el('span', 'icon-tooltip icon-tooltip--center')
  tip.textContent = '이미지 삭제'
  wrapBtn.appendChild(tip)
  btn.addEventListener('mousedown', (event) => event.stopPropagation())
  btn.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    dispatchDelete(view, wrap)
  })
  return wrapBtn
}

function buildToolbar(view: EditorView, wrap: HTMLElement, alignNow: ImageAlign): HTMLDivElement {
  const toolbar = el('div', 'md-image-toolbar')
  const defs: [ImageAlign, string, string][] = [
    ['left', '왼쪽 정렬', formatAlignLeftSvg],
    ['center', '가운데 정렬', formatAlignCenterSvg],
    ['right', '오른쪽 정렬', formatAlignRightSvg],
  ]
  for (const [align, label, svg] of defs) {
    const { wrapBtn, btn } = buildAlignButton(align, label, svg, alignNow)
    btn.addEventListener('mousedown', (event) => event.stopPropagation())
    btn.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      dispatchAlign(view, wrap, align)
    })
    toolbar.appendChild(wrapBtn)
  }
  toolbar.appendChild(el('div', 'md-image-toolbar-divider'))
  toolbar.appendChild(buildDeleteButton(view, wrap))
  return toolbar
}

function ensureSizeLabel(box: HTMLElement): HTMLElement {
  let label = box.querySelector<HTMLElement>('.md-image-size-label')
  if (!label) {
    label = el('span', 'md-image-size-label')
    label.hidden = true
    box.appendChild(label)
  }
  return label
}

type HandleEl = HTMLElement & { _cancelDrag?: () => void }
type Drag = { pointerId: number; startX: number; startWidth: number; align?: string; currentWidth: number }

// 손잡이 하나(가장자리 막대 또는 모서리)에 끌기·키보드 크기 조절을 붙인다 (F-157 2.4)
function attachHandle(handleEl: HandleEl, view: EditorView, wrap: HTMLElement, box: HTMLElement): void {
  let drag: Drag | null = null

  function currentWidth(): number {
    const stored = parseFloat(box.dataset.imgWidth ?? '')
    if (!Number.isNaN(stored) && stored > 0) return stored
    return box.getBoundingClientRect().width
  }

  function revertDisplayWidth(): void {
    const stored = parseFloat(box.dataset.imgWidth ?? '')
    box.style.width = stored > 0 ? `${stored}px` : ''
  }

  function onKeyDownEscape(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      endDrag(false)
    }
  }

  function endDrag(commit: boolean): void {
    if (!drag) return
    document.removeEventListener('keydown', onKeyDownEscape, true)
    const finalWidth = drag.currentWidth
    const label = box.querySelector<HTMLElement>('.md-image-size-label')
    if (label) label.hidden = true
    drag = null
    if (commit) dispatchWidth(view, wrap, finalWidth)
    else revertDisplayWidth()
  }
  handleEl._cancelDrag = () => endDrag(false)

  handleEl.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return
    event.preventDefault()
    event.stopPropagation()
    handleEl.setPointerCapture(event.pointerId)
    handleEl.focus() // preventDefault 가 막은 기본 포커스 이동을 보정 — 끌기 직후 키보드 조절(2.4)이 이어지게
    const startWidth = currentWidth()
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth,
      align: box.dataset.align,
      currentWidth: Math.round(startWidth),
    }
    const label = ensureSizeLabel(box)
    label.textContent = `${drag.currentWidth}px`
    label.hidden = false
    document.addEventListener('keydown', onKeyDownEscape, true)
  })

  handleEl.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return
    const deltaX = event.clientX - drag.startX
    const multiplier = drag.align === 'left' ? 1 : drag.align === 'right' ? -1 : 2
    const maxWidth = measureMaxWidth(view)
    let width = Math.round(drag.startWidth + deltaX * multiplier)
    width = Math.max(MIN_WIDTH, Math.min(width, maxWidth))
    drag.currentWidth = width
    box.style.width = `${width}px`
    const label = box.querySelector('.md-image-size-label')
    if (label) label.textContent = `${width}px`
  })

  handleEl.addEventListener('pointerup', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return
    endDrag(true)
  })
  handleEl.addEventListener('pointercancel', () => endDrag(false))

  handleEl.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    event.stopPropagation()
    const step = event.shiftKey ? 50 : 10
    const dir = event.key === 'ArrowRight' ? 1 : -1
    const maxWidth = measureMaxWidth(view)
    const width = Math.max(MIN_WIDTH, Math.min(Math.round(currentWidth() + dir * step), maxWidth))
    dispatchWidth(view, wrap, width)
  })
}

function buildHandles(view: EditorView, wrap: HTMLElement, box: HTMLElement): { edge: HTMLDivElement; corner: HTMLDivElement } {
  const edge = el('div', 'md-image-handle md-image-handle-edge')
  edge.tabIndex = 0
  edge.setAttribute('role', 'slider')
  edge.setAttribute('aria-label', '크기 조절')
  const corner = el('div', 'md-image-handle md-image-handle-corner')
  corner.tabIndex = 0
  corner.setAttribute('role', 'slider')
  corner.setAttribute('aria-label', '크기 조절')

  attachHandle(edge, view, wrap, box)
  attachHandle(corner, view, wrap, box)

  return { edge, corner }
}

function renderPlaceholder(frame: HTMLElement, alt: string): void {
  frame.replaceChildren()
  frame.classList.add('md-image-missing')
  frame.style.aspectRatio = ''
  const icon = el('span', 'md-image-missing-icon')
  icon.innerHTML = brokenImageSvg
  icon.setAttribute('aria-hidden', 'true')
  const text = el('span', 'md-image-missing-text')
  text.textContent = '이미지를 찾을 수 없습니다'
  frame.append(icon, text)
  frame.setAttribute('aria-label', alt || '이미지')
}

function renderImage(frame: HTMLElement, url: string, alt: string, naturalWidth: number, naturalHeight: number): void {
  frame.replaceChildren()
  frame.classList.remove('md-image-missing')
  if (naturalWidth > 0 && naturalHeight > 0) frame.style.aspectRatio = `${naturalWidth} / ${naturalHeight}`
  const img = el('img', 'md-image-img')
  img.src = url
  img.alt = alt
  frame.appendChild(img)
  frame.setAttribute('aria-label', alt || '이미지')
}

// 편집 모드 이미지 블록 위젯 (F-157 2.1~2.5). eq() 는 id·ext·alt·align·width 로 판정하고, id·ext·alt 가 같으면 updateDOM 으로 align·width 만 갱신한다
export class ImageWidget extends WidgetType {
  id: string
  ext: string
  alt: string
  align: ImageAlign
  width: number | null
  resolveAttachment?: ResolveAttachment
  key: string

  constructor(parsed: ParsedImageBlock, resolveAttachment?: ResolveAttachment) {
    super()
    this.id = parsed.id
    this.ext = parsed.ext
    this.alt = parsed.alt
    this.align = parsed.align
    this.width = parsed.width
    this.resolveAttachment = resolveAttachment
    this.key = JSON.stringify({ id: this.id, ext: this.ext, alt: this.alt, align: this.align, width: this.width })
  }

  eq(other: ImageWidget): boolean {
    return other.key === this.key
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = el('div', 'md-block md-image')
    wrap.dataset.imgId = this.id
    wrap.dataset.imgExt = this.ext
    wrap.dataset.imgAlt = this.alt

    const box = el('div', 'md-image-box')
    box.dataset.align = this.align
    box.dataset.imgWidth = this.width ? String(this.width) : ''
    if (this.width) box.style.width = `${this.width}px`
    wrap.appendChild(box)

    const frame = el('div', 'md-image-frame')
    frame.setAttribute('role', 'img')
    frame.setAttribute('aria-label', this.alt || '이미지')
    box.appendChild(frame)

    const toolbar = buildToolbar(view, wrap, this.align)
    box.appendChild(toolbar)

    const { edge, corner } = buildHandles(view, wrap, box)
    box.appendChild(edge)
    box.appendChild(corner)

    this._loadImage(view, frame)

    wrap.addEventListener('mousedown', (event) => {
      if ((event.target as Element | null)?.closest?.('.md-image-align-btn, .md-image-delete-btn, .md-image-handle')) return
      event.preventDefault()
    })
    wrap.addEventListener('dblclick', (event) => {
      if ((event.target as Element | null)?.closest?.('.md-image-align-btn, .md-image-delete-btn, .md-image-handle')) return
      event.preventDefault()
      const { blockFrom } = currentBlockRange(view, wrap)
      view.dispatch({ selection: { anchor: blockFrom } })
      view.focus()
    })

    observeHeight(wrap, view)
    return wrap
  }

  _loadImage(view: EditorView, frame: HTMLElement): void {
    const id = this.id
    const alt = this.alt
    loadAttachment(view, id, this.resolveAttachment).then((resolved) => {
      if (!frame.isConnected) return
      if (frame.dataset.loadedFor === id) return // 이미 같은 첨부로 그렸다(중복 방지)
      frame.dataset.loadedFor = id
      if (!resolved) renderPlaceholder(frame, alt)
      else renderImage(frame, resolved.url, alt, resolved.width, resolved.height)
    })
  }

  updateDOM(dom: HTMLElement): boolean {
    if (dom.dataset.imgId !== this.id || dom.dataset.imgExt !== this.ext || dom.dataset.imgAlt !== this.alt) {
      return false
    }
    const box = dom.querySelector<HTMLElement>('.md-image-box')!
    box.dataset.align = this.align
    box.dataset.imgWidth = this.width ? String(this.width) : ''
    box.style.width = this.width ? `${this.width}px` : ''
    dom.querySelectorAll<HTMLElement>('.md-image-align-btn').forEach((btn) => {
      btn.setAttribute('aria-pressed', String(btn.dataset.align === this.align))
    })
    return true
  }

  ignoreEvent(): boolean {
    return true
  }

  destroy(dom: HTMLElement): void {
    stopObservingHeight(dom)
    dom.querySelectorAll<HandleEl>('.md-image-handle').forEach((h) => h._cancelDrag?.())
  }
}

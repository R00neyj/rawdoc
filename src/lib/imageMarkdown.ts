// 표준 마크다운 이미지 한 줄 `![alt|center|300](attachments/{id}.{ext})` 해석·만들기·조각 고치기 (F-2127.md 2장). 순수 함수
import type { CodeMirrorChange, ImageAlign, ImageExt } from './imageBlock'

export type ParsedImageLine = {
  alt: string
  align: ImageAlign
  width: number | null
  url: string
}
export type ImageTarget = { id: string; ext: ImageExt }
export type ResolveImagePath = (path: string) => ImageTarget | null

const LINE_RE = /^!\[([^[\]\n]*)\]\((<[^<>\n]+>|[^\s()<][^\s()]*)(?:\s+"[^"\n]*")?\)$/
const SRC_RE = /^attachments\/([0-9a-f]{16})\.(png|jpg|gif|webp)$/
const SCHEME_RE = /^([A-Za-z][A-Za-z0-9+.-]*:|\/\/)/
const WIDTH_PIECE_RE = /^(\d{1,4})(?:x\d{1,4})?$/
const ALIGNS = new Set(['left', 'center', 'right'])

type Piece = { text: string; start: number; end: number }

// alt 원문을 `|` 로 나눠 각 조각의 alt 안 위치를 단다
function splitPieces(raw: string): Piece[] {
  const out: Piece[] = []
  let start = 0
  for (const text of raw.split('|')) {
    out.push({ text, start, end: start + text.length })
    start += text.length + 1
  }
  return out
}

function widthOfPiece(piece: string): number | null {
  const m = WIDTH_PIECE_RE.exec(piece.trim())
  return m && Number(m[1]) >= 1 ? Number(m[1]) : null
}

// 뒤에서부터 너비·정렬 조각의 인덱스를 찾는다 (2.1)
function locatePieces(pieces: Piece[]): { widthIdx: number; alignIdx: number; width: number | null; align: ImageAlign } {
  let n = pieces.length
  let widthIdx = -1
  let alignIdx = -1
  let width: number | null = null
  let align: ImageAlign = 'left'
  if (n >= 2) {
    const w = widthOfPiece(pieces[n - 1].text)
    if (w !== null) {
      widthIdx = n - 1
      width = w
      n -= 1
    }
  }
  if (n >= 2) {
    const a = pieces[n - 1].text.trim()
    if (ALIGNS.has(a)) {
      alignIdx = n - 1
      align = a as ImageAlign
    }
  }
  return { widthIdx, alignIdx, width, align }
}

export function parseImageLine(text: string): ParsedImageLine | null {
  if (typeof text !== 'string') return null
  const trimmed = text.replace(/^[ \t]+|[ \t]+$/g, '')
  const m = LINE_RE.exec(trimmed)
  if (!m) return null
  const pieces = splitPieces(m[1])
  const { widthIdx, alignIdx, width, align } = locatePieces(pieces)
  const keep = pieces.length - (widthIdx >= 0 ? 1 : 0) - (alignIdx >= 0 ? 1 : 0)
  const alt = pieces
    .slice(0, keep)
    .map((p) => p.text)
    .join('|')
  const url = m[2].startsWith('<') ? m[2].slice(1, -1) : m[2]
  return { alt, align, width, url }
}

export function imageLineTarget(parsed: ParsedImageLine, resolveImagePath?: ResolveImagePath): ImageTarget | null {
  const m = SRC_RE.exec(parsed.url)
  if (m) return { id: m[1], ext: m[2] as ImageExt }
  if (SCHEME_RE.test(parsed.url)) return null
  return resolveImagePath?.(parsed.url) ?? null
}

function sanitizeAlt(raw: string): string {
  return String(raw ?? '')
    .replace(/\r\n|\r|\n/g, ' ')
    .replace(/[\\[\]|]/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim()
    .slice(0, 100)
    .trim()
}

export function buildImageLine({
  id,
  ext,
  alt,
  width,
  align,
}: {
  id: string
  ext: ImageExt
  alt: string
  width?: number | null
  align?: ImageAlign
}): string {
  const alignPart = align && align !== 'left' ? `|${align}` : ''
  const widthPart = typeof width === 'number' ? `|${Math.max(1, Math.round(width))}` : ''
  return `![${sanitizeAlt(alt)}${alignPart}${widthPart}](attachments/${id}.${ext})`
}

// 줄 안 alt 범위 [from, to) 와 그 조각들 — 해석에 성공한 줄만 부른다
function altRegion(lineText: string): { altFrom: number; raw: string } {
  const altFrom = lineText.indexOf('![') + 2
  const altTo = lineText.indexOf('](', altFrom)
  return { altFrom, raw: lineText.slice(altFrom, altTo) }
}

export function imageLineAlignChange(lineText: string, lineFrom: number, align: ImageAlign): CodeMirrorChange | null {
  const parsed = parseImageLine(lineText)
  if (!parsed || parsed.align === align) return null
  const { altFrom, raw } = altRegion(lineText)
  const pieces = splitPieces(raw)
  const { widthIdx, alignIdx } = locatePieces(pieces)
  const base = lineFrom + altFrom
  if (alignIdx >= 0) {
    const p = pieces[alignIdx]
    if (align === 'left') return { from: base + p.start - 1, to: base + p.end, insert: '' }
    return { from: base + p.start, to: base + p.end, insert: align }
  }
  const at = widthIdx >= 0 ? base + pieces[widthIdx].start - 1 : base + raw.length
  return { from: at, to: at, insert: `|${align}` }
}

export function imageLineWidthChange(lineText: string, lineFrom: number, width: number): CodeMirrorChange | null {
  const parsed = parseImageLine(lineText)
  if (!parsed) return null
  const safe = Math.max(1, Math.round(width))
  if (parsed.width === safe) return null
  const { altFrom, raw } = altRegion(lineText)
  const pieces = splitPieces(raw)
  const { widthIdx } = locatePieces(pieces)
  const base = lineFrom + altFrom
  if (widthIdx >= 0) {
    const p = pieces[widthIdx]
    return { from: base + p.start, to: base + p.end, insert: String(safe) }
  }
  const at = base + raw.length
  return { from: at, to: at, insert: `|${safe}` }
}

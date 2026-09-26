// 이미지 블록 → 옵시디언 임베드 문자열 (specs/features/F-2020.md 5.3). markdown-it 을 import 하지 않는다 — F-2019 가 뒤에 임베드→블록 함수를 덧붙인다
import { buildImageBlock, parseImageBlock, type ImageAlign, type ImageExt, type ParsedImageBlock } from './imageBlock'
import { findFrontmatter } from './frontmatter'

export function imageBlockToEmbed(block: Pick<ParsedImageBlock, 'id' | 'ext' | 'width'>): string {
  const suffix = typeof block.width === 'number' ? `|${block.width}` : ''
  return `![[${block.id}.${block.ext}${suffix}]]`
}

// ---------- F-2019.md 5장 — 임베드 → 블록 (obsidianImage.ts 는 F-2020 이 만든 모듈에 여기부터 덧붙인다) ----------

export type VaultEmbed = {
  line: number // 0부터
  from: number
  to: number // 원문 안 위치
  syntax: 'wiki' | 'markdown'
  target: string
  caption: string | null
  width: number | null
  kind: 'image' | 'other'
  standalone: boolean
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'])

function emptyToNull(s: string): string | null {
  return s === '' ? null : s
}

function isSizeShape(seg: string): boolean {
  return /^\d+(x\d+)?$/.test(seg.trim())
}

// 크기 모양이면 폭을 돌려준다(1~9999 만, 그 밖은 null — 크기 없는 것으로 본다, 5.1)
function sizeShapeWidth(seg: string): number | null {
  const m = /^(\d+)(x\d+)?$/.exec(seg.trim())
  if (!m) return null
  const w = Number(m[1])
  return w >= 1 && w <= 9999 ? w : null
}

// 조각들(target 을 뗀 나머지, 또는 markdown alt 전체)에서 caption·width 를 가른다 (5.1)
function captionWidthFromParts(parts: string[]): { caption: string | null; width: number | null } {
  if (parts.length === 0) return { caption: null, width: null }
  const last = parts[parts.length - 1]
  if (isSizeShape(last)) {
    const width = sizeShapeWidth(last)
    const captionParts = parts.slice(0, -1)
    return { caption: emptyToNull(captionParts.join('|')), width }
  }
  return { caption: emptyToNull(parts.join('|')), width: null }
}

function parseWikiInner(inner: string): { target: string; caption: string | null; width: number | null } {
  const parts = inner.split('|')
  const target = parts[0].trim()
  const { caption, width } = captionWidthFromParts(parts.slice(1))
  return { target, caption, width }
}

function parseMdAlt(alt: string): { caption: string | null; width: number | null } {
  if (alt === '') return { caption: null, width: null }
  const parts = alt.split('|')
  if (parts.length === 1) return { caption: alt, width: null }
  return captionWidthFromParts(parts)
}

// '<' '>' 를 벗기고, 없으면 끝의 ' "제목"' 을 뗀다 (5.1)
function extractMdTarget(paren: string): string {
  const s = paren.trim()
  if (s.startsWith('<')) {
    const closeIdx = s.indexOf('>')
    return closeIdx === -1 ? s.slice(1) : s.slice(1, closeIdx)
  }
  const titleMatch = /^([\s\S]*?)\s+"[^"]*"$/.exec(s)
  return titleMatch ? titleMatch[1].trim() : s
}

function decodeMdTarget(t: string): string {
  try {
    return decodeURIComponent(t)
  } catch {
    return t
  }
}

const SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*:/

function isExternalTarget(t: string): boolean {
  return SCHEME_RE.test(t) || t.startsWith('//')
}

function targetKind(target: string): 'image' | 'other' {
  const last = target.split(/[/\\]/).pop() ?? target
  const m = /\.([a-zA-Z0-9]+)$/.exec(last)
  return m && IMAGE_EXTS.has(m[1].toLowerCase()) ? 'image' : 'other'
}

// 줄 시작 위치와 함께 훑는다 — wikiGraph.ts 의 것과 같은 규칙 (F-2019.md 5.1)
function linesWithOffsets(text: string): { line: string; start: number }[] {
  const result: { line: string; start: number }[] = []
  let pos = 0
  while (pos <= text.length) {
    let end = pos
    while (end < text.length && text[end] !== '\n' && text[end] !== '\r') end++
    result.push({ line: text.slice(pos, end), start: pos })
    if (end >= text.length) break
    pos = text[end] === '\r' && text[end + 1] === '\n' ? end + 2 : end + 1
  }
  return result
}

// 펜스 여닫기 판정 — comments.ts 의 matchFenceAtLineStart·isClosingFenceLine 과 같은 규칙 (0~3칸, 목록 기호 없음, 5.1)
function matchFenceOpen(line: string): { char: string; len: number } | null {
  let j = 0
  let spaces = 0
  while (spaces < 3 && line[j] === ' ') {
    j++
    spaces++
  }
  const ch = line[j]
  if (ch !== '`' && ch !== '~') return null
  let len = 0
  while (line[j] === ch) {
    len++
    j++
  }
  return len < 3 ? null : { char: ch, len }
}

function isFenceClose(line: string, fenceChar: string, fenceLen: number): boolean {
  let j = 0
  let spaces = 0
  while (spaces < 3 && line[j] === ' ') {
    j++
    spaces++
  }
  let len = 0
  while (line[j] === fenceChar) {
    len++
    j++
  }
  if (len < fenceLen) return false
  for (; j < line.length; j++) {
    if (line[j] !== ' ' && line[j] !== '\t') return false
  }
  return true
}

// 같은 길이 백틱 묶음 사이(인라인 코드) 범위 — wikiGraph.ts maskInlineCode 와 같은 규칙, 범위로 돌려준다 (5.1)
function inlineCodeRanges(line: string): Array<[number, number]> {
  const runs: { start: number; end: number; len: number }[] = []
  const re = /`+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line))) runs.push({ start: m.index, end: m.index + m[0].length, len: m[0].length })
  const ranges: Array<[number, number]> = []
  let i = 0
  while (i < runs.length) {
    const open = runs[i]
    let j = i + 1
    while (j < runs.length && runs[j].len !== open.len) j++
    if (j < runs.length) {
      ranges.push([open.start, runs[j].end])
      i = j + 1
    } else break
  }
  return ranges
}

function isBlankLine(line: string): boolean {
  return /^[ \t]*$/.test(line)
}

const WIKI_EMBED_RE = /!\[\[([^\]\n]+)\]\]/g
const MD_EMBED_RE = /!\[([^\]\n]*)\]\(([^)\n]+)\)/g

// 옵시디언 임베드(위키·markdown)를 원문에서 훑는다 — 프론트매터·펜스·인라인 코드 안은 보지 않는다 (F-2019.md 5.1)
export function findVaultEmbeds(markdown: string): VaultEmbed[] {
  const text = markdown
  const chars = text.split('')
  function maskRange(from: number, to: number) {
    for (let i = from; i < to; i++) {
      if (chars[i] !== '\n' && chars[i] !== '\r') chars[i] = ' '
    }
  }

  const fm = findFrontmatter(text)
  if (fm) maskRange(0, fm.to)

  const lines = linesWithOffsets(text)

  let fenceState: { char: string; len: number } | null = null
  for (const { line, start } of lines) {
    if (fenceState) {
      maskRange(start, start + line.length)
      if (isFenceClose(line, fenceState.char, fenceState.len)) fenceState = null
      continue
    }
    const open = matchFenceOpen(line)
    if (open) {
      fenceState = open
      maskRange(start, start + line.length)
    }
  }

  for (const { line, start } of lines) {
    for (const [a, b] of inlineCodeRanges(line)) maskRange(start + a, start + b)
  }

  const masked = chars.join('')
  const lineStarts = lines.map((l) => l.start)
  function lineIndexOf(pos: number): number {
    let lo = 0
    let hi = lineStarts.length - 1
    let ans = 0
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (lineStarts[mid] <= pos) {
        ans = mid
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
    return ans
  }

  type Raw = { from: number; to: number; syntax: 'wiki' | 'markdown'; target: string; caption: string | null; width: number | null }
  const raws: Raw[] = []

  let m: RegExpExecArray | null
  WIKI_EMBED_RE.lastIndex = 0
  while ((m = WIKI_EMBED_RE.exec(masked))) {
    const { target, caption, width } = parseWikiInner(m[1])
    if (target === '') continue
    raws.push({ from: m.index, to: m.index + m[0].length, syntax: 'wiki', target, caption, width })
  }

  MD_EMBED_RE.lastIndex = 0
  while ((m = MD_EMBED_RE.exec(masked))) {
    const rawTarget = extractMdTarget(m[2])
    if (rawTarget === '' || isExternalTarget(rawTarget)) continue
    const target = decodeMdTarget(rawTarget)
    const { caption, width } = parseMdAlt(m[1])
    raws.push({ from: m.index, to: m.index + m[0].length, syntax: 'markdown', target, caption, width })
  }

  raws.sort((a, b) => a.from - b.from)

  const lineOccupancy = new Map<number, number>()
  const withLine = raws.map((r) => {
    const lineIdx = lineIndexOf(r.from)
    lineOccupancy.set(lineIdx, (lineOccupancy.get(lineIdx) ?? 0) + 1)
    return { ...r, lineIdx }
  })

  return withLine.map((r) => {
    const lineInfo = lines[r.lineIdx]
    const column = r.from - lineInfo.start
    const after = lineInfo.line.slice(r.to - lineInfo.start)
    const standalone = column === 0 && lineOccupancy.get(r.lineIdx) === 1 && /^[ \t]*$/.test(after)
    return {
      line: r.lineIdx,
      from: r.from,
      to: r.to,
      syntax: r.syntax,
      target: r.target,
      caption: r.caption,
      width: r.width,
      kind: targetKind(r.target),
      standalone,
    }
  })
}

export type EmbedBlock = { id: string; ext: ImageExt; alt: string; width: number | null; align: ImageAlign }

// blocks 에 든 임베드가 있는 줄만 F-156 블록 3줄로 바꾼다. 앞뒤 빈 줄 규칙(5.3) — markdown 은 '\n' 으로만 줄이 나뉜다
export function embedsToImageBlocks(markdown: string, blocks: ReadonlyMap<VaultEmbed, EmbedBlock>): string {
  if (blocks.size === 0) return markdown

  const lines = markdown.split('\n')
  const blockByLine = new Map<number, EmbedBlock>()
  for (const [embed, block] of blocks) blockByLine.set(embed.line, block)

  const isBlockLine = (i: number) => blockByLine.has(i)

  const insertAfter = new Array<boolean>(lines.length).fill(false) // boundary i↔i+1
  for (let i = 0; i < lines.length - 1; i++) {
    const aIsBlock = isBlockLine(i)
    const bIsBlock = isBlockLine(i + 1)
    if (!aIsBlock && !bIsBlock) continue
    const needAfterA = aIsBlock && !isBlankLine(lines[i + 1])
    const needBeforeB = bIsBlock && !isBlankLine(lines[i])
    insertAfter[i] = needAfterA || needBeforeB
  }

  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const block = blockByLine.get(i)
    if (block) {
      out.push(buildImageBlock({ id: block.id, ext: block.ext, alt: block.alt, width: block.width, align: block.align }))
    } else {
      out.push(lines[i])
    }
    if (i < lines.length - 1 && insertAfter[i]) out.push('')
  }

  return out.join('\n')
}

// 원문 안 F-156 블록(줄 첫 칸 <div align= 줄 + 뒤 두 줄)을 문서 순서로. 3줄 뒤가 문서 끝이거나 빈 줄이어야 블록으로 본다 — 아니면 4줄째까지 이어지는 html_block 이라 보기 모드에서는 블록이 아니다 (F-2019.md 5.4)
export function listImageBlocks(markdown: string): Array<{ line: number; block: ParsedImageBlock }> {
  const lines = markdown.split('\n')
  const result: Array<{ line: number; block: ParsedImageBlock }> = []
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('<div align=')) continue
    if (i + 2 >= lines.length) continue
    const next = lines[i + 3]
    if (next !== undefined && !isBlankLine(next)) continue
    const candidate = [lines[i], lines[i + 1], lines[i + 2]].join('\n')
    const parsed = parseImageBlock(candidate)
    if (parsed) result.push({ line: i, block: parsed })
  }
  return result
}

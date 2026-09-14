// 이미지 블록 원문 만들기·해석·첨부 id 추출·속성 값 바꾸기 (F-156.md 2.1). 순수 함수, 줄은 항상 '\n' — lineEnding 변환은 이 파일 밖(CM6 doc)에서 한다

const SRC_RE = /^attachments\/([0-9a-f]{16})\.(png|jpg|gif|webp)$/
const REF_RE = /attachments\/[0-9a-f]{16}\.(?:png|jpg|gif|webp)/g
const WIDTH_RE = /^[0-9]{1,4}$/
const ALIGN_VALUES = new Set(['left', 'center', 'right'])
const INDENT = '  ' // img 줄 들여쓰기는 항상 공백 2칸 (F-154 설정과 무관)

function escapeAlt(raw) {
  return String(raw ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function unescapeAlt(raw) {
  return String(raw ?? '')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

// 줄바꿈을 공백으로, 100자에서 자르고, 4개 문자 참조로 이스케이프한다 (2.1)
function sanitizeAlt(raw) {
  const flattened = String(raw ?? '').replace(/\r\n|\r|\n/g, ' ')
  return escapeAlt(flattened.slice(0, 100))
}

// 이미지 블록 원문 3줄을 만든다. params: {id, ext, alt, width, align?} → '\n' 으로 이은 3줄
export function buildImageBlock({ id, ext, alt, width, align = 'center' }) {
  const safeAlt = sanitizeAlt(alt)
  const safeWidth = Math.max(1, Math.round(width))
  return [
    `<div align="${align}">`,
    `${INDENT}<img src="attachments/${id}.${ext}" alt="${safeAlt}" width="${safeWidth}">`,
    '</div>',
  ].join('\n')
}

// attrsStr(따옴표 안 값)을 key="value" 쌍으로 해석한다. 순서 무관, 각 1번, 그 밖의 글자가 있으면 null
function parseAttrs(attrsStr) {
  const ATTR_RE = /([a-zA-Z]+)="([^"]*)"/g
  const result = {}
  const seen = new Set()
  let lastEnd = 0
  let m
  while ((m = ATTR_RE.exec(attrsStr))) {
    const gap = attrsStr.slice(lastEnd, m.index)
    if (!/^\s*$/.test(gap) || (lastEnd > 0 && gap.length === 0)) return null
    const key = m[1]
    if (!['src', 'alt', 'width'].includes(key)) return null
    if (seen.has(key)) return null
    seen.add(key)
    result[key] = m[2]
    lastEnd = ATTR_RE.lastIndex
  }
  if (!/^\s*$/.test(attrsStr.slice(lastEnd))) return null
  if (!('src' in result)) return null
  return result
}

// 정확히 3줄인 이미지 블록 원문을 해석한다. 맞지 않으면 null(원문 그대로 취급)
export function parseImageBlock(text) {
  if (typeof text !== 'string') return null
  const lines = text.split(/\r\n|\r|\n/)
  if (lines.length !== 3) return null

  const [rawLine1, rawLine2, rawLine3] = lines.map((l) => l.replace(/[ \t]+$/, ''))

  const openMatch = /^<div align="(left|center|right)">$/.exec(rawLine1)
  if (!openMatch || !ALIGN_VALUES.has(openMatch[1])) return null
  if (rawLine3 !== '</div>') return null

  const imgMatch = /^[ \t]*<img\s+(.+?)\s*\/?>$/.exec(rawLine2)
  if (!imgMatch) return null

  const attrs = parseAttrs(imgMatch[1])
  if (!attrs) return null

  const srcMatch = SRC_RE.exec(attrs.src)
  if (!srcMatch) return null

  let width = null
  if ('width' in attrs) {
    if (!WIDTH_RE.test(attrs.width)) return null
    width = Number(attrs.width)
  }

  return {
    align: openMatch[1],
    id: srcMatch[1],
    ext: srcMatch[2],
    src: attrs.src,
    alt: 'alt' in attrs ? unescapeAlt(attrs.alt) : '',
    width,
  }
}

// 내용 안 모든 attachments/{16hex}.{ext} 문자열의 id 집합 — 블록 해석과 무관하게 넓게 잡아 원문이 깨져도 첨부를 안 지운다 (2.1)
export function extractAttachmentRefs(content) {
  const ids = new Set()
  if (typeof content !== 'string') return ids
  let m
  REF_RE.lastIndex = 0
  while ((m = REF_RE.exec(content))) {
    const id = /attachments\/([0-9a-f]{16})\./.exec(m[0])[1]
    ids.add(id)
  }
  return ids
}

// align 값 글자만 바꾸는 CM6 변경 하나를 계산한다 (F-157.md 2.3). blockFrom 은 blockText 가 문서 안에서 시작하는 위치. 해석 실패·align 값이 이미 같으면 null
export function imageAlignChange(blockText, blockFrom, align) {
  const parsed = parseImageBlock(blockText)
  if (!parsed || parsed.align === align) return null
  const line1 = blockText.split('\n')[0]
  const m = /align="(left|center|right)"/.exec(line1)
  if (!m) return null
  const valueStart = blockFrom + m.index + 'align="'.length
  return { from: valueStart, to: valueStart + m[1].length, insert: align }
}

// width 값 글자만 바꾸는 CM6 변경 하나를 계산한다 (F-157.md 2.4). width 속성이 없으면 alt 뒤(alt 도 없으면 src 뒤)에 ` width="{N}"` 을 넣는다. 해석 실패·값이 이미 같으면 null
export function imageWidthChange(blockText, blockFrom, width) {
  const parsed = parseImageBlock(blockText)
  if (!parsed) return null
  const safeWidth = Math.max(1, Math.round(width))
  if (parsed.width === safeWidth) return null

  const lines = blockText.split('\n')
  const line2 = lines[1]
  const line2Start = blockFrom + lines[0].length + 1 // +1 은 줄 사이 '\n'

  const widthMatch = /width="([0-9]{1,4})"/.exec(line2)
  if (widthMatch) {
    const valueStart = line2Start + widthMatch.index + 'width="'.length
    return { from: valueStart, to: valueStart + widthMatch[1].length, insert: String(safeWidth) }
  }

  const altMatch = /alt="[^"]*"/.exec(line2)
  if (altMatch) {
    const insertAt = line2Start + altMatch.index + altMatch[0].length
    return { from: insertAt, to: insertAt, insert: ` width="${safeWidth}"` }
  }

  const srcMatch = /src="[^"]*"/.exec(line2)
  const insertAt = line2Start + srcMatch.index + srcMatch[0].length
  return { from: insertAt, to: insertAt, insert: ` width="${safeWidth}"` }
}

// 이미 있는 이미지 블록의 align·width·alt 값을 바꿔 새 원문을 만든다(F-157·F-158 용). 해석 실패면 null
export function setImageBlockAttrs(blockText, patch) {
  const parsed = parseImageBlock(blockText)
  if (!parsed) return null
  return buildImageBlock({
    id: parsed.id,
    ext: parsed.ext,
    alt: 'alt' in patch ? patch.alt : parsed.alt,
    width: 'width' in patch ? patch.width : (parsed.width ?? 1),
    align: 'align' in patch ? patch.align : parsed.align,
  })
}

// 칸반 카드 글자 속 첨부 이미지 문법을 빼내 썸네일 목록으로 — 원문은 바꾸지 않는다 (small 2026-10-24)
import type { ImageExt } from '../imageBlock'
import { buildImageLine, imageLineTarget, parseImageLine } from '../imageMarkdown'

export type CardImage = { id: string; alt: string }

const CODE_SPAN_RE = /(`+)[\s\S]*?\1/g
const IMAGE_RE = /!\[[^[\]\n]*\]\((?:<[^<>\n]+>|[^\s()<][^\s()]*)(?:\s+"[^"\n]*")?\)/g

export function takeCardImages(text: string): { text: string; images: CardImage[] } {
  const images: CardImage[] = []
  let out = ''
  let last = 0
  const strip = (part: string) =>
    part.replace(IMAGE_RE, (match) => {
      const line = parseImageLine(match)
      const target = line && imageLineTarget(line)
      if (!line || !target || !('id' in target)) return match
      images.push({ id: target.id, alt: line.alt })
      return ' '
    })
  for (const code of text.matchAll(CODE_SPAN_RE)) {
    out += strip(text.slice(last, code.index)) + code[0]
    last = code.index + code[0].length
  }
  out += strip(text.slice(last))
  if (images.length === 0) return { text, images }
  return { text: out.replace(/[ \t]{2,}/g, ' ').trim(), images }
}

// 카드 첫 줄과 하위 줄을 함께 — 이미지만 있던 하위 줄은 체크 줄이 아니면 뺀다
export function cardImageView<L extends { text: string; kind: string }>(text: string, lines: L[]): { text: string; lines: L[]; images: CardImage[] } {
  const head = takeCardImages(text)
  const images = [...head.images]
  const kept: L[] = []
  for (const line of lines) {
    const taken = takeCardImages(line.text)
    images.push(...taken.images)
    if (taken.images.length > 0 && taken.text === '' && line.kind !== 'check') continue
    kept.push(taken.images.length > 0 ? { ...line, text: taken.text } : line)
  }
  return { text: head.text, lines: kept, images }
}

// 카드 입력칸에 붙여넣은 첨부 이미지 문법 — 글자 바로 뒤면 공백 하나를 앞에 둔다
export function inlineImageInsert(doc: string, pos: number, images: { id: string; ext: ImageExt; alt: string }[]): string {
  const before = pos > 0 ? doc[pos - 1] : ''
  const lead = before === '' || /\s/.test(before) ? '' : ' '
  return lead + images.map((img) => buildImageLine(img)).join(' ')
}

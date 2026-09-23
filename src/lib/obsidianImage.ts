// 이미지 블록 → 옵시디언 임베드 문자열 (specs/features/F-2020.md 5.3). markdown-it 을 import 하지 않는다 — F-2019 가 뒤에 임베드→블록 함수를 덧붙인다
import type { ParsedImageBlock } from './imageBlock'

export function imageBlockToEmbed(block: Pick<ParsedImageBlock, 'id' | 'ext' | 'width'>): string {
  const suffix = typeof block.width === 'number' ? `|${block.width}` : ''
  return `![[${block.id}.${block.ext}${suffix}]]`
}

// F-2020.md 5.3·11.1 U4 — 이미지 블록 → 옵시디언 임베드
import { describe, it, expect } from 'vitest'
import { imageBlockToEmbed } from './obsidianImage'

describe('imageBlockToEmbed (F-2020 U4)', () => {
  it('width 가 수이면 |{width} 를 붙인다', () => {
    expect(imageBlockToEmbed({ id: 'abc123', ext: 'png', width: 300 })).toBe('![[abc123.png|300]]')
  })

  it('width 가 null 이면 붙이지 않는다', () => {
    expect(imageBlockToEmbed({ id: 'abc123', ext: 'png', width: null })).toBe('![[abc123.png]]')
  })

  it('ext 가 그대로 확장자로 들어간다', () => {
    expect(imageBlockToEmbed({ id: 'xyz', ext: 'webp', width: null })).toBe('![[xyz.webp]]')
  })
})

import { describe, it, expect } from 'vitest'
import {
  buildImageBlock,
  parseImageBlock,
  extractAttachmentRefs,
  setImageBlockAttrs,
  imageAlignChange,
  imageWidthChange,
  imageBlockDeleteRange,
} from './imageBlock'

const ID = '0f3a9c2e7b1d4a58'

describe('buildImageBlock', () => {
  it('명세 2.1 의 3줄 형식을 만든다', () => {
    const text = buildImageBlock({ id: ID, ext: 'png', alt: '다이어그램', width: 480 })
    expect(text).toBe(
      ['<div align="center">', `  <img src="attachments/${ID}.png" alt="다이어그램" width="480">`, '</div>'].join(
        '\n',
      ),
    )
  })

  it('alt 의 & " < > 를 이스케이프한다', () => {
    const text = buildImageBlock({ id: ID, ext: 'png', alt: 'A & "B" <C>', width: 10 })
    expect(text).toContain('alt="A &amp; &quot;B&quot; &lt;C&gt;"')
  })

  it('alt 줄바꿈은 공백으로 바꾸고 100자에서 자른다', () => {
    const long = 'a'.repeat(120)
    const text = buildImageBlock({ id: ID, ext: 'png', alt: `한\n줄\r\n바꿈 ${long}`, width: 10 })
    const altMatch = /alt="([^"]*)"/.exec(text)!
    expect(altMatch[1].startsWith('한 줄 바꿈 ')).toBe(true)
    expect(altMatch[1].length).toBe(100)
  })

  it('align 을 지정할 수 있다. 기본은 center', () => {
    expect(buildImageBlock({ id: ID, ext: 'jpg', alt: 'x', width: 1 })).toContain('align="center"')
    expect(buildImageBlock({ id: ID, ext: 'jpg', alt: 'x', width: 1, align: 'left' })).toContain('align="left"')
  })
})

describe('parseImageBlock — buildImageBlock 왕복', () => {
  it('만들기→해석 왕복이 원래 값과 같다', () => {
    const built = buildImageBlock({ id: ID, ext: 'webp', alt: 'A & "B" <C>', width: 480, align: 'right' })
    const parsed = parseImageBlock(built)
    expect(parsed).toEqual({ align: 'right', id: ID, ext: 'webp', src: `attachments/${ID}.webp`, alt: 'A & "B" <C>', width: 480 })
  })

  it('속성 순서가 달라도 해석된다', () => {
    const text = [
      '<div align="left">',
      `  <img width="20" alt="x" src="attachments/${ID}.gif">`,
      '</div>',
    ].join('\n')
    expect(parseImageBlock(text)).toEqual({ align: 'left', id: ID, ext: 'gif', src: `attachments/${ID}.gif`, alt: 'x', width: 20 })
  })

  it('alt 없이도 해석된다(빈 문자열)', () => {
    const text = ['<div align="center">', `  <img src="attachments/${ID}.png">`, '</div>'].join('\n')
    expect(parseImageBlock(text)).toEqual({ align: 'center', id: ID, ext: 'png', src: `attachments/${ID}.png`, alt: '', width: null })
  })

  it('self-closing(<img … />)도 해석된다', () => {
    const text = ['<div align="center">', `  <img src="attachments/${ID}.png" />`, '</div>'].join('\n')
    expect(parseImageBlock(text)?.id).toBe(ID)
  })
})

describe('parseImageBlock — 아니면 null', () => {
  it('외부 src 는 null', () => {
    const text = ['<div align="center">', '  <img src="https://example.com/a.png">', '</div>'].join('\n')
    expect(parseImageBlock(text)).toBeNull()
  })

  it('허용하지 않는 align 값은 null', () => {
    const text = ['<div align="top">', `  <img src="attachments/${ID}.png">`, '</div>'].join('\n')
    expect(parseImageBlock(text)).toBeNull()
  })

  it('허용하지 않는 속성이 추가되면 null', () => {
    const text = [
      '<div align="center">',
      `  <img src="attachments/${ID}.png" title="x">`,
      '</div>',
    ].join('\n')
    expect(parseImageBlock(text)).toBeNull()
  })

  it('div 에 다른 속성이 추가되면 null', () => {
    const text = [
      '<div align="center" class="x">',
      `  <img src="attachments/${ID}.png">`,
      '</div>',
    ].join('\n')
    expect(parseImageBlock(text)).toBeNull()
  })

  it('4줄이면 null', () => {
    const text = ['<div align="center">', `  <img src="attachments/${ID}.png">`, '', '</div>'].join('\n')
    expect(parseImageBlock(text)).toBeNull()
  })

  it('2줄이면 null', () => {
    const text = ['<div align="center">', '</div>'].join('\n')
    expect(parseImageBlock(text)).toBeNull()
  })

  it('src 가 없으면 null', () => {
    const text = ['<div align="center">', '  <img alt="x">', '</div>'].join('\n')
    expect(parseImageBlock(text)).toBeNull()
  })

  it('width 가 숫자가 아니면 null', () => {
    const text = ['<div align="center">', `  <img src="attachments/${ID}.png" width="abc">`, '</div>'].join('\n')
    expect(parseImageBlock(text)).toBeNull()
  })

  it('같은 속성이 두 번 있으면 null', () => {
    const text = [
      '<div align="center">',
      `  <img src="attachments/${ID}.png" alt="a" alt="b">`,
      '</div>',
    ].join('\n')
    expect(parseImageBlock(text)).toBeNull()
  })

  it('문자열이 아니면 null', () => {
    expect(parseImageBlock(null)).toBeNull()
    expect(parseImageBlock(undefined)).toBeNull()
  })
})

describe('extractAttachmentRefs', () => {
  it('본문 안 모든 attachments 참조 id 집합을 돌려준다', () => {
    const content = `앞 글자\nattachments/${ID}.png 그리고 attachments/aaaaaaaaaaaaaaaa.gif\n뒤 글자`
    const ids = extractAttachmentRefs(content)
    expect(ids).toEqual(new Set([ID, 'aaaaaaaaaaaaaaaa']))
  })

  it('블록 형식이 깨져도(태그가 없어도) 문자열만 있으면 잡는다', () => {
    const content = `그냥 글자 attachments/${ID}.jpg 섞인 글`
    expect(extractAttachmentRefs(content)).toEqual(new Set([ID]))
  })

  it('없으면 빈 집합', () => {
    expect(extractAttachmentRefs('그냥 문서')).toEqual(new Set())
  })

  it('문자열이 아니면 빈 집합', () => {
    expect(extractAttachmentRefs(null)).toEqual(new Set())
  })
})

describe('setImageBlockAttrs', () => {
  it('align·width·alt 를 바꾼 새 원문을 만든다', () => {
    const built = buildImageBlock({ id: ID, ext: 'png', alt: '원래', width: 100, align: 'center' })
    const changed = setImageBlockAttrs(built, { align: 'left', width: 200 })
    expect(parseImageBlock(changed)).toEqual({ align: 'left', id: ID, ext: 'png', src: `attachments/${ID}.png`, alt: '원래', width: 200 })
  })

  it('해석할 수 없는 원문이면 null', () => {
    expect(setImageBlockAttrs('그냥 글자', { width: 10 })).toBeNull()
  })
})

describe('imageAlignChange — align 값 글자만 바꾸는 변경 계산 (F-157 2.3)', () => {
  it('바뀌는 범위가 align 값 글자뿐이다', () => {
    const built = buildImageBlock({ id: ID, ext: 'png', alt: 'x', width: 100, align: 'center' })
    const change = imageAlignChange(built, 1000, 'left')!
    expect(change).not.toBeNull()
    expect(built.slice(change.from - 1000, change.to - 1000)).toBe('center')
    expect(change.insert).toBe('left')

    const applied = built.slice(0, change.from - 1000) + change.insert + built.slice(change.to - 1000)
    expect(parseImageBlock(applied)).toEqual({ align: 'left', id: ID, ext: 'png', src: `attachments/${ID}.png`, alt: 'x', width: 100 })
  })

  it('값이 이미 같으면 null', () => {
    const built = buildImageBlock({ id: ID, ext: 'png', alt: 'x', width: 100, align: 'right' })
    expect(imageAlignChange(built, 0, 'right')).toBeNull()
  })

  it('해석할 수 없는 원문이면 null', () => {
    expect(imageAlignChange('그냥 글자', 0, 'left')).toBeNull()
  })
})

describe('imageWidthChange — width 값 글자만 바꾸는 변경 계산 (F-157 2.4)', () => {
  it('width 속성이 있으면 그 값 글자만 바뀐다', () => {
    const built = buildImageBlock({ id: ID, ext: 'png', alt: 'x', width: 100, align: 'center' })
    const change = imageWidthChange(built, 50, 250)!
    expect(change).not.toBeNull()
    expect(built.slice(change.from - 50, change.to - 50)).toBe('100')
    expect(change.insert).toBe('250')

    const applied = built.slice(0, change.from - 50) + change.insert + built.slice(change.to - 50)
    expect(parseImageBlock(applied)!.width).toBe(250)
  })

  it('width 속성이 없으면 alt 뒤에 추가한다', () => {
    const text = ['<div align="center">', `  <img src="attachments/${ID}.png" alt="설명">`, '</div>'].join('\n')
    const change = imageWidthChange(text, 0, 300)!
    expect(change.from).toBe(change.to) // 삽입(범위 없음)
    expect(change.insert).toBe(' width="300"')
    const applied = text.slice(0, change.from) + change.insert + text.slice(change.to)
    expect(parseImageBlock(applied)).toEqual({ align: 'center', id: ID, ext: 'png', src: `attachments/${ID}.png`, alt: '설명', width: 300 })
  })

  it('width·alt 속성이 모두 없으면 src 뒤에 추가한다', () => {
    const text = ['<div align="center">', `  <img src="attachments/${ID}.png">`, '</div>'].join('\n')
    const change = imageWidthChange(text, 0, 300)!
    expect(change.insert).toBe(' width="300"')
    const applied = text.slice(0, change.from) + change.insert + text.slice(change.to)
    expect(parseImageBlock(applied)).toEqual({ align: 'center', id: ID, ext: 'png', src: `attachments/${ID}.png`, alt: '', width: 300 })
  })

  it('값이 이미 같으면 null', () => {
    const built = buildImageBlock({ id: ID, ext: 'png', alt: 'x', width: 250, align: 'center' })
    expect(imageWidthChange(built, 0, 250)).toBeNull()
  })

  it('해석할 수 없는 원문이면 null', () => {
    expect(imageWidthChange('그냥 글자', 0, 100)).toBeNull()
  })
})

describe('imageBlockDeleteRange — 블록 삭제 범위 계산 (F-218 2.2)', () => {
  it('가운데 블록 — 뒤 줄바꿈 1개까지 포함', () => {
    const block = buildImageBlock({ id: ID, ext: 'png', alt: 'x', width: 100 })
    const full = `위\n\n${block}\n\n아래`
    const blockFrom = full.indexOf(block)
    const blockTo = blockFrom + block.length
    const range = imageBlockDeleteRange(full, blockFrom, blockTo)
    expect(range).toEqual({ from: blockFrom, to: blockTo + 1 })
    expect(full.slice(0, range.from) + full.slice(range.to)).toBe('위\n\n\n아래')
  })

  it('문서 끝 블록 — 뒤 줄바꿈이 없으면 앞 줄바꿈 1개까지 포함', () => {
    const block = buildImageBlock({ id: ID, ext: 'png', alt: 'x', width: 100 })
    const full = `위\n\n${block}`
    const blockFrom = full.indexOf(block)
    const blockTo = full.length
    const range = imageBlockDeleteRange(full, blockFrom, blockTo)
    expect(range).toEqual({ from: blockFrom - 1, to: blockTo })
    expect(full.slice(0, range.from) + full.slice(range.to)).toBe('위\n')
  })

  it('문서 전체가 블록 — 앞뒤 줄바꿈 없이 블록만', () => {
    const block = buildImageBlock({ id: ID, ext: 'png', alt: 'x', width: 100 })
    const range = imageBlockDeleteRange(block, 0, block.length)
    expect(range).toEqual({ from: 0, to: block.length })
  })

  it('CRLF — \\r\\n 을 줄바꿈 1개로 본다', () => {
    const block = buildImageBlock({ id: ID, ext: 'png', alt: 'x', width: 100 }).replace(/\n/g, '\r\n')
    const full = `위\r\n\r\n${block}\r\n\r\n아래`
    const blockFrom = full.indexOf(block)
    const blockTo = blockFrom + block.length
    const range = imageBlockDeleteRange(full, blockFrom, blockTo)
    expect(range).toEqual({ from: blockFrom, to: blockTo + 2 })
    expect(full.slice(0, range.from) + full.slice(range.to)).toBe('위\r\n\r\n\r\n아래')
  })
})

describe('width 선택 (F-2019.md 5.4 U4)', () => {
  it('width 를 안 주면 width 속성이 없다', () => {
    const text = buildImageBlock({ id: ID, ext: 'png', alt: 'x' })
    expect(text).not.toContain('width=')
    expect(text).toBe(['<div align="center">', `  <img src="attachments/${ID}.png" alt="x">`, '</div>'].join('\n'))
  })

  it('width 가 null 이어도 width 속성이 없다', () => {
    const text = buildImageBlock({ id: ID, ext: 'png', alt: 'x', width: null })
    expect(text).not.toContain('width=')
  })

  it('되읽으면 width: null', () => {
    const text = buildImageBlock({ id: ID, ext: 'png', alt: 'x' })
    expect(parseImageBlock(text)?.width).toBeNull()
  })

  it('width 없는 블록에 align 만 바꿔도 width 속성이 여전히 없다', () => {
    const built = buildImageBlock({ id: ID, ext: 'png', alt: 'x' })
    const changed = setImageBlockAttrs(built, { align: 'right' })
    expect(changed).not.toBeNull()
    expect(changed).not.toContain('width=')
    expect(parseImageBlock(changed!)?.align).toBe('right')
  })
})

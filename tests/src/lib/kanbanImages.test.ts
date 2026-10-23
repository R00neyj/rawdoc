import { describe, expect, it } from 'vitest'
import { cardImageView, takeCardImages } from '../../../src/lib/kanbanImages'

const A = 'attachments/0123456789abcdef.webp'
const B = 'attachments/fedcba9876543210.png'

describe('takeCardImages', () => {
  it('글자 뒤 첨부 이미지를 빼고 썸네일 목록으로', () => {
    expect(takeCardImages(`시안 검토 ![](${A})`)).toEqual({ text: '시안 검토', images: [{ id: '0123456789abcdef', alt: '' }] })
  })

  it('여러 장·정렬·폭 조각은 alt 에서 뗀다', () => {
    expect(takeCardImages(`![로고|center|300](${A}) 비교 ![시안](${B})`)).toEqual({
      text: '비교',
      images: [
        { id: '0123456789abcdef', alt: '로고' },
        { id: 'fedcba9876543210', alt: '시안' },
      ],
    })
  })

  it('이미지만 있는 줄은 빈 글자', () => {
    expect(takeCardImages(`![](${A})`)).toEqual({ text: '', images: [{ id: '0123456789abcdef', alt: '' }] })
  })

  it('바깥 주소 이미지는 글자에 그대로 둔다', () => {
    const text = '참고 ![x](https://example.com/a.png)'
    expect(takeCardImages(text)).toEqual({ text, images: [] })
  })

  it('코드 조각 안 이미지 문법은 건드리지 않는다', () => {
    const text = `문법 \`![](${A})\``
    expect(takeCardImages(text)).toEqual({ text, images: [] })
  })

  it('이미지가 없으면 원문 그대로', () => {
    expect(takeCardImages('  할 일  ')).toEqual({ text: '  할 일  ', images: [] })
  })
})

describe('cardImageView', () => {
  it('첫 줄·하위 줄 이미지를 순서대로 모으고 이미지만 있던 줄은 뺀다(체크 줄은 남김)', () => {
    const lines = [
      { kind: 'bullet', text: `색 확인 ![](${B})` },
      { kind: 'text', text: `![](${A})` },
      { kind: 'check', text: `![](${B})` },
      { kind: 'bullet', text: '그대로' },
    ]
    const view = cardImageView(`시안 ![](${A})`, lines)
    expect(view.text).toBe('시안')
    expect(view.images.map((i) => i.id)).toEqual(['0123456789abcdef', 'fedcba9876543210', '0123456789abcdef', 'fedcba9876543210'])
    expect(view.lines).toEqual([
      { kind: 'bullet', text: '색 확인' },
      { kind: 'check', text: '' },
      lines[3],
    ])
  })
})

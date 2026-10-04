import { describe, expect, it, vi } from 'vitest'
import {
  buildImageLine,
  imageLineAlignChange,
  imageLineTarget,
  imageLineWidthChange,
  parseImageLine,
} from '../../../src/lib/imageMarkdown'
import type { CodeMirrorChange } from '../../../src/lib/imageBlock'

const ID = '0f3a9c2e7b1d4a58'
const U = `attachments/${ID}.png`
const line = (alt: string, url = U) => `![${alt}](${url})`

function apply(text: string, from: number, c: CodeMirrorChange | null): string {
  if (!c) throw new Error('null change')
  const o = c.from - from
  return text.slice(0, o) + c.insert + text.slice(c.to - from)
}

describe('F-2127 A1 parseImageLine', () => {
  const rows: [string, string, string, number | null][] = [
    ['그림|300', '그림', 'left', 300],
    ['그림|center|300', '그림', 'center', 300],
    ['|center', '', 'center', null],
    ['a|b|c', 'a|b|c', 'left', null],
    ['300', '300', 'left', null],
    ['center', 'center', 'left', null],
    ['가격|100', '가격', 'left', 100],
    ['a|300|center', 'a|300', 'center', null],
    ['그림 | center | 300x200', '그림 ', 'center', 300],
  ]
  it.each(rows)('alt %s', (raw, alt, align, width) => {
    const p = parseImageLine(line(raw))
    expect(p).toMatchObject({ alt, align, width, url: U })
  })

  it('앞뒤 공백은 떼고 제목은 허용', () => {
    expect(parseImageLine(`  ${line('a')}\t`)?.alt).toBe('a')
    expect(parseImageLine(`![a](${U} "제목")`)?.url).toBe(U)
    expect(parseImageLine(`![a](<my pic.png>)`)?.url).toBe('my pic.png')
  })

  it('맞지 않으면 null', () => {
    expect(parseImageLine(`${line('a')}\n글`)).toBeNull()
    expect(parseImageLine(`![a[b]](${U})`)).toBeNull()
    expect(parseImageLine('![a]()')).toBeNull()
    expect(parseImageLine(`![a](${U} "제목)`)).toBeNull()
    expect(parseImageLine(`글 ${line('a')}`)).toBeNull()
  })

  it('만들기 → 해석 왕복', () => {
    for (const alt of ['이미지', 'a|b\\[c]\nd', 'x'.repeat(101), '']) {
      for (const align of ['left', 'center', 'right'] as const) {
        for (const width of [null, 200]) {
          const built = buildImageLine({ id: ID, ext: 'png', alt, width, align })
          const p = parseImageLine(built)!
          expect(p.align).toBe(align)
          expect(p.width).toBe(width)
          expect(p.url).toBe(U)
          expect(p.alt).toBe(
            alt
              .replace(/\n/g, ' ')
              .replace(/[\\[\]|]/g, ' ')
              .replace(/ +/g, ' ')
              .trim()
              .slice(0, 100)
              .trim(),
          )
        }
      }
    }
  })

  it('buildImageLine 모양', () => {
    expect(buildImageLine({ id: ID, ext: 'png', alt: '이미지', width: 200, align: 'center' })).toBe(
      `![이미지|center|200](${U})`,
    )
    expect(buildImageLine({ id: ID, ext: 'png', alt: 'a', width: 0.2 })).toBe(`![a|1](${U})`)
  })
})

describe('F-2127 A2 imageLineTarget', () => {
  const p = (url: string) => ({ alt: '', align: 'left' as const, width: null, url })
  it('첨부 형식', () => {
    expect(imageLineTarget(p(U))).toEqual({ id: ID, ext: 'png' })
  })
  it('스킴·// 는 resolver 를 부르지 않고 null', () => {
    const r = vi.fn(() => ({ id: ID, ext: 'png' as const }))
    for (const url of ['https://example.com/a.png', '//x/a.png', 'data:image/png;base64,AA']) {
      expect(imageLineTarget(p(url), r)).toBeNull()
    }
    expect(r).not.toHaveBeenCalled()
  })
  it('상대 경로는 resolver 가 있을 때만', () => {
    expect(imageLineTarget(p('./img/a.png'))).toBeNull()
    const t = { id: ID, ext: 'jpg' as const }
    expect(imageLineTarget(p('./img/a.png'), () => t)).toBe(t)
  })
  it('리졸버의 저장소 갈래 { repoPath, src } 를 그대로 돌려준다 (F-2131 A1)', () => {
    const t = { repoPath: 'docs/img/b.svg', src: '/api/docs/d1/github/img?path=docs%2Fimg%2Fb.svg' }
    expect(imageLineTarget(p('img/b.svg'), () => t)).toBe(t)
  })
})

describe('F-2127 A3 조각 고치기', () => {
  const FROM = 100
  const al = (t: string, a: 'left' | 'center' | 'right') => apply(t, FROM, imageLineAlignChange(t, FROM, a))
  const wd = (t: string, w: number) => apply(t, FROM, imageLineWidthChange(t, FROM, w))

  it('정렬', () => {
    expect(al(line('a|center|200'), 'right')).toBe(line('a|right|200'))
    expect(al(line('a|center|200'), 'left')).toBe(line('a|200'))
    expect(al(line('a|center'), 'left')).toBe(line('a'))
    expect(al(line('a|200'), 'center')).toBe(line('a|center|200'))
    expect(al(line(''), 'center')).toBe(line('|center'))
    expect(al(`  ![a | center](${U})`, 'right')).toBe(`  ![a |right](${U})`)
  })
  it('너비', () => {
    expect(wd(line('a|center|200'), 210)).toBe(line('a|center|210'))
    expect(wd(line('a|300x200'), 50)).toBe(line('a|50'))
    expect(wd(line('a|center'), 50)).toBe(line('a|center|50'))
    expect(wd(line('a'), 50)).toBe(line('a|50'))
  })
  it('같은 값·해석 실패는 null', () => {
    expect(imageLineAlignChange(line('a'), FROM, 'left')).toBeNull()
    expect(imageLineAlignChange(line('a|center'), FROM, 'center')).toBeNull()
    expect(imageLineWidthChange(line('a|200'), FROM, 200)).toBeNull()
    expect(imageLineWidthChange('글', FROM, 200)).toBeNull()
    expect(imageLineAlignChange('글', FROM, 'center')).toBeNull()
  })
  it('바뀐 범위 밖 불변: 제목 보존', () => {
    expect(wd(`![a](${U} "제목")`, 5)).toBe(`![a|5](${U} "제목")`)
  })
})

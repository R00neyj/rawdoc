// Notion 내보내기 zip 정리 — 이름의 32자리 id 떼기, 본문 링크 고쳐 쓰기 (small 2026-10-16)
import { describe, expect, it } from 'vitest'
import { isNotionExport, normalizeNotionEntries, rewriteNotionMarkdown } from '../../../src/app/importNotion'

const ID = '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d'
const ID2 = 'ffffffffffffffffffffffffffffffff'
const enc = (s: string) => new TextEncoder().encode(s)
const dec = (b: Uint8Array | null) => new TextDecoder().decode(b ?? new Uint8Array())

describe('isNotionExport', () => {
  it('md 경로에 " {32자리 id}" 조각이 있으면 Notion', () => {
    expect(isNotionExport([`Export/회의록 ${ID}.md`])).toBe(true)
    expect(isNotionExport([`회의록 ${ID}/그림.png`, '메모.md'])).toBe(true)
  })
  it('옵시디언 볼트 같은 평범한 zip 은 아니다', () => {
    expect(isNotionExport(['vault/회의록.md', 'vault/attachments/a.png'])).toBe(false)
  })
})

describe('normalizeNotionEntries', () => {
  it('폴더·파일 이름의 id 를 떼고, 같은 자리에서 겹치면 " 2" 를 붙인다', () => {
    const out = normalizeNotionEntries([
      { name: `회의록 ${ID}.md`, bytes: enc('a') },
      { name: `회의록 ${ID2}.md`, bytes: enc('b') },
      { name: `회의록 ${ID}/그림.png`, bytes: enc('img') },
      { name: `${ID2}.md`, bytes: enc('c') },
    ])
    expect(out.map((e) => e.name)).toEqual(['회의록.md', '회의록 2.md', '회의록/그림.png', 'Untitled.md'])
  })

  it('본문 하위 페이지 링크는 위키링크로, 이미지 경로는 id 뗀 경로로 바꾼다', () => {
    const body = `# 회의록\n\n[안건](%ED%9A%8C%EC%9D%98%EB%A1%9D%20${ID}/%EC%95%88%EA%B1%B4%20${ID2}.md)\n\n![그림](%ED%9A%8C%EC%9D%98%EB%A1%9D%20${ID}/%EA%B7%B8%EB%A6%BC.png)\n`
    const out = normalizeNotionEntries([
      { name: `회의록 ${ID}.md`, bytes: enc(body) },
      { name: `회의록 ${ID}/안건 ${ID2}.md`, bytes: enc('# 안건\n') },
      { name: `회의록 ${ID}/그림.png`, bytes: enc('img') },
    ])
    expect(dec(out[0].bytes)).toBe('[[안건]]\n\n![그림](%ED%9A%8C%EC%9D%98%EB%A1%9D/%EA%B7%B8%EB%A6%BC.png)\n')
    expect(dec(out[1].bytes)).toBe('')
  })

  it('겹쳐서 이름이 바뀐 문서로 가는 링크는 바뀐 이름을 따른다', () => {
    const out = normalizeNotionEntries([
      { name: `메모 ${ID}.md`, bytes: enc('x') },
      { name: `메모 ${ID2}.md`, bytes: enc('x') },
      { name: `목차 ${ID}.md`, bytes: enc(`[메모](%EB%A9%94%EB%AA%A8%20${ID2}.md)`) },
    ])
    expect(dec(out[2].bytes)).toBe('[[메모 2|메모]]')
  })
})

describe('rewriteNotionMarkdown', () => {
  const keep = (p: string) => p
  it('첫 줄 # 제목과 뒤 빈 줄을 뗀다', () => {
    expect(rewriteNotionMarkdown('# 제목\n\n본문\n', '', keep)).toBe('본문\n')
  })
  it('바깥 링크·코드 펜스 안·표 안은 규칙대로', () => {
    const map = (p: string) => p.replace(` ${ID}`, '')
    const src = [
      '[구글](https://google.com)',
      '```',
      `[x](a%20${ID}.md)`,
      '```',
      `| [가](a%20${ID}.md) |`,
    ].join('\n')
    expect(rewriteNotionMarkdown(src, '', map)).toBe(['[구글](https://google.com)', '```', `[x](a%20${ID}.md)`, '```', '| [[a\\|가]] |'].join('\n'))
  })
})

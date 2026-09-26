// F-2020.md 5.3·11.1 U4 — 이미지 블록 → 옵시디언 임베드
import { describe, it, expect } from 'vitest'
import { imageBlockToEmbed, findVaultEmbeds, embedsToImageBlocks, listImageBlocks, type VaultEmbed, type EmbedBlock } from './obsidianImage'
import { buildImageBlock, parseImageBlock } from './imageBlock'

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

describe('findVaultEmbeds (F-2019.md 5.1 U1)', () => {
  it('![[그림.png]] — target 만', () => {
    const [e] = findVaultEmbeds('![[그림.png]]\n')
    expect(e).toMatchObject({ syntax: 'wiki', target: '그림.png', caption: null, width: null, kind: 'image' })
  })

  it('![[그림.png|300]], ![[그림.png|300x200]] — width 300 (높이는 버림)', () => {
    const [a] = findVaultEmbeds('![[그림.png|300]]\n')
    expect(a).toMatchObject({ target: '그림.png', caption: null, width: 300 })
    const [b] = findVaultEmbeds('![[그림.png|300x200]]\n')
    expect(b).toMatchObject({ target: '그림.png', caption: null, width: 300 })
  })

  it('![[그림.png|설명]] — caption 설명', () => {
    const [e] = findVaultEmbeds('![[그림.png|설명]]\n')
    expect(e).toMatchObject({ caption: '설명', width: null })
  })

  it('![[그림.png|설명|300]] — caption 설명, width 300', () => {
    const [e] = findVaultEmbeds('![[그림.png|설명|300]]\n')
    expect(e).toMatchObject({ caption: '설명', width: 300 })
  })

  it('![설명](그림.png), ![설명](그림.png "제목") — caption 설명, 제목은 버림', () => {
    const [a] = findVaultEmbeds('![설명](그림.png)\n')
    expect(a).toMatchObject({ syntax: 'markdown', target: '그림.png', caption: '설명' })
    const [b] = findVaultEmbeds('![설명](그림.png "제목")\n')
    expect(b).toMatchObject({ syntax: 'markdown', target: '그림.png', caption: '설명' })
  })

  it('![](<그림 1.png>) — <> 를 벗긴다', () => {
    const [e] = findVaultEmbeds('![](<그림 1.png>)\n')
    expect(e).toMatchObject({ target: '그림 1.png', caption: null })
  })

  it('![](a%20b.png) — %XX 를 decodeURIComponent 로 푼다', () => {
    const [e] = findVaultEmbeds('![](a%20b.png)\n')
    expect(e).toMatchObject({ target: 'a b.png' })
  })

  it('폭이 0 이나 10000 이상이면 크기 없음(글자는 버린다)', () => {
    const [a] = findVaultEmbeds('![[그림.png|0]]\n')
    expect(a).toMatchObject({ width: null, caption: null })
    const [b] = findVaultEmbeds('![[그림.png|10000]]\n')
    expect(b).toMatchObject({ width: null, caption: null })
  })

  it('https:·data:·// 로 시작하는 markdown 임베드는 결과에 넣지 않는다', () => {
    expect(findVaultEmbeds('![x](https://a.com/b.png)\n')).toHaveLength(0)
    expect(findVaultEmbeds('![x](data:image/png;base64,AAA)\n')).toHaveLength(0)
    expect(findVaultEmbeds('![x](//a.com/b.png)\n')).toHaveLength(0)
  })

  it('kind — ![[노트]]·![[x.pdf]] 는 other, .JPEG·.svg 는 image', () => {
    expect(findVaultEmbeds('![[노트]]\n')[0]).toMatchObject({ kind: 'other' })
    expect(findVaultEmbeds('![[x.pdf]]\n')[0]).toMatchObject({ kind: 'other' })
    expect(findVaultEmbeds('![[a.JPEG]]\n')[0]).toMatchObject({ kind: 'image' })
    expect(findVaultEmbeds('![[a.svg]]\n')[0]).toMatchObject({ kind: 'image' })
  })

  it('프론트매터 안은 보지 않는다', () => {
    const text = '---\ntitle: ![[그림.png]]\n---\n\n본문\n'
    expect(findVaultEmbeds(text)).toHaveLength(0)
  })

  it('펜스 코드블록 안(닫히지 않은 펜스 포함)은 보지 않는다', () => {
    expect(findVaultEmbeds('```\n![[그림.png]]\n```\n')).toHaveLength(0)
    expect(findVaultEmbeds('```\n![[그림.png]]\n')).toHaveLength(0) // 안 닫힘 — 문서 끝까지
  })

  it('인라인 코드 안은 보지 않는다', () => {
    expect(findVaultEmbeds('본문 `![[그림.png]]` 계속\n')).toHaveLength(0)
  })

  it('standalone — 줄 앞 공백·> ·목록 기호·글 사이·한 줄 둘은 거짓, 뒤 공백만은 참', () => {
    expect(findVaultEmbeds(' ![[그림.png]]\n')[0].standalone).toBe(false)
    expect(findVaultEmbeds('> ![[그림.png]]\n')[0].standalone).toBe(false)
    expect(findVaultEmbeds('- ![[그림.png]]\n')[0].standalone).toBe(false)
    expect(findVaultEmbeds('글 가운데 ![[그림.png]] 입니다\n')[0].standalone).toBe(false)
    expect(findVaultEmbeds('![[a.png]] ![[b.png]]\n').every((e) => e.standalone === false)).toBe(true)
    expect(findVaultEmbeds('![[그림.png]]  \n')[0].standalone).toBe(true)
    expect(findVaultEmbeds('![[그림.png]]\n')[0].standalone).toBe(true)
  })
})

describe('embedsToImageBlocks (F-2019.md 5.3 U2)', () => {
  function embedAt(markdown: string): VaultEmbed {
    return findVaultEmbeds(markdown)[0]
  }
  const BLOCK: EmbedBlock = { id: '0f3a9c2e7b1d4a58', ext: 'png', alt: '그림', width: null, align: 'left' }

  it('바꾼 줄이 parseImageBlock 으로 읽히는 3줄, width 없으면 속성 없음', () => {
    const md = '![[그림.png]]\n'
    const embed = embedAt(md)
    const result = embedsToImageBlocks(md, new Map([[embed, BLOCK]]))
    const lines = result.split('\n')
    const parsed = parseImageBlock(lines.slice(0, 3).join('\n'))
    expect(parsed).toMatchObject({ id: BLOCK.id, ext: 'png', align: 'left', width: null })
    expect(lines[1]).not.toContain('width=')
  })

  it('위 글이 있으면 빈 줄을 넣는다', () => {
    const md = '위 글\n![[그림.png]]\n'
    const embed = embedAt(md)
    const result = embedsToImageBlocks(md, new Map([[embed, BLOCK]]))
    expect(result.split('\n')[0]).toBe('위 글')
    expect(result.split('\n')[1]).toBe('')
  })

  it('아래 글이 있으면 빈 줄을 넣는다', () => {
    const md = '![[그림.png]]\n아래 글\n'
    const embed = embedAt(md)
    const result = embedsToImageBlocks(md, new Map([[embed, BLOCK]]))
    const lines = result.split('\n')
    expect(lines[3]).toBe('')
    expect(lines[4]).toBe('아래 글')
  })

  it('이웃한 두 임베드를 바꾸면 사이에 빈 줄 하나만', () => {
    const md = '![[a.png]]\n![[b.png]]\n'
    const embeds = findVaultEmbeds(md)
    const map = new Map<VaultEmbed, EmbedBlock>([
      [embeds[0], { ...BLOCK, id: '0000000000000001' }],
      [embeds[1], { ...BLOCK, id: '0000000000000002' }],
    ])
    const result = embedsToImageBlocks(md, map)
    const lines = result.split('\n')
    // 첫 블록 3줄 + 빈 줄 1개 + 둘째 블록 3줄 + 원문 끝 '\n' 이 남긴 빈 줄
    expect(lines).toHaveLength(8)
    expect(lines[3]).toBe('')
  })

  it('이미 앞뒤가 빈 줄이면 더 넣지 않는다', () => {
    const md = '위\n\n![[그림.png]]\n\n아래\n'
    const embed = embedAt(md)
    const result = embedsToImageBlocks(md, new Map([[embed, BLOCK]]))
    // 위, '', 블록3줄, '', 아래, 원문 끝 '\n' 이 남긴 빈 줄
    expect(result.split('\n')).toHaveLength(8)
  })

  it('문서 첫 줄·끝 줄이면 그 쪽에는 빈 줄을 넣지 않는다', () => {
    const md = '![[그림.png]]' // 끝에 줄바꿈 없음 — 진짜 문서 끝
    const embed = embedAt(md)
    const result = embedsToImageBlocks(md, new Map([[embed, BLOCK]]))
    expect(result.split('\n')).toHaveLength(3)
  })

  it('바꾸지 않는 임베드와 나머지 글자는 그대로', () => {
    const md = '앞\n\n![[그대로.png]]\n\n뒤\n'
    const result = embedsToImageBlocks(md, new Map())
    expect(result).toBe(md)
  })
})

describe('listImageBlocks (F-2019.md 5.4 U3)', () => {
  it('블록 둘의 순서·값', () => {
    const b1 = buildImageBlock({ id: '0000000000000001', ext: 'png', alt: 'a', width: 10, align: 'left' })
    const b2 = buildImageBlock({ id: '0000000000000002', ext: 'jpg', alt: 'b', align: 'center' })
    const md = `${b1}\n\n글\n\n${b2}\n`
    const found = listImageBlocks(md)
    expect(found).toHaveLength(2)
    expect(found[0].block.id).toBe('0000000000000001')
    expect(found[1].block.id).toBe('0000000000000002')
    expect(found[0].line).toBe(0)
  })

  it('4줄짜리(바로 아래 글이 붙은 블록)는 안 잡는다', () => {
    const b1 = buildImageBlock({ id: '0000000000000001', ext: 'png', alt: 'a', width: 10 })
    const md = `${b1}\n바로 이어지는 글\n`
    expect(listImageBlocks(md)).toHaveLength(0)
  })

  it('들여쓴 <div 는 안 잡는다', () => {
    const b1 = buildImageBlock({ id: '0000000000000001', ext: 'png', alt: 'a', width: 10 })
    const indented = b1
      .split('\n')
      .map((l, i) => (i === 0 ? `  ${l}` : l))
      .join('\n')
    const md = `${indented}\n\n`
    expect(listImageBlocks(md)).toHaveLength(0)
  })
})

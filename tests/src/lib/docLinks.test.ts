import { describe, expect, it } from 'vitest'
import { findIncomingLinks, findOutgoingLinks, lineExcerpt, EXCERPT_MAX, MENTION_MIN_LENGTH } from '../../../src/lib/docLinks'
import { createWikiResolver, type WikiDocRef, type WikiFolderRef } from '../../../src/lib/wikiResolve'

type Src = { id: string; title: string; content: string; folderId: string | null; e2ee?: 'locked' | 'open' }

const folders: WikiFolderRef[] = [{ id: 'fa', name: 'A', parentId: null }]

function resolverOf(docs: Src[]) {
  const refs: WikiDocRef[] = docs.map((d) => ({ id: d.id, title: d.title, folderId: d.folderId }))
  return createWikiResolver(refs, folders)
}

const current = { id: 'cur', title: '회의', folderId: null }

describe('findIncomingLinks — 백링크', () => {
  it('이 문서를 [[ ]] 로 가리키는 문서와 그 줄을 돌려준다. [[문서#제목]] 도 세고 [[#제목]] 은 빼며 자기 자신은 뺀다', () => {
    const docs: Src[] = [
      { id: 'cur', title: '회의', content: '[[회의]] 자기 링크', folderId: null },
      { id: 's1', title: '일지', content: '첫 줄\n오늘 [[회의]] 를 했다\n끝', folderId: null },
      { id: 's2', title: '메모', content: '앞\n[[회의#안건]] 참고', folderId: null },
      { id: 's3', title: '목차', content: '[[#회의]] 만 있음', folderId: null },
    ]
    const result = findIncomingLinks({ current, sources: docs, resolver: resolverOf(docs) })
    expect(result.backlinks).toEqual([
      { id: 's1', title: '일지', excerpt: '오늘 [[회의]] 를 했다' },
      { id: 's2', title: '메모', excerpt: '[[회의#안건]] 참고' },
    ])
  })

  it('같은 제목이 둘이면 해석기의 폴더 우선순위를 따른다 — 폴더 A 의 [[회의]] 는 A 안의 회의를 가리킨다', () => {
    const docs: Src[] = [
      { id: 'cur', title: '회의', content: '', folderId: null },
      { id: 'aMeet', title: '회의', content: '', folderId: 'fa' },
      { id: 'inA', title: 'A 안 문서', content: '[[회의]]', folderId: 'fa' },
      { id: 'top', title: '위 문서', content: '[[회의]]', folderId: null },
    ]
    const result = findIncomingLinks({ current, sources: docs, resolver: resolverOf(docs) })
    expect(result.backlinks.map((r) => r.id)).toEqual(['top'])
  })

  it('펜스 코드·인라인 코드·프론트매터 안의 [[ ]] 는 링크가 아니다', () => {
    const docs: Src[] = [
      { id: 'cur', title: '회의', content: '', folderId: null },
      { id: 'c1', title: '코드', content: '```\n[[회의]]\n```\n`[[회의]]`', folderId: null },
      { id: 'c2', title: '앞머리', content: '---\nlink: "[[회의]]"\n---\n본문', folderId: null },
    ]
    const result = findIncomingLinks({ current, sources: docs, resolver: resolverOf(docs) })
    expect(result.backlinks).toEqual([])
  })

  it('잠긴 금고 문서는 읽지 않고 수만 센다. 본문을 못 읽은 문서(content 빈 문자열)는 조용히 뺀다', () => {
    const docs: Src[] = [
      { id: 'cur', title: '회의', content: '', folderId: null },
      { id: 'l1', title: '', content: '', folderId: null, e2ee: 'locked' },
      { id: 'l2', title: '', content: '', folderId: null, e2ee: 'locked' },
      { id: 'o1', title: '열린 금고', content: '[[회의]]', folderId: null, e2ee: 'open' },
      { id: 'sh', title: '공유받음', content: '', folderId: null },
    ]
    const result = findIncomingLinks({ current, sources: docs, resolver: resolverOf(docs) })
    expect(result.lockedCount).toBe(2)
    expect(result.backlinks.map((r) => r.id)).toEqual(['o1'])
  })
})

describe('findIncomingLinks — 연결되지 않은 언급', () => {
  it('제목이 [[ ]] 없이 글자로만 있는 줄을 돌려준다. 대소문자는 가리지 않는다', () => {
    const cur = { id: 'cur', title: 'Rust 메모', folderId: null }
    const docs: Src[] = [
      { id: 'cur', title: 'Rust 메모', content: 'Rust 메모 자기 언급', folderId: null },
      { id: 'm1', title: '하루', content: '어제\n오늘 rust 메모를 읽었다', folderId: null },
    ]
    const result = findIncomingLinks({ current: cur, sources: docs, resolver: resolverOf(docs) })
    expect(result.mentions).toEqual([{ id: 'm1', title: '하루', excerpt: '오늘 rust 메모를 읽었다' }])
  })

  it('위키링크 안·코드(펜스·인라인)·프론트매터 안의 제목은 언급이 아니다', () => {
    const docs: Src[] = [
      { id: 'cur', title: '회의', content: '', folderId: null },
      { id: 'w', title: '링크만', content: '[[회의]] 와 [[다른|회의]]', folderId: null },
      { id: 'c', title: '코드만', content: '```\n회의\n```\n`회의`', folderId: null },
      { id: 'f', title: '앞머리만', content: '---\ntags: [회의]\n---\n본문', folderId: null },
    ]
    const result = findIncomingLinks({ current, sources: docs, resolver: resolverOf(docs) })
    expect(result.mentions).toEqual([])
  })

  it('한 줄에 링크와 글자가 함께 있으면 글자 쪽은 언급이다. 백링크에도 함께 나온다', () => {
    const docs: Src[] = [
      { id: 'cur', title: '회의', content: '', folderId: null },
      { id: 'both', title: '둘 다', content: '[[회의]] 다음 회의는 금요일', folderId: null },
    ]
    const result = findIncomingLinks({ current, sources: docs, resolver: resolverOf(docs) })
    expect(result.backlinks.map((r) => r.id)).toEqual(['both'])
    expect(result.mentions).toEqual([{ id: 'both', title: '둘 다', excerpt: '[[회의]] 다음 회의는 금요일' }])
  })

  it('영문·숫자로 시작하거나 끝나는 제목은 낱말 경계에서만 찾는다 — art 는 start 에 걸리지 않는다', () => {
    const cur = { id: 'cur', title: 'art', folderId: null }
    const docs: Src[] = [
      { id: 'cur', title: 'art', content: '', folderId: null },
      { id: 'no', title: '아님', content: 'start smart', folderId: null },
      { id: 'yes', title: '맞음', content: 'pop art, 현대 미술', folderId: null },
    ]
    const result = findIncomingLinks({ current: cur, sources: docs, resolver: resolverOf(docs) })
    expect(result.mentions.map((r) => r.id)).toEqual(['yes'])
  })

  it(`제목이 ${MENTION_MIN_LENGTH}글자보다 짧거나 비어 있으면 언급을 찾지 않는다`, () => {
    const docs: Src[] = [
      { id: 'cur', title: '책', content: '', folderId: null },
      { id: 'm', title: '독서', content: '책 을 읽었다', folderId: null },
    ]
    expect(findIncomingLinks({ current: { id: 'cur', title: '책', folderId: null }, sources: docs, resolver: resolverOf(docs) }).mentions).toEqual([])
    expect(findIncomingLinks({ current: { id: 'cur', title: '  ', folderId: null }, sources: docs, resolver: resolverOf(docs) }).mentions).toEqual([])
  })
})

describe('findOutgoingLinks — 나가는 링크', () => {
  const docs: Src[] = [
    { id: 'cur', title: '회의', content: '', folderId: null },
    { id: 'plan', title: '계획', content: '', folderId: null },
  ]

  it('본문의 위키링크를 처음 나온 순서로, 같은 대상은 한 번만. 끊긴 링크는 docId null', () => {
    const text = '[[계획]] 과 [[없는 문서]]\n다시 [[계획#일정]] 그리고 [[없는 문서]]'
    expect(findOutgoingLinks({ text, current, resolver: resolverOf(docs) })).toEqual([
      { target: '계획', docId: 'plan', title: '계획' },
      { target: '없는 문서', docId: null, title: '없는 문서' },
    ])
  })

  it('[[#제목]]·자기 자신·코드 안 링크는 뺀다', () => {
    const text = '[[#위]] [[회의]]\n```\n[[계획]]\n```'
    expect(findOutgoingLinks({ text, current, resolver: resolverOf(docs) })).toEqual([])
  })

  it('끊긴 링크는 대소문자만 다른 것을 한 번으로 친다', () => {
    const text = '[[Draft]] [[draft]]'
    expect(findOutgoingLinks({ text, current, resolver: resolverOf(docs) })).toEqual([{ target: 'Draft', docId: null, title: 'Draft' }])
  })
})

describe('lineExcerpt — 줄 하나 발췌', () => {
  it('짧은 줄은 앞뒤 공백만 떼고 그대로', () => {
    const line = '   - 오늘 [[회의]] 했다  '
    const from = line.indexOf('[[')
    expect(lineExcerpt(line, from, from + 6)).toBe('- 오늘 [[회의]] 했다')
  })

  it(`길면 맞는 자리를 가운데 두고 ${EXCERPT_MAX}자로 자르고 잘린 쪽에 … 을 붙인다`, () => {
    const line = `${'가'.repeat(150)}[[회의]]${'나'.repeat(150)}`
    const from = 150
    const out = lineExcerpt(line, from, from + 6)
    expect(out.startsWith('…')).toBe(true)
    expect(out.endsWith('…')).toBe(true)
    expect(out).toContain('[[회의]]')
    expect([...out].length).toBe(EXCERPT_MAX + 2)
  })

  it('맞는 자리가 줄 앞이면 앞은 자르지 않는다', () => {
    const line = `[[회의]]${'나'.repeat(200)}`
    const out = lineExcerpt(line, 0, 6)
    expect(out.startsWith('[[회의]]')).toBe(true)
    expect(out.endsWith('…')).toBe(true)
  })

  it('서로게이트 쌍(이모지)을 반으로 자르지 않는다', () => {
    const line = `${'😀'.repeat(120)}회의${'😀'.repeat(120)}`
    const from = line.indexOf('회의')
    const out = lineExcerpt(line, from, from + 2)
    expect(out).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/)
    expect(out).toContain('회의')
  })
})

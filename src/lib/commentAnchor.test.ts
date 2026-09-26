import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import { createCommentAnchor, reanchor, resolveCommentAnchor, resolveCommentAnchors, restoreCommentEntries, toCommentRecord } from './commentAnchor'
import { readCommentAnchor } from './docComments'
import type { CommentAnchor, CommentEntry, CommentRecord } from './docComments'

function makeDoc(text: string) {
  const doc = new Y.Doc()
  const ytext = doc.getText('content')
  doc.transact(() => {
    ytext.insert(0, text)
  })
  return { doc, ytext }
}

function fakeEntry(overrides: Partial<CommentEntry> = {}): CommentEntry {
  return {
    v: 1,
    parent: null,
    anchor: null,
    quote: 'q',
    body: 'body',
    mentions: [],
    author: { id: 'u1', email: 'u1@example.com' },
    createdAt: 0,
    resolved: null,
    ...overrides,
  }
}

function baseRecord(overrides: Partial<CommentRecord> = {}): CommentRecord {
  return {
    id: 'root1',
    parent: null,
    body: 'hello',
    mentions: [],
    authorId: 'u1',
    authorEmail: 'u1@example.com',
    createdAt: 1000,
    resolvedAt: null,
    resolvedById: null,
    resolvedBy: null,
    quote: 'quoted',
    prefix: 'pre',
    suffix: 'suf',
    anchorFrom: 10,
    anchorLength: 6,
    ...overrides,
  }
}

// ----- A1~A9 앵커 -----

describe('F-501 A1 createCommentAnchor 모양과 되풀이', () => {
  it('assoc·tname·item·키·readCommentAnchor·Y.Map 왕복', () => {
    const { doc, ytext } = makeDoc('hello world foo')
    const ymap = doc.getMap('m')
    const anchor = createCommentAnchor(ytext, 6, 11)
    expect(anchor).not.toBeNull()
    const a = anchor as CommentAnchor
    expect(a.start.assoc).toBe(0)
    expect(a.end.assoc).toBe(-1)
    expect(a.start.tname).toBe('content')
    expect(a.end.tname).toBe('content')
    expect(a.start.item).toBeTruthy()
    expect(a.end.item).toBeTruthy()
    expect(Object.keys(a.start).sort()).toEqual(['assoc', 'item', 'tname'])
    expect(Object.keys(a.end).sort()).toEqual(['assoc', 'item', 'tname'])
    expect(readCommentAnchor(a)).toEqual(a)

    doc.transact(() => {
      ymap.set('a', a)
    })
    const update = Y.encodeStateAsUpdate(doc)
    const doc2 = new Y.Doc()
    Y.applyUpdate(doc2, update)
    const ytext2 = doc2.getText('content')
    const stored = doc2.getMap('m').get('a')
    expect(resolveCommentAnchor(ytext2, stored as CommentAnchor)).toEqual({ from: 6, to: 11 })
  })
})

describe('F-501 A2 편집 뒤 앵커 위치', () => {
  it('맨 앞 삽입 → 시작 바로 앞 → 끝 바로 뒤 → 가운데', () => {
    const { doc, ytext } = makeDoc('hello world foo')
    const anchor = createCommentAnchor(ytext, 6, 11) as CommentAnchor

    doc.transact(() => {
      ytext.insert(0, 'AAA\n')
    })
    expect(resolveCommentAnchor(ytext, anchor)).toEqual({ from: 10, to: 15 })

    doc.transact(() => {
      ytext.insert(10, 'X')
    })
    expect(resolveCommentAnchor(ytext, anchor)).toEqual({ from: 11, to: 16 })

    doc.transact(() => {
      ytext.insert(16, 'Y')
    })
    expect(resolveCommentAnchor(ytext, anchor)).toEqual({ from: 11, to: 16 })

    doc.transact(() => {
      ytext.insert(13, 'Z')
    })
    expect(resolveCommentAnchor(ytext, anchor)).toEqual({ from: 11, to: 17 })
  })
})

describe('F-501 A3 지우기', () => {
  it('앞쪽 일부 / 뒤쪽 일부 / 범위를 덮음', () => {
    {
      const { doc, ytext } = makeDoc('hello world foo')
      const anchor = createCommentAnchor(ytext, 6, 11) as CommentAnchor
      doc.transact(() => {
        ytext.delete(5, 3)
      })
      expect(resolveCommentAnchor(ytext, anchor)).toEqual({ from: 5, to: 8 })
    }
    {
      const { doc, ytext } = makeDoc('hello world foo')
      const anchor = createCommentAnchor(ytext, 6, 11) as CommentAnchor
      doc.transact(() => {
        ytext.delete(9, 3)
      })
      expect(resolveCommentAnchor(ytext, anchor)).toEqual({ from: 6, to: 9 })
    }
    {
      const { doc, ytext } = makeDoc('hello world foo')
      const anchor = createCommentAnchor(ytext, 6, 11) as CommentAnchor
      doc.transact(() => {
        ytext.delete(6, 5)
      })
      expect(resolveCommentAnchor(ytext, anchor)).toBeNull()
    }
  })
})

describe('F-501 A4 되돌리기로 앵커가 돌아온다', () => {
  it('추적 origin 트랜잭션 지우기 → undo → 원래 범위', () => {
    const { doc, ytext } = makeDoc('hello world foo')
    const anchor = createCommentAnchor(ytext, 6, 11) as CommentAnchor
    const origin = 'test-origin'
    const undoManager = new Y.UndoManager(ytext, { trackedOrigins: new Set([origin]) })
    doc.transact(() => {
      ytext.delete(6, 5)
    }, origin)
    expect(resolveCommentAnchor(ytext, anchor)).toBeNull()
    undoManager.undo()
    expect(resolveCommentAnchor(ytext, anchor)).toEqual({ from: 6, to: 11 })
  })
})

describe('F-501 A5 잘라 붙이기', () => {
  it('범위를 지우고 같은 글을 맨 앞에 다시 넣으면 고아', () => {
    const { doc, ytext } = makeDoc('hello world foo')
    const anchor = createCommentAnchor(ytext, 6, 11) as CommentAnchor
    doc.transact(() => {
      ytext.delete(6, 5)
      ytext.insert(0, 'world')
    })
    expect(resolveCommentAnchor(ytext, anchor)).toBeNull()
  })
})

describe('F-501 A6 createCommentAnchor 경계', () => {
  it('잘못된 범위는 모두 null, 문서 전체는 만들어진다', () => {
    const { ytext } = makeDoc('hello world foo')
    expect(createCommentAnchor(ytext, 5, 5)).toBeNull()
    expect(createCommentAnchor(ytext, 6, 5)).toBeNull()
    expect(createCommentAnchor(ytext, -1, 3)).toBeNull()
    expect(createCommentAnchor(ytext, 0, ytext.length + 1)).toBeNull()
    expect(createCommentAnchor(ytext, 1.5, 3)).toBeNull()

    const whole = createCommentAnchor(ytext, 0, ytext.length)
    expect(whole).not.toBeNull()
    expect(resolveCommentAnchor(ytext, whole)).toEqual({ from: 0, to: ytext.length })
  })
})

describe('F-501 A7 타입·client 불일치', () => {
  it('없는 client / title Y.Text 를 가리키는 앵커는 null', () => {
    const { ytext } = makeDoc('hello world foo')
    const unknownClient: CommentAnchor = {
      start: { tname: 'content', item: { client: 999999999, clock: 0 }, assoc: 0 },
      end: { tname: 'content', item: { client: 999999999, clock: 1 }, assoc: -1 },
    }
    expect(resolveCommentAnchor(ytext, unknownClient)).toBeNull()

    const doc = new Y.Doc()
    const contentText = doc.getText('content')
    const titleText = doc.getText('title')
    doc.transact(() => {
      contentText.insert(0, 'hello world foo')
      titleText.insert(0, 'a title here')
    })
    const titleStart = Y.createRelativePositionFromTypeIndex(titleText, 2, 0)
    const titleEnd = Y.createRelativePositionFromTypeIndex(titleText, 5, -1)
    const forged: CommentAnchor = {
      start: { ...Y.relativePositionToJSON(titleStart), tname: 'content' },
      end: { ...Y.relativePositionToJSON(titleEnd), tname: 'content' },
    }
    expect(resolveCommentAnchor(doc.getText('content'), forged)).toBeNull()
  })
})

describe('F-501 A8 모양이 틀린 앵커는 던지지 않고 null', () => {
  it('여러 잘못된 모양', () => {
    const { ytext } = makeDoc('hello world foo')
    const good = createCommentAnchor(ytext, 6, 11) as CommentAnchor
    const bad: unknown[] = [
      {},
      { start: {}, end: good.end },
      { start: { tname: 'content', item: 'x', assoc: 0 }, end: good.end },
      { start: { tname: 'content', item: { client: 'a', clock: 0 }, assoc: 0 }, end: good.end },
      { start: { tname: 'content', item: { client: 1, clock: -1 }, assoc: 0 }, end: good.end },
      { start: { tname: 'content', item: { client: 1, clock: 0 } }, end: good.end },
      { start: { tname: 'content', item: { client: 1, clock: 0 }, assoc: -1 }, end: good.end },
      { start: { tname: 'content', item: { client: 1, clock: 0 }, assoc: 0, type: 'x' }, end: good.end },
      { start: { tname: 'content', item: null, assoc: 0 }, end: good.end },
      { start: { tname: 'title', item: { client: 1, clock: 0 }, assoc: 0 }, end: good.end },
    ]
    for (const anchor of bad) {
      expect(() => resolveCommentAnchor(ytext, anchor as CommentAnchor)).not.toThrow()
      expect(resolveCommentAnchor(ytext, anchor as CommentAnchor)).toBeNull()
    }
  })
})

describe('F-501 A9 resolveCommentAnchors', () => {
  it('첫 댓글만 담고, resolveCommentAnchor 개별 호출과 같다', () => {
    const { doc, ytext } = makeDoc('hello world foo')
    const anchorOk = createCommentAnchor(ytext, 6, 11) as CommentAnchor
    doc.transact(() => {
      ytext.delete(6, 5) // covers the whole range → orphan
    })
    const anchorOrphan = anchorOk
    const anchorOk2 = createCommentAnchor(ytext, 0, 4) as CommentAnchor

    const entries: [string, CommentEntry][] = [
      ['root1', fakeEntry({ anchor: anchorOk2 })],
      ['root2', fakeEntry({ anchor: anchorOrphan })],
      ['root3', fakeEntry({ anchor: null })],
      ['reply1', fakeEntry({ parent: 'root1', anchor: null })],
      ['reply2', fakeEntry({ parent: 'root2', anchor: null })],
    ]
    const result = resolveCommentAnchors(ytext, entries)
    expect(result.size).toBe(3)
    for (const [id, entry] of entries) {
      if (entry.parent !== null) continue
      expect(result.get(id)).toEqual(resolveCommentAnchor(ytext, entry.anchor))
    }
  })
})

// ----- A10~A21 기록·다시 붙이기 -----

describe('F-501 A10 toCommentRecord', () => {
  it('4.1 표 그대로', () => {
    const text = 'hello world foo'
    const { ytext } = makeDoc(text)

    const middle = toCommentRecord('c1', fakeEntry(), text, { from: 6, to: 11 })
    expect(middle.quote).toBe('world')
    expect(middle.prefix).toBe('hello ')
    expect(middle.suffix).toBe(' foo')
    expect(middle.anchorFrom).toBe(6)
    expect(middle.anchorLength).toBe(5)

    const front = toCommentRecord('c2', fakeEntry(), text, { from: 0, to: 5 })
    expect(front.prefix).toBe('')
    expect(front.quote).toBe('hello')

    const end = toCommentRecord('c3', fakeEntry(), text, { from: 12, to: 15 })
    expect(end.suffix).toBe('')
    expect(end.quote).toBe('foo')

    const longText = 'a'.repeat(300)
    const long = toCommentRecord('c4', fakeEntry(), longText, { from: 0, to: 300 })
    expect(long.quote.length).toBe(200)
    expect(long.quote.endsWith('…')).toBe(true)
    expect(long.anchorLength).toBe(300)

    const reply = toCommentRecord('c5', fakeEntry({ parent: 'root1', quote: '' }), text, null)
    expect(reply.quote).toBe('')
    expect(reply.prefix).toBe('')
    expect(reply.suffix).toBe('')
    expect(reply.anchorFrom).toBeNull()
    expect(reply.anchorLength).toBeNull()

    const orphan = toCommentRecord('c6', fakeEntry({ quote: 'saved quote' }), text, null)
    expect(orphan.quote).toBe('saved quote')
    expect(orphan.anchorFrom).toBeNull()
    expect(orphan.anchorLength).toBeNull()

    expect(ytext.toString()).toBe(text)
  })
})

describe('F-501 A11 toCommentRecord 서로게이트 보존', () => {
  it('prefix·suffix 가 서로게이트 짝을 자르지 않는다', () => {
    const emoji = '😀' // 서로게이트 짝
    const text = `abc${emoji}defgh${emoji}xyz`
    const from = text.indexOf('defgh')
    const to = from + 'defgh'.length
    const record = toCommentRecord('c1', fakeEntry(), text, { from, to })
    const prefixFirstCode = record.prefix.charCodeAt(0)
    const suffixLastCode = record.suffix.charCodeAt(record.suffix.length - 1)
    expect(prefixFirstCode >= 0xdc00 && prefixFirstCode <= 0xdfff).toBe(false)
    expect(suffixLastCode >= 0xd800 && suffixLastCode <= 0xdbff).toBe(false)
  })
})

describe('F-501 A12 reanchor ① 힌트가 맞을 때', () => {
  it('힌트 자리를 바로 쓴다', () => {
    const text = 'xxx hello world yyy hello world zzz'
    const record = baseRecord({ quote: 'hello world', prefix: 'xxx ', suffix: ' yyy', anchorFrom: 4, anchorLength: 11 })
    expect(reanchor(text, record)).toEqual({ from: 4, to: 15 })
  })
})

describe('F-501 A13 reanchor ② 힌트가 어긋남', () => {
  it('옮겨진 원래 자리를 찾는다', () => {
    const original = 'xxx hello world yyy'
    const text = 'AAAA' + original
    const record = baseRecord({ quote: 'hello world', prefix: 'xxx ', suffix: ' yyy', anchorFrom: 4, anchorLength: 11 })
    expect(reanchor(text, record)).toEqual({ from: 8, to: 19 })
  })
})

describe('F-501 A14 reanchor ② 문맥이 맞는 곳을 고른다', () => {
  it('같은 인용문 두 곳, 문맥이 맞는 곳(힌트에서 더 먼 곳)을 고른다', () => {
    const near = 'zzz hello world zzz'
    const far = 'xxx hello world yyy'
    const text = near + far
    const nearIndex = near.indexOf('hello world')
    const farIndex = near.length + far.indexOf('hello world')
    const record = baseRecord({ quote: 'hello world', prefix: 'xxx ', suffix: ' yyy', anchorFrom: 0, anchorLength: 11 })
    // 가까운 near 는 문맥이 안 맞고(점수 낮음), 먼 far 는 prefix·suffix 가 완전히 맞는다(만점)
    expect(Math.abs(nearIndex - 0)).toBeLessThan(Math.abs(farIndex - 0))
    expect(reanchor(text, record)).toEqual({ from: farIndex, to: farIndex + 11 })
  })
})

describe('F-501 A15 reanchor ② 동점 처리', () => {
  it('거리 3과 5 중 3을 고른다', () => {
    const head = 'HEAD'
    const hint = 10
    const p1 = 7 // |7-10| = 3
    const p2 = 15 // |15-10| = 5
    const text = 'Z'.repeat(p1) + head + 'Z'.repeat(p2 - (p1 + head.length)) + head + 'Z'.repeat(5)
    const record = baseRecord({ quote: head, prefix: 'QQ', suffix: 'QQ', anchorFrom: hint, anchorLength: head.length })
    expect(reanchor(text, record)).toEqual({ from: p1, to: p1 + head.length })
  })

  it('거리가 같은 두 곳은 p 가 작은 쪽', () => {
    const head = 'HEAD'
    // h such that two candidates are equidistant: p1 < h < p2, h-p1 === p2-h
    const p1 = 2
    const p2 = 10
    const h = 6
    const finalText = 'A'.repeat(p1) + head + 'A'.repeat(p2 - (p1 + head.length)) + head + 'AAAA'
    const record = baseRecord({ quote: head, prefix: 'zzzz', suffix: 'zzzz', anchorFrom: h, anchorLength: head.length })
    expect(reanchor(finalText, record)).toEqual({ from: p1, to: p1 + head.length })
  })
})

describe('F-501 A16 reanchor ② 후보 상한', () => {
  it('힌트에서 가까운 1000개 안에서 고른다', () => {
    const gap = 3
    const total = 1500
    const startOffset = 10
    const positions: number[] = []
    let text = 'z'.repeat(startOffset)
    for (let i = 0; i < total; i++) {
      positions.push(text.length)
      text += 'H' + 'z'.repeat(gap - 1)
    }

    // 가장 가까운 후보(index 0)에 문맥 점수 1점만 준다 (prefix 마지막 한 글자만 맞춘다)
    const p0 = positions[0]
    text = text.slice(0, p0 - 1) + 'P' + text.slice(p0)

    // 1,200번째(index 1199)는 완전히 맞는 문맥을 준다 — 힌트에서 가까운 1,000개 밖이라 후보에 안 든다
    const perfectIndex = 1199
    const pPerfect = positions[perfectIndex]
    text = text.slice(0, pPerfect - 2) + 'PP' + text[pPerfect] + 'SS' + text.slice(pPerfect + 3)

    const record = baseRecord({ quote: 'H', prefix: 'PP', suffix: 'SS', anchorFrom: 0, anchorLength: 1 })
    expect(reanchor(text, record)).toEqual({ from: p0, to: p0 + 1 })
  })
})

describe('F-501 A17 reanchor ③ 고아', () => {
  it('본문에 없음 / anchorFrom null / 답글', () => {
    const text = 'hello world'
    expect(reanchor(text, baseRecord({ quote: 'nomatch', anchorFrom: 0, anchorLength: 7 }))).toBeNull()
    expect(reanchor(text, baseRecord({ anchorFrom: null }))).toBeNull()
    expect(reanchor(text, baseRecord({ parent: 'root0', quote: '', anchorFrom: null, anchorLength: null }))).toBeNull()
  })
})

describe('F-501 A18 reanchor 300자 앵커', () => {
  it('본문이 어긋나도 길이를 맞춰 찾는다', () => {
    const head199 = 'h'.repeat(199)
    const quote = head199 + '…'
    const original = head199 + 'X'.repeat(101) // 300 chars total
    const text = 'PREFIX' + original
    const record = baseRecord({ quote, prefix: 'no-match-prefix', suffix: 'no-match-suffix', anchorFrom: 0, anchorLength: 300 })
    const range = reanchor(text, record)
    expect(range).toEqual({ from: 6, to: 306 })
  })
})

describe('F-501 A19 restoreCommentEntries 왕복', () => {
  it('고아 아닌 것은 같은 범위로 풀리고 orphaned 가 맞다', () => {
    const text = 'hello world foo bar baz'
    const { doc, ytext } = makeDoc(text)
    const anchor1 = createCommentAnchor(ytext, 0, 5) as CommentAnchor // "hello"
    const anchor2 = createCommentAnchor(ytext, 12, 15) as CommentAnchor // "foo"
    doc.transact(() => {
      ytext.delete(6, 5) // "world" 삭제 → 다른 첫 댓글은 고아
    })

    const entries: [string, CommentEntry][] = [
      ['root1', fakeEntry({ anchor: anchor1, quote: 'hello' })],
      ['root2', fakeEntry({ anchor: anchor2, quote: 'foo' })],
      ['root3', fakeEntry({ anchor: null, quote: 'orphan already' })],
      ['reply1', fakeEntry({ parent: 'root1', anchor: null, quote: '' })],
      ['reply2', fakeEntry({ parent: 'root2', anchor: null, quote: '' })],
    ]
    const ranges = resolveCommentAnchors(ytext, entries)
    const newText = ytext.toString()
    const records: CommentRecord[] = entries.map(([id, entry]) => toCommentRecord(id, entry, newText, ranges.get(id) ?? null))

    const doc2 = new Y.Doc()
    const ytext2 = doc2.getText('content')
    doc2.transact(() => {
      ytext2.insert(0, newText)
    })
    const { entries: restored, orphaned } = restoreCommentEntries(ytext2, records)
    expect(orphaned).toBe(1)
    const restoredMap = new Map(restored)
    expect(resolveCommentAnchor(ytext2, restoredMap.get('root1')!.anchor)).toEqual({ from: 0, to: 5 })
    expect(resolveCommentAnchor(ytext2, restoredMap.get('root2')!.anchor)).not.toBeNull()
    expect(restoredMap.get('root3')!.anchor).toBeNull()
    expect(restoredMap.get('reply1')!.anchor).toBeNull()
    for (const [, entry] of restored) {
      expect(entry.v).toBe(1)
    }
  })
})

describe('F-501 A20 restoreCommentEntries + importer', () => {
  it('작성자·해결자가 importer 로, mentions 는 빈 배열', () => {
    const text = 'hello world'
    const { ytext } = makeDoc(text)
    const importer = { id: 'importer-1', email: 'importer@example.com' }
    const records: CommentRecord[] = [
      baseRecord({
        id: 'root1',
        parent: null,
        body: 'hi @a@b.com',
        mentions: ['a@b.com'],
        authorId: 'orig',
        authorEmail: 'orig@example.com',
        resolvedAt: 100,
        resolvedById: 'resolver',
        resolvedBy: 'resolver@example.com',
        quote: 'hello',
        prefix: '',
        suffix: ' world',
        anchorFrom: 0,
        anchorLength: 5,
      }),
      replyRecordHelper('root1', 'reply1', { authorId: 'orig2', authorEmail: 'orig2@example.com' }),
    ]
    const { entries } = restoreCommentEntries(ytext, records, importer)
    for (const [, entry] of entries) {
      expect(entry.author).toEqual(importer)
      expect(entry.mentions).toEqual([])
      if (entry.resolved) expect(entry.resolved.by).toEqual(importer)
    }
  })
})

function replyRecordHelper(parent: string, id: string, overrides: Partial<CommentRecord> = {}): CommentRecord {
  return {
    id,
    parent,
    body: 'reply',
    mentions: [],
    authorId: 'u1',
    authorEmail: 'u1@example.com',
    createdAt: 1,
    resolvedAt: null,
    resolvedById: null,
    resolvedBy: null,
    quote: '',
    prefix: '',
    suffix: '',
    anchorFrom: null,
    anchorLength: null,
    ...overrides,
  }
}

describe('F-501 A21 restoreCommentEntries 부모 없는 답글', () => {
  it('entries 에 없고 orphaned 에도 안 셈', () => {
    const text = 'hello world'
    const { ytext } = makeDoc(text)
    const records: CommentRecord[] = [replyRecordHelper('ghost-parent', 'reply1')]
    const { entries, orphaned } = restoreCommentEntries(ytext, records)
    expect(entries).toEqual([])
    expect(orphaned).toBe(0)
  })
})

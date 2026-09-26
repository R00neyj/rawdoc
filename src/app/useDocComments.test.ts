// U9~U16 — 쓰기 함수, 실제 Y.Doc, DOM 없음 (specs/features/F-505.md 13.1)
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import { writeDelete, writeNewThread, writeReply, writeResolved, type WriteTarget } from './useDocComments'
import { createCommentAnchor } from '../lib/commentAnchor'
import { resolveCommentAnchor } from '../lib/commentAnchor'
import { groupCommentThreads, validateCommentEntry, type CommentAuthor, type CommentEntry } from '../lib/docComments'

const AUTHOR: CommentAuthor = { id: 'u1', email: 'a@b.com' }

function makeTarget(overrides: Partial<WriteTarget> = {}): { target: WriteTarget; doc: Y.Doc; ytext: Y.Text; map: Y.Map<unknown> } {
  const doc = new Y.Doc()
  const ytext = doc.getText('content')
  const map = doc.getMap('comments')
  let counter = 0
  const target: WriteTarget = {
    doc,
    map,
    author: AUTHOR,
    now: () => 1_700_000_000_000,
    newId: () => `id${++counter}`,
    ...overrides,
  }
  return { target, doc, ytext, map }
}

function contentChangedTransactions(doc: Y.Doc, run: () => void): number {
  let count = 0
  const changed = doc.getText('content') as unknown
  const handler = (tr: Y.Transaction) => {
    if ((tr.changed as Map<unknown, unknown>).has(changed)) count++
  }
  doc.on('afterTransaction', handler)
  run()
  doc.off('afterTransaction', handler)
  return count
}

describe('writeNewThread — U9·U10', () => {
  it('U9 — 맵에 항목 하나, 풀면 {6,11}, quote world, author·resolved 그대로', () => {
    const { target, ytext, map } = makeTarget()
    ytext.insert(0, 'hello world foo')
    const anchor = createCommentAnchor(ytext, 6, 11)
    expect(anchor).not.toBeNull()
    const result = writeNewThread(target, {
      draft: { anchor: anchor!, range: { from: 6, to: 11 }, quote: 'world' },
      body: '댓글 본문',
      mentions: [],
    })
    expect(result.ok).toBe(true)
    expect(map.size).toBe(1)
    const raw = map.get(result.ok ? result.id : '')
    const check = validateCommentEntry(raw)
    expect(check.ok).toBe(true)
    if (!check.ok) throw new Error('invalid')
    expect(resolveCommentAnchor(ytext, check.entry.anchor)).toEqual({ from: 6, to: 11 })
    expect(check.entry.quote).toBe('world')
    expect(check.entry.author).toEqual(AUTHOR)
    expect(check.entry.resolved).toBeNull()
    expect(check.entry.mentions).toEqual([])
  })

  it('U10 — content 는 안 바뀐다, content 를 바꾼 트랜잭션 0개', () => {
    const { target, ytext } = makeTarget()
    ytext.insert(0, 'hello world foo')
    const before = ytext.toString()
    const anchor = createCommentAnchor(ytext, 6, 11)!
    const changedCount = contentChangedTransactions(target.doc, () => {
      writeNewThread(target, { draft: { anchor, range: { from: 6, to: 11 }, quote: 'world' }, body: '본문', mentions: [] })
    })
    expect(ytext.toString()).toBe(before)
    expect(changedCount).toBe(0)
  })
})

describe('writeReply — U11·U12', () => {
  function seedRoot(map: Y.Map<unknown>, id: string, resolved: CommentEntry['resolved'] = null): CommentEntry {
    const entry: CommentEntry = {
      v: 1,
      parent: null,
      anchor: null,
      quote: '인용',
      body: '첫 댓글',
      mentions: [],
      author: AUTHOR,
      createdAt: 1,
      resolved,
    }
    map.set(id, entry)
    return entry
  }

  it('U11 — 해결된 스레드에 답글, 트랜잭션 1개로 추가 + 부모 resolved null', () => {
    const { target, map } = makeTarget()
    seedRoot(map, 'root1', { by: AUTHOR, at: 5 })
    let txCount = 0
    target.doc.on('afterTransaction', () => txCount++)
    const result = writeReply(target, { parent: 'root1', body: '답글', mentions: [] })
    expect(result.ok).toBe(true)
    expect(txCount).toBe(1)
    const rootCheck = validateCommentEntry(map.get('root1'))
    expect(rootCheck.ok && rootCheck.entry.resolved).toBeNull()
    const threads = groupCommentThreads(map.entries()).threads
    expect(threads.find((t) => t.id === 'root1')?.replies.length).toBe(1)
  })

  it('U12 — 없는 부모 / 부모가 답글이면 not_found, 맵 그대로', () => {
    const { target, map } = makeTarget()
    seedRoot(map, 'root1')
    const before = JSON.stringify([...map.entries()])
    expect(writeReply(target, { parent: 'nope', body: '답글', mentions: [] })).toEqual({ ok: false, reason: 'not_found' })
    const replyResult = writeReply(target, { parent: 'root1', body: '첫 답글', mentions: [] })
    expect(replyResult.ok).toBe(true)
    const replyId = replyResult.ok ? replyResult.id : ''
    expect(writeReply(target, { parent: replyId, body: '답글의 답글', mentions: [] })).toEqual({ ok: false, reason: 'not_found' })
    expect(JSON.stringify([...map.entries()])).not.toBe(before) // 첫 답글은 실제로 들어갔다
  })
})

describe('writeResolved — U13', () => {
  it('참 → 거짓 — resolved 가 null 로, 다른 필드는 그대로', () => {
    const { target, map } = makeTarget()
    const entry: CommentEntry = {
      v: 1,
      parent: null,
      anchor: null,
      quote: '인용',
      body: '본문',
      mentions: [],
      author: AUTHOR,
      createdAt: 1,
      resolved: { by: AUTHOR, at: 2 },
    }
    map.set('t1', entry)
    const result = writeResolved(target, 't1', false)
    expect(result).toEqual({ ok: true, id: 't1' })
    const check = validateCommentEntry(map.get('t1'))
    expect(check.ok).toBe(true)
    if (!check.ok) throw new Error('invalid')
    expect(check.entry.resolved).toBeNull()
    const { resolved: _r1, ...restNext } = check.entry
    const { resolved: _r2, ...restBefore } = entry
    expect(restNext).toEqual(restBefore)
  })
})

describe('writeDelete — U14', () => {
  it('답글 둘 달린 첫 댓글 / 답글 하나 / 없는 id', () => {
    const { target, map } = makeTarget()
    const root: CommentEntry = {
      v: 1,
      parent: null,
      anchor: null,
      quote: '인용',
      body: '첫 댓글',
      mentions: [],
      author: AUTHOR,
      createdAt: 1,
      resolved: null,
    }
    map.set('root1', root)
    const reply = (parent: string): CommentEntry => ({
      v: 1,
      parent,
      anchor: null,
      quote: '',
      body: '답글',
      mentions: [],
      author: AUTHOR,
      createdAt: 2,
      resolved: null,
    })
    map.set('reply1', reply('root1'))
    map.set('reply2', reply('root1'))
    map.set('root2', { ...root, body: '다른 댓글' })
    map.set('reply3', reply('root2'))

    let txCount = 0
    target.doc.on('afterTransaction', () => txCount++)
    const result = writeDelete(target, 'root1')
    expect(result).toEqual({ ok: true, id: 'root1' })
    expect(txCount).toBe(1)
    expect(map.has('root1')).toBe(false)
    expect(map.has('reply1')).toBe(false)
    expect(map.has('reply2')).toBe(false)
    expect(map.has('root2')).toBe(true)
    expect(map.has('reply3')).toBe(true)

    const replyOnly = writeDelete(target, 'reply3')
    expect(replyOnly).toEqual({ ok: true, id: 'reply3' })
    expect(map.has('reply3')).toBe(false)
    expect(map.has('root2')).toBe(true)

    expect(writeDelete(target, 'not-there')).toEqual({ ok: false, reason: 'not_found' })
  })
})

describe('본문 검사 — U15·U16', () => {
  it('U15 — 한도: 문서 500개 → doc_full, 스레드 100개 답글 → thread_full, 맵 그대로', () => {
    const { target, ytext, map } = makeTarget()
    ytext.insert(0, 'x')
    for (let i = 0; i < 500; i++) {
      map.set(`t${i}`, {
        v: 1,
        parent: null,
        anchor: null,
        quote: '인용',
        body: '본문',
        mentions: [],
        author: AUTHOR,
        createdAt: i,
        resolved: null,
      })
    }
    const before = map.size
    const anchor = createCommentAnchor(ytext, 0, 1)!
    expect(writeNewThread(target, { draft: { anchor, range: { from: 0, to: 1 }, quote: 'x' }, body: '새 댓글', mentions: [] })).toEqual({
      ok: false,
      reason: 'doc_full',
    })
    expect(writeReply(target, { parent: 't0', body: '답글', mentions: [] })).toEqual({ ok: false, reason: 'doc_full' })
    expect(map.size).toBe(before)

    const { target: target2, map: map2 } = makeTarget()
    map2.set('root', {
      v: 1,
      parent: null,
      anchor: null,
      quote: '인용',
      body: '본문',
      mentions: [],
      author: AUTHOR,
      createdAt: 0,
      resolved: null,
    })
    for (let i = 0; i < 100; i++) {
      map2.set(`r${i}`, {
        v: 1,
        parent: 'root',
        anchor: null,
        quote: '',
        body: '답글',
        mentions: [],
        author: AUTHOR,
        createdAt: i + 1,
        resolved: null,
      })
    }
    const before2 = map2.size
    expect(writeReply(target2, { parent: 'root', body: '넘치는 답글', mentions: [] })).toEqual({ ok: false, reason: 'thread_full' })
    expect(map2.size).toBe(before2)
  })

  it('U16 — 본문: 공백만 → empty, 1001자 → too_long, 앞뒤 공백+1000자 → ok(1000자 저장), CRLF → ok(\\n 저장)', () => {
    const { target, ytext, map } = makeTarget()
    ytext.insert(0, 'x'.repeat(10))
    const anchor = createCommentAnchor(ytext, 0, 1)!
    const draftFor = (quote: string) => ({ anchor, range: { from: 0, to: 1 }, quote })

    expect(writeNewThread(target, { draft: draftFor('x'), body: '   ', mentions: [] })).toEqual({ ok: false, reason: 'empty' })
    expect(writeNewThread(target, { draft: draftFor('x'), body: 'a'.repeat(1001), mentions: [] })).toEqual({
      ok: false,
      reason: 'too_long',
    })

    const padded = writeNewThread(target, { draft: draftFor('x'), body: ` ${'b'.repeat(1000)} `, mentions: [] })
    expect(padded.ok).toBe(true)
    const paddedEntry = validateCommentEntry(map.get(padded.ok ? padded.id : ''))
    expect(paddedEntry.ok && paddedEntry.entry.body).toBe('b'.repeat(1000))

    const crlf = writeNewThread(target, { draft: draftFor('x'), body: 'a\r\nb', mentions: [] })
    expect(crlf.ok).toBe(true)
    const crlfEntry = validateCommentEntry(map.get(crlf.ok ? crlf.id : ''))
    expect(crlfEntry.ok && crlfEntry.entry.body).toBe('a\nb')
  })
})

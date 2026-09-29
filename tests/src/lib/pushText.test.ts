// F-3002 T1~T6 푸시 문구·자르기 (specs/features/F-3002.md 5장·6.3)
import { describe, expect, it } from 'vitest'
import {
  commentPushPayload,
  formatNotificationTitle,
  formatPushExcerpt,
  quotaPushPayload,
  sharePushPayload,
  testPushPayload,
  type PushCommentRow,
} from '../../../src/lib/pushText'

const DOC_ID = '0b8f2a3e-6a4c-4f7e-9d1a-2f3b4c5d6e7f'

function row(over: Partial<PushCommentRow>): PushCommentRow {
  return { kind: 'comment', actorEmail: 'a@x.com', docTitle: '회의록', excerpt: '', threadId: 't', createdAt: 1, ...over }
}

describe('commentPushPayload 1행 — T1', () => {
  it('mention', () => {
    const p = commentPushPayload(DOC_ID, [row({ kind: 'mention', excerpt: '이번 주\n검토', threadId: 'th1' })])
    expect(p).toEqual({
      v: 1,
      title: 'a@x.com님이 멘션했습니다',
      body: '"회의록" · 이번 주 검토',
      tag: `doc:${DOC_ID}`,
      url: `/#/d/${DOC_ID}/c/th1`,
    })
  })

  it('reply·comment 는 제목만 다르다', () => {
    const reply = commentPushPayload(DOC_ID, [row({ kind: 'reply', excerpt: '이번 주\n검토', threadId: 'th1' })])
    expect(reply.title).toBe('a@x.com님이 답글을 달았습니다')
    expect(reply.body).toBe('"회의록" · 이번 주 검토')
    const comment = commentPushPayload(DOC_ID, [row({ kind: 'comment', excerpt: '이번 주\n검토', threadId: 'th1' })])
    expect(comment.title).toBe('a@x.com님이 댓글을 달았습니다')
    expect(comment.url).toBe(`/#/d/${DOC_ID}/c/th1`)
  })

  it('발췌가 공백만이면 제목만', () => {
    const p = commentPushPayload(DOC_ID, [row({ kind: 'mention', excerpt: '  \n ' })])
    expect(p.body).toBe('"회의록"')
  })
})

describe('commentPushPayload n행 — T2', () => {
  it('정렬 뒤 마지막 행의 제목·보낸 사람·발췌, 첫 멘션의 스레드', () => {
    const rows = [
      row({ kind: 'mention', createdAt: 3, actorEmail: 'm@x.com', excerpt: '멘션 내용', threadId: 'thM', docTitle: '새 제목' }),
      row({ kind: 'reply', createdAt: 1, actorEmail: 'r@x.com', excerpt: '답글', threadId: 'thR', docTitle: '옛 제목' }),
      row({ kind: 'comment', createdAt: 2, actorEmail: 'c@x.com', excerpt: '댓글', threadId: 'thC', docTitle: '옛 제목' }),
    ]
    const p = commentPushPayload(DOC_ID, rows)
    expect(p.title).toBe('"새 제목"에 새 댓글 3개')
    expect(p.body).toBe('멘션 포함 · m@x.com: 멘션 내용')
    expect(p.url).toBe(`/#/d/${DOC_ID}/c/thM`)
    expect(p.tag).toBe(`doc:${DOC_ID}`)
  })

  it('멘션이 없으면 앞말 없이, 가장 오래된 행의 스레드', () => {
    const rows = [
      row({ kind: 'comment', createdAt: 5, actorEmail: 'c@x.com', excerpt: '', threadId: 'thNew' }),
      row({ kind: 'reply', createdAt: 4, actorEmail: 'r@x.com', excerpt: '먼저', threadId: 'thOld' }),
    ]
    const p = commentPushPayload(DOC_ID, rows)
    expect(p.title).toBe('"회의록"에 새 댓글 2개')
    expect(p.body).toBe('c@x.com')
    expect(p.url).toBe(`/#/d/${DOC_ID}/c/thOld`)
  })

  it('createdAt 이 같으면 들어온 순서가 뒤인 것이 마지막', () => {
    const rows = [
      row({ createdAt: 7, actorEmail: 'first@x.com', excerpt: '하나', threadId: 'th1' }),
      row({ createdAt: 7, actorEmail: 'second@x.com', excerpt: '둘', threadId: 'th2' }),
    ]
    const p = commentPushPayload(DOC_ID, rows)
    expect(p.body).toBe('second@x.com: 둘')
    expect(p.url).toBe(`/#/d/${DOC_ID}/c/th1`)
  })

  it('빈 배열은 던진다', () => {
    expect(() => commentPushPayload(DOC_ID, [])).toThrow()
  })
})

describe('자르기 — T3', () => {
  it('formatPushExcerpt 80 코드 포인트', () => {
    expect(formatPushExcerpt('가'.repeat(80))).toBe('가'.repeat(80))
    expect(formatPushExcerpt('가'.repeat(81))).toBe('가'.repeat(79) + '…')
    expect(formatPushExcerpt('😀'.repeat(81))).toBe('😀'.repeat(79) + '…')
    expect(formatPushExcerpt('a\r\nb\nc')).toBe('a b c')
    expect(formatPushExcerpt('  ')).toBe('')
  })

  it('formatNotificationTitle 41자는 39 + …', () => {
    expect(formatNotificationTitle('가'.repeat(41))).toBe('가'.repeat(39) + '…')
  })
})

describe('sharePushPayload — T4', () => {
  it('문서·편집', () => {
    const p = sharePushPayload({ actorEmail: 'b@x.com', target: 'doc', targetId: DOC_ID, name: '기획안', role: 'edit' })
    expect(p).toEqual({
      v: 1,
      title: 'b@x.com님이 문서를 공유했습니다',
      body: '"기획안" · 편집 권한',
      url: `/#/d/${DOC_ID}`,
      tag: `share:${DOC_ID}`,
    })
  })

  it('폴더·보기', () => {
    const p = sharePushPayload({ actorEmail: 'b@x.com', target: 'folder', targetId: DOC_ID, name: '자료', role: 'view' })
    expect(p).toEqual({
      v: 1,
      title: 'b@x.com님이 폴더를 공유했습니다',
      body: '"자료" · 보기 권한',
      url: '/#/',
      tag: `share:${DOC_ID}`,
    })
  })

  it('폴더 이름이 공백만이면 이름 없는 폴더', () => {
    const p = sharePushPayload({ actorEmail: 'b@x.com', target: 'folder', targetId: DOC_ID, name: '   ', role: 'view' })
    expect(p.body).toBe('"이름 없는 폴더" · 보기 권한')
  })
})

describe('quotaPushPayload — T5', () => {
  it('이미지만', () => {
    const p = quotaPushPayload({ images: { used: 284_164_096, limit: 314_572_800 } })
    expect(p).toEqual({ v: 1, title: '저장 공간이 거의 찼습니다', body: '이미지 271MB / 300MB', url: '/#/', tag: 'quota' })
  })

  it('셋 다 이 순서로', () => {
    const p = quotaPushPayload({
      docCount: { used: 9_012, limit: 10_000 },
      docBytes: { used: 96_468_992, limit: 104_857_600 },
      images: { used: 284_164_096, limit: 314_572_800 },
    })
    expect(p.body).toBe('이미지 271MB / 300MB · 문서 92MB / 100MB · 문서 9,012개 / 10,000개')
  })

  it('10MB 미만은 소수 1자리', () => {
    const p = quotaPushPayload({ docBytes: { used: 314_573, limit: 104_857_600 } })
    expect(p.body).toBe('문서 0.3MB / 100MB')
  })

  it('빈 객체는 던진다', () => {
    expect(() => quotaPushPayload({})).toThrow()
  })
})

describe('testPushPayload — T6', () => {
  it('테스트 알림 값', () => {
    expect(testPushPayload()).toEqual({
      v: 1,
      title: '테스트 알림',
      body: '이 기기에서 푸시 알림을 받을 수 있습니다.',
      tag: 'test',
      url: '/#/',
    })
  })
})
